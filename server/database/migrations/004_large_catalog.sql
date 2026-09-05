CREATE EXTENSION IF NOT EXISTS pg_trgm;

UPDATE store_settings
SET value = '300000'::jsonb,
    description = 'Проектная емкость каталога без ограничения бизнес-ассортимента',
    updated_at = NOW()
WHERE key = 'catalog_initial_capacity';

CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS brands_name_ci_uq ON brands (LOWER(name));

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS article TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

UPDATE products SET slug = 'product-' || REPLACE(id::text, '-', '') WHERE slug IS NULL;
ALTER TABLE products ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_uq ON products(slug);

INSERT INTO brands (name, slug)
SELECT DISTINCT brand, 'brand-' || SUBSTRING(encode(digest(LOWER(brand), 'sha256'), 'hex') FROM 1 FOR 16)
FROM products
WHERE brand <> ''
ON CONFLICT DO NOTHING;

UPDATE products
SET brand_id = brands.id
FROM brands
WHERE LOWER(brands.name) = LOWER(products.brand) AND products.brand_id IS NULL;

CREATE TABLE IF NOT EXISTS product_external_ids (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL,
  external_id TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'active' CHECK (sync_status IN ('active', 'inactive', 'error')),
  PRIMARY KEY (source_system, external_id),
  UNIQUE (product_id, source_system)
);

INSERT INTO product_external_ids (product_id, source_system, external_id, last_synced_at, sync_status)
SELECT id, source_system, external_id, last_synced_at, sync_status
FROM products WHERE external_id IS NOT NULL
ON CONFLICT (source_system, external_id) DO UPDATE
SET product_id = EXCLUDED.product_id,
    last_synced_at = EXCLUDED.last_synced_at,
    sync_status = EXCLUDED.sync_status;

CREATE TABLE IF NOT EXISTS tire_specs (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  width INTEGER NOT NULL CHECK (width BETWEEN 80 AND 500),
  profile INTEGER NOT NULL CHECK (profile BETWEEN 20 AND 100),
  diameter NUMERIC(4,1) NOT NULL CHECK (diameter BETWEEN 8 AND 40),
  season TEXT NOT NULL CHECK (season IN ('summer', 'winter', 'all-season')),
  studded BOOLEAN NOT NULL DEFAULT FALSE,
  runflat BOOLEAN NOT NULL DEFAULT FALSE,
  xl BOOLEAN NOT NULL DEFAULT FALSE,
  load_index TEXT,
  speed_index TEXT,
  manufacturer_country TEXT,
  model_year INTEGER CHECK (model_year BETWEEN 1900 AND 2200),
  other_attributes JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO tire_specs (product_id, width, profile, diameter, season, studded, runflat, xl, manufacturer_country)
SELECT id, width, profile, diameter, season, studded, runflat, xl, country
FROM products
WHERE kind = 'tire' AND width BETWEEN 80 AND 500 AND profile BETWEEN 20 AND 100
  AND diameter BETWEEN 8 AND 40 AND season IN ('summer', 'winter', 'all-season')
ON CONFLICT (product_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS wheel_specs (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  diameter NUMERIC(4,1) NOT NULL CHECK (diameter BETWEEN 8 AND 40),
  width NUMERIC(4,1) NOT NULL CHECK (width BETWEEN 3 AND 20),
  bolt_count SMALLINT NOT NULL CHECK (bolt_count BETWEEN 3 AND 10),
  pcd NUMERIC(6,2) NOT NULL CHECK (pcd BETWEEN 70 AND 250),
  et NUMERIC(5,2) CHECK (et BETWEEN -100 AND 200),
  dia NUMERIC(6,2) CHECK (dia BETWEEN 40 AND 200),
  material TEXT CHECK (material IN ('alloy', 'steel', 'other')),
  color TEXT,
  manufacturer_country TEXT,
  other_attributes JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE prices ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE inventories ADD COLUMN IF NOT EXISTS source_system TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS products_public_kind_updated_idx
  ON products(kind, updated_at DESC, id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS products_public_brand_idx
  ON products(brand_id, kind, updated_at DESC) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS products_source_status_idx
  ON products(source_system, sync_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS products_sku_ci_idx ON products(LOWER(sku));
CREATE INDEX IF NOT EXISTS products_article_ci_idx ON products(LOWER(article)) WHERE article IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON products USING GIN (LOWER(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_model_trgm_idx ON products USING GIN (LOWER(model) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS brands_name_trgm_idx ON brands USING GIN (LOWER(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS prices_retail_amount_idx
  ON prices(amount_kopecks, product_id) WHERE price_type = 'retail';
CREATE INDEX IF NOT EXISTS inventories_available_product_idx
  ON inventories(product_id) WHERE quantity > reserved;
CREATE INDEX IF NOT EXISTS tire_specs_catalog_idx
  ON tire_specs(width, profile, diameter, season, studded, runflat, product_id);
CREATE INDEX IF NOT EXISTS wheel_specs_catalog_idx
  ON wheel_specs(diameter, bolt_count, pcd, width, et, dia, product_id);

CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('email', 'phone', 'yandex')),
  provider_subject TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  postal_code TEXT,
  region TEXT,
  city TEXT NOT NULL,
  street_address TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS addresses_user_idx ON addresses(user_id, is_default DESC);

ALTER TABLE shopping_carts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE shopping_carts ADD COLUMN IF NOT EXISTS anonymous_session_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS shopping_carts_anonymous_session_uq
  ON shopping_carts(anonymous_session_hash) WHERE anonymous_session_hash IS NOT NULL;
ALTER TABLE shopping_carts DROP CONSTRAINT IF EXISTS shopping_carts_owner_check;
ALTER TABLE shopping_carts ADD CONSTRAINT shopping_carts_owner_check
  CHECK ((user_id IS NOT NULL) <> (anonymous_session_hash IS NOT NULL));

CREATE TABLE IF NOT EXISTS favorites (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, product_id)
);
CREATE TABLE IF NOT EXISTS comparison_items (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, product_id)
);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_attributes JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON order_status_history(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS car_makes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL DEFAULT 'manual', external_id TEXT,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  last_synced_at TIMESTAMPTZ, sync_status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(source_system, external_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS car_makes_name_ci_uq ON car_makes(LOWER(name));

CREATE TABLE IF NOT EXISTS car_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id UUID NOT NULL REFERENCES car_makes(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'manual', external_id TEXT,
  name TEXT NOT NULL, slug TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ, sync_status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(make_id, slug), UNIQUE(source_system, external_id)
);
CREATE INDEX IF NOT EXISTS car_models_make_name_idx ON car_models(make_id, LOWER(name));

CREATE TABLE IF NOT EXISTS car_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES car_models(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'manual', external_id TEXT,
  name TEXT NOT NULL, slug TEXT NOT NULL,
  year_from INTEGER CHECK (year_from BETWEEN 1900 AND 2200),
  year_to INTEGER CHECK (year_to BETWEEN 1900 AND 2200),
  last_synced_at TIMESTAMPTZ, sync_status TEXT NOT NULL DEFAULT 'active',
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to),
  UNIQUE(model_id, slug), UNIQUE(source_system, external_id)
);
CREATE INDEX IF NOT EXISTS car_generations_model_year_idx ON car_generations(model_id, year_from, year_to);

CREATE TABLE IF NOT EXISTS car_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES car_generations(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'manual', external_id TEXT,
  name TEXT NOT NULL, engine TEXT,
  year_from INTEGER CHECK (year_from BETWEEN 1900 AND 2200),
  year_to INTEGER CHECK (year_to BETWEEN 1900 AND 2200),
  last_synced_at TIMESTAMPTZ, sync_status TEXT NOT NULL DEFAULT 'active',
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to),
  UNIQUE(generation_id, name), UNIQUE(source_system, external_id)
);

CREATE TABLE IF NOT EXISTS fitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES car_generations(id) ON DELETE CASCADE,
  modification_id UUID REFERENCES car_modifications(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL CHECK (product_type IN ('tire', 'wheel')),
  axle TEXT NOT NULL DEFAULT 'all' CHECK (axle IN ('all', 'front', 'rear')),
  fitment_type TEXT NOT NULL DEFAULT 'factory' CHECK (fitment_type IN ('factory', 'alternative', 'tuning')),
  tire_width INTEGER CHECK (tire_width BETWEEN 80 AND 500),
  tire_profile INTEGER CHECK (tire_profile BETWEEN 20 AND 100),
  tire_diameter NUMERIC(4,1) CHECK (tire_diameter BETWEEN 8 AND 40),
  wheel_diameter NUMERIC(4,1) CHECK (wheel_diameter BETWEEN 8 AND 40),
  wheel_width NUMERIC(4,1) CHECK (wheel_width BETWEEN 3 AND 20),
  bolt_count SMALLINT CHECK (bolt_count BETWEEN 3 AND 10),
  pcd NUMERIC(6,2) CHECK (pcd BETWEEN 70 AND 250),
  dia NUMERIC(6,2) CHECK (dia BETWEEN 40 AND 200),
  et_min NUMERIC(5,2) CHECK (et_min BETWEEN -100 AND 200),
  et_max NUMERIC(5,2) CHECK (et_max BETWEEN -100 AND 200),
  source TEXT NOT NULL CHECK (source IN ('manual', 'import', 'external_api')),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (et_min IS NULL OR et_max IS NULL OR et_min <= et_max),
  CHECK (
    (product_type = 'tire' AND tire_width IS NOT NULL AND tire_profile IS NOT NULL AND tire_diameter IS NOT NULL)
    OR
    (product_type = 'wheel' AND wheel_diameter IS NOT NULL AND wheel_width IS NOT NULL AND bolt_count IS NOT NULL AND pcd IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS fitments_generation_verified_idx
  ON fitments(generation_id, modification_id, product_type) WHERE verified = TRUE;
CREATE INDEX IF NOT EXISTS fitments_tire_match_idx
  ON fitments(tire_width, tire_profile, tire_diameter, generation_id) WHERE verified = TRUE AND product_type = 'tire';
CREATE INDEX IF NOT EXISTS fitments_wheel_match_idx
  ON fitments(bolt_count, pcd, wheel_diameter, wheel_width, generation_id) WHERE verified = TRUE AND product_type = 'wheel';
CREATE UNIQUE INDEX IF NOT EXISTS fitments_import_identity_uq ON fitments(
  generation_id, COALESCE(modification_id, '00000000-0000-0000-0000-000000000000'::uuid),
  product_type, axle, fitment_type,
  COALESCE(tire_width, 0), COALESCE(tire_profile, 0), COALESCE(tire_diameter, 0),
  COALESCE(wheel_diameter, 0), COALESCE(wheel_width, 0), COALESCE(bolt_count, 0),
  COALESCE(pcd, 0), COALESCE(dia, 0), COALESCE(et_min, -999), COALESCE(et_max, 999), source
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type TEXT NOT NULL CHECK (import_type IN ('products_csv', 'fitments_csv')),
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'completed_with_errors', 'failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  created_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_jobs_status_created_idx ON import_jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS import_job_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  sku TEXT,
  field TEXT,
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  raw_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_job_errors_job_row_idx ON import_job_errors(job_id, row_number);

CREATE TABLE IF NOT EXISTS import_job_product_keys (
  job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  PRIMARY KEY(job_id, external_id)
);

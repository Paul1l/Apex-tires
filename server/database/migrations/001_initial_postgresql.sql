CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE store_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO store_settings (key, value, description) VALUES
  ('catalog_initial_capacity', '100'::jsonb, 'Начальная емкость каталога'),
  ('delivery_pickup_price_kopecks', '0'::jsonb, 'Стоимость самовывоза'),
  ('delivery_courier_price_kopecks', '0'::jsonb, 'Стоимость доставки курьером');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'manager', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  destination_hash TEXT NOT NULL,
  requester_hash TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('login', 'register')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX otp_challenges_destination_idx
  ON otp_challenges(destination_hash, created_at DESC);
CREATE INDEX otp_challenges_requester_idx
  ON otp_challenges(requester_hash, created_at DESC);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sessions_user_idx ON sessions(user_id, expires_at DESC);

CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'checkout', 'callback', 'analytics')),
  document_slug TEXT NOT NULL,
  document_version TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  source TEXT NOT NULL
);

CREATE INDEX consents_user_idx ON consents(user_id, granted_at DESC);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  sku TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('tire', 'wheel')),
  category TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  width INTEGER NOT NULL DEFAULT 0 CHECK (width >= 0),
  profile INTEGER NOT NULL DEFAULT 0 CHECK (profile >= 0),
  diameter INTEGER NOT NULL CHECK (diameter > 0),
  season TEXT NOT NULL DEFAULT 'none' CHECK (season IN ('summer', 'winter', 'all-season', 'none')),
  studded BOOLEAN NOT NULL DEFAULT FALSE,
  runflat BOOLEAN NOT NULL DEFAULT FALSE,
  pcd TEXT,
  offset INTEGER,
  center_bore NUMERIC(6,2),
  color TEXT,
  country TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sync_status TEXT NOT NULL DEFAULT 'active' CHECK (sync_status IN ('active', 'inactive', 'error')),
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX products_source_external_uq
  ON products(source_system, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX products_size_idx ON products(kind, width, profile, diameter);
CREATE INDEX products_brand_idx ON products(brand);
CREATE INDEX products_active_idx ON products(is_active, updated_at DESC);

CREATE TABLE product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  url TEXT NOT NULL,
  storage_key TEXT,
  alt TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX product_images_product_idx ON product_images(product_id, position);

CREATE TABLE product_fitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'manual',
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  generation TEXT,
  year_from INTEGER CHECK (year_from BETWEEN 1900 AND 2200),
  year_to INTEGER CHECK (year_to BETWEEN 1900 AND 2200),
  is_oem BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);

CREATE INDEX product_fitments_vehicle_idx
  ON product_fitments(make, model, year_from, year_to);

CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX warehouses_source_external_uq
  ON warehouses(source_system, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE inventories (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  source_updated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, warehouse_id),
  CHECK (reserved <= quantity)
);

CREATE TABLE prices (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'manual',
  price_type TEXT NOT NULL DEFAULT 'retail',
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks >= 0),
  old_amount_kopecks BIGINT CHECK (old_amount_kopecks >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'RUB',
  source_updated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, price_type)
);

CREATE SEQUENCE order_number_sequence START 1001;

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  source_system TEXT NOT NULL DEFAULT 'website',
  external_id TEXT,
  checkout_idempotency_key TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  subtotal_kopecks BIGINT NOT NULL CHECK (subtotal_kopecks >= 0),
  discount_kopecks BIGINT NOT NULL DEFAULT 0 CHECK (discount_kopecks >= 0),
  delivery_kopecks BIGINT NOT NULL DEFAULT 0 CHECK (delivery_kopecks >= 0),
  total_kopecks BIGINT NOT NULL CHECK (total_kopecks >= 0),
  delivery_method TEXT NOT NULL,
  delivery_address TEXT,
  comment TEXT,
  integration_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (integration_status IN ('pending', 'processing', 'synced', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX orders_source_external_uq
  ON orders(source_system, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX orders_integration_status_idx
  ON orders(integration_status, created_at);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_kopecks BIGINT NOT NULL CHECK (unit_price_kopecks >= 0),
  discount_kopecks BIGINT NOT NULL DEFAULT 0 CHECK (discount_kopecks >= 0),
  total_kopecks BIGINT NOT NULL CHECK (total_kopecks >= 0)
);

CREATE INDEX order_items_order_idx ON order_items(order_id);

CREATE TABLE integration_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX integration_queue_pending_idx
  ON integration_queue(status, next_attempt_at, created_at);

CREATE TABLE integration_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  operation TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  idempotency_key TEXT NOT NULL UNIQUE,
  sync_mode TEXT CHECK (sync_mode IN ('full', 'incremental')),
  cursor_value TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('processing', 'success', 'partial', 'failed')),
  records_received INTEGER NOT NULL DEFAULT 0 CHECK (records_received >= 0),
  records_processed INTEGER NOT NULL DEFAULT 0 CHECK (records_processed >= 0),
  records_failed INTEGER NOT NULL DEFAULT 0 CHECK (records_failed >= 0),
  error_summary TEXT,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX integration_sync_logs_status_idx
  ON integration_sync_logs(source_system, status, started_at DESC);

CREATE TABLE integration_sync_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_log_id UUID NOT NULL REFERENCES integration_sync_logs(id) ON DELETE CASCADE,
  record_index INTEGER NOT NULL,
  external_id TEXT,
  error_code TEXT NOT NULL,
  safe_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX integration_sync_errors_log_idx
  ON integration_sync_errors(sync_log_id, record_index);

CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_audit_entity_idx
  ON admin_audit_log(entity_type, entity_id, created_at DESC);

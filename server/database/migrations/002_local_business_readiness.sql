ALTER TABLE products
  ADD COLUMN IF NOT EXISTS condition TEXT NOT NULL DEFAULT 'new'
    CHECK (condition IN ('new', 'used')),
  ADD COLUMN IF NOT EXISTS xl BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wheel_type TEXT
    CHECK (wheel_type IN ('alloy', 'steel', 'other'));

CREATE TABLE IF NOT EXISTS used_product_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  manufacture_year INTEGER CHECK (manufacture_year BETWEEN 1900 AND 2200),
  tread_depth_mm NUMERIC(4,1) CHECK (tread_depth_mm >= 0),
  condition_grade TEXT CHECK (condition_grade IN ('excellent', 'good', 'acceptable')),
  repairs TEXT,
  defects TEXT,
  condition_comment TEXT,
  set_quantity INTEGER NOT NULL CHECK (set_quantity > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS used_product_lot_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES used_product_lots(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_key TEXT,
  alt TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prices
  ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2)
    CHECK (discount_percent >= 0 AND discount_percent <= 100);

ALTER TABLE product_fitments
  ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (data_source IN ('manual', 'import', 'external_api')),
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS requires_tire_service BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS vehicle_fitment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  model_year INTEGER CHECK (model_year BETWEEN 1900 AND 2200),
  generation TEXT,
  modification TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'resolved', 'closed')),
  consent_document_version TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'website',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vehicle_fitment_requests_status_idx
  ON vehicle_fitment_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
  template TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO store_settings (key, value, description) VALUES
  ('delivery_pickup_enabled', 'false'::jsonb, 'Самовывоз подтвержден владельцем'),
  ('delivery_courier_enabled', 'false'::jsonb, 'Доставка по городу подтверждена владельцем'),
  ('delivery_transport_company_enabled', 'false'::jsonb, 'Региональная доставка подтверждена владельцем'),
  ('delivery_transport_company_price_kopecks', '0'::jsonb, 'Стоимость региональной доставки; используется только после включения'),
  ('installment_enabled', 'false'::jsonb, 'Рассрочка подключена к реальному провайдеру'),
  ('used_products_enabled', 'false'::jsonb, 'Продажа б/у товаров подтверждена владельцем'),
  ('availability_display_mode', '"on_request"'::jsonb, 'Режим отображения остатков')
ON CONFLICT (key) DO NOTHING;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'manager', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  requester_hash TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('login', 'register')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS otp_challenges_email_idx
  ON otp_challenges(email_hash, created_at);
CREATE INDEX IF NOT EXISTS otp_challenges_requester_idx
  ON otp_challenges(requester_hash, created_at);
CREATE INDEX IF NOT EXISTS otp_challenges_expiry_idx
  ON otp_challenges(expires_at);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('registration', 'checkout', 'callback', 'analytics')
  ),
  document_slug TEXT NOT NULL,
  document_version TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS consents_user_idx ON consents(user_id, granted_at);
CREATE INDEX IF NOT EXISTS consents_purpose_idx ON consents(purpose, granted_at);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  sku TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('tire', 'wheel')),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  profile INTEGER NOT NULL DEFAULT 0,
  diameter INTEGER NOT NULL,
  season TEXT NOT NULL DEFAULT 'none' CHECK (season IN ('summer', 'winter', 'all-season', 'none')),
  studded INTEGER NOT NULL DEFAULT 0,
  runflat INTEGER NOT NULL DEFAULT 0,
  pcd TEXT,
  offset INTEGER,
  center_bore REAL,
  color TEXT,
  country TEXT,
  rating REAL NOT NULL DEFAULT 0,
  reviews INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS products_size_idx ON products(kind, width, profile, diameter);
CREATE INDEX IF NOT EXISTS products_brand_idx ON products(brand);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images(product_id);

CREATE TABLE IF NOT EXISTS inventories (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_code TEXT NOT NULL,
  warehouse_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(product_id, warehouse_code)
);

CREATE TABLE IF NOT EXISTS prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_type TEXT NOT NULL DEFAULT 'retail',
  amount_kopecks INTEGER NOT NULL,
  old_amount_kopecks INTEGER,
  currency TEXT NOT NULL DEFAULT 'RUB',
  updated_at TEXT NOT NULL,
  UNIQUE(product_id, price_type)
);

CREATE TABLE IF NOT EXISTS fitments (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  generation TEXT,
  year_from INTEGER,
  year_to INTEGER,
  is_oem INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS fitments_vehicle_idx ON fitments(make, model, year_from, year_to);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  total_kopecks INTEGER NOT NULL,
  delivery_method TEXT NOT NULL DEFAULT 'courier',
  delivery_address TEXT,
  comment TEXT,
  onec_exported_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku_snapshot TEXT NOT NULL,
  title_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_kopecks INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('import', 'export')),
  entity TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  records_total INTEGER NOT NULL DEFAULT 0,
  records_processed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  cursor TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS sync_runs_entity_idx ON sync_runs(entity, started_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_audit_actor_idx
  ON admin_audit_log(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS admin_audit_entity_idx
  ON admin_audit_log(entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS shopping_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopping_cart_items (
  cart_id UUID NOT NULL REFERENCES shopping_carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cart_id, product_id)
);

CREATE INDEX IF NOT EXISTS shopping_cart_items_product_idx
  ON shopping_cart_items(product_id);

CREATE INDEX IF NOT EXISTS sessions_token_expiry_idx
  ON sessions(token_hash, expires_at);

ALTER TABLE product_fitments
  ADD COLUMN IF NOT EXISTS modification TEXT;

CREATE INDEX IF NOT EXISTS product_fitments_verified_vehicle_idx
  ON product_fitments(make, model, generation, year_from, year_to)
  WHERE verified = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS product_fitments_import_identity_uq
  ON product_fitments (
    product_id,
    source_system,
    make,
    model,
    COALESCE(generation, ''),
    COALESCE(modification, ''),
    COALESCE(year_from, 0),
    COALESCE(year_to, 0)
  );

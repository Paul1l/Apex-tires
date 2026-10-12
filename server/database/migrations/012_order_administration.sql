-- Order administration (T21c): internal staff comments, actor and comment of
-- staff status changes in order_status_history, indexes for the admin order
-- list. Only adds objects and replaces one trigger function; existing data is
-- not changed. Safe to apply on top of 001-011.

-- Internal comments of staff on an order. Never returned by customer API.
CREATE TABLE IF NOT EXISTS order_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND btrim(body) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS order_comments_order_idx
  ON order_comments(order_id, created_at DESC);

-- Admin order list: newest first, date range filter, optional status filter.
-- (integration_status, created_at) already exists (001).
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders(status, created_at DESC);

-- Same rows as in 005, plus actor and comment of a staff status change.
-- AdminOrderService sets both values with set_config(..., true) (transaction
-- local) right before its UPDATE and clears them right after. Checkout, 1C
-- status sync and other writers never set them, so their rows keep
-- actor_user_id and comment NULL, exactly as before. A value that is not a
-- UUID is ignored instead of failing the status change.
CREATE OR REPLACE FUNCTION record_order_status_history() RETURNS TRIGGER AS $$
DECLARE
  actor_setting TEXT := NULLIF(current_setting('apex.order_status_actor', true), '');
  comment_setting TEXT := NULLIF(btrim(COALESCE(current_setting('apex.order_status_comment', true), '')), '');
  actor_id UUID;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF actor_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      actor_id := actor_setting::uuid;
    END IF;
    INSERT INTO order_status_history(order_id, status, actor_user_id, comment)
    VALUES (NEW.id, NEW.status, actor_id, LEFT(comment_setting, 2000));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

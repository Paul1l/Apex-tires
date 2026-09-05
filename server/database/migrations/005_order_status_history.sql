CREATE OR REPLACE FUNCTION record_order_status_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO order_status_history(order_id, status) VALUES (NEW.id, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_status_history_trigger AFTER INSERT OR UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION record_order_status_history();

CREATE INDEX IF NOT EXISTS products_brand_search_idx ON products USING GIN (LOWER(brand) gin_trgm_ops);

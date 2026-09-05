CREATE TABLE inventory_reservations (
  order_id UUID NOT NULL REFERENCES orders(id),
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','consumed','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(order_id, product_id, warehouse_id)
);
CREATE INDEX inventory_reservations_expiry_idx ON inventory_reservations(expires_at,order_id) WHERE status='active';
CREATE INDEX inventory_reservations_product_idx ON inventory_reservations(product_id,warehouse_id) WHERE status='active';

CREATE OR REPLACE FUNCTION finalize_order_reservations() RETURNS TRIGGER AS $$
DECLARE hold RECORD;
BEGIN
  IF NEW.status NOT IN ('new','cancelled') AND NEW.status IS DISTINCT FROM OLD.status
    AND EXISTS(SELECT 1 FROM inventory_reservations WHERE order_id=NEW.id
      AND (status='expired' OR (status='active' AND expires_at <= NOW()))) THEN
    RAISE EXCEPTION 'ORDER_RESERVATION_EXPIRED';
  END IF;
  IF NEW.status IN ('cancelled','completed','shipped') AND NEW.status IS DISTINCT FROM OLD.status THEN
    FOR hold IN SELECT * FROM inventory_reservations WHERE order_id=NEW.id AND status='active'
      ORDER BY product_id,warehouse_id FOR UPDATE LOOP
      UPDATE inventories SET reserved=reserved-hold.quantity,
        quantity=quantity-CASE WHEN NEW.status='cancelled' THEN 0 ELSE hold.quantity END,updated_at=NOW()
        WHERE product_id=hold.product_id AND warehouse_id=hold.warehouse_id;
      UPDATE inventory_reservations SET status=CASE WHEN NEW.status='cancelled' THEN 'released' ELSE 'consumed' END,updated_at=NOW()
        WHERE order_id=hold.order_id AND product_id=hold.product_id AND warehouse_id=hold.warehouse_id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER orders_finalize_reservations AFTER UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION finalize_order_reservations();

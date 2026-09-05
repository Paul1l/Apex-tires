import type { Pool } from "pg";
import { withTransaction } from "../database/postgres-client";

export async function releaseExpiredReservations(pool: Pool, limit = 100): Promise<number> {
  return withTransaction(pool, async (database) => {
    const orders = await database.query<{ id: string }>(
      `SELECT id FROM orders WHERE EXISTS (
         SELECT 1 FROM inventory_reservations WHERE order_id=orders.id AND status='active' AND expires_at <= NOW()
       ) ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [Math.min(100,limit)],
    );
    for (const order of orders.rows) {
      const holds = await database.query<{ product_id: string; warehouse_id: string; quantity: number }>(
        "SELECT product_id,warehouse_id,quantity FROM inventory_reservations WHERE order_id=$1 AND status='active' AND expires_at <= NOW() ORDER BY product_id,warehouse_id FOR UPDATE", [order.id],
      );
      for (const hold of holds.rows) {
        await database.query("UPDATE inventories SET reserved=reserved-$3,updated_at=NOW() WHERE product_id=$1 AND warehouse_id=$2", [hold.product_id,hold.warehouse_id,hold.quantity]);
        await database.query("UPDATE inventory_reservations SET status='expired',updated_at=NOW() WHERE order_id=$1 AND product_id=$2 AND warehouse_id=$3", [order.id,hold.product_id,hold.warehouse_id]);
      }
    }
    return orders.rows.length;
  });
}

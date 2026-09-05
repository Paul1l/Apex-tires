import type { DatabaseExecutor } from "../types/common";

export interface PersistedCartLine {
  productId: string;
  quantity: number;
}

export class CartRepository {
  async listForUser(
    database: DatabaseExecutor,
    userId: string,
  ): Promise<PersistedCartLine[]> {
    const result = await database.query<{ product_id: string; quantity: number }>(
      `SELECT shopping_cart_items.product_id, shopping_cart_items.quantity
       FROM shopping_carts
       INNER JOIN shopping_cart_items
         ON shopping_cart_items.cart_id = shopping_carts.id
       INNER JOIN products ON products.id = shopping_cart_items.product_id
       WHERE shopping_carts.user_id = $1 AND products.is_active = TRUE
       ORDER BY shopping_cart_items.created_at`,
      [userId],
    );
    return result.rows.map((row) => ({
      productId: row.product_id,
      quantity: row.quantity,
    }));
  }

  async findActiveProductIds(
    database: DatabaseExecutor,
    productIds: string[],
  ): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    const result = await database.query<{ id: string }>(
      "SELECT id FROM products WHERE id = ANY($1::uuid[]) AND is_active = TRUE",
      [productIds],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  async replaceForUser(
    database: DatabaseExecutor,
    userId: string,
    items: PersistedCartLine[],
  ): Promise<void> {
    const cartResult = await database.query<{ id: string }>(
      `INSERT INTO shopping_carts (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [userId],
    );
    const cartId = cartResult.rows[0].id;
    await database.query("DELETE FROM shopping_cart_items WHERE cart_id = $1", [cartId]);
    for (const item of items) {
      await database.query(
        `INSERT INTO shopping_cart_items (cart_id, product_id, quantity)
         VALUES ($1, $2, $3)`,
        [cartId, item.productId, item.quantity],
      );
    }
  }
}

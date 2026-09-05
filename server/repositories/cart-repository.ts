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

  async listForAnonymous(database: DatabaseExecutor, anonymousSessionHash: string): Promise<PersistedCartLine[]> {
    const result = await database.query<{ product_id: string; quantity: number }>(
      `SELECT shopping_cart_items.product_id, shopping_cart_items.quantity
       FROM shopping_carts JOIN shopping_cart_items ON shopping_cart_items.cart_id=shopping_carts.id
       JOIN products ON products.id=shopping_cart_items.product_id
       WHERE shopping_carts.anonymous_session_hash=$1 AND products.is_active=TRUE
       ORDER BY shopping_cart_items.created_at`,
      [anonymousSessionHash],
    );
    return result.rows.map((row) => ({ productId: row.product_id, quantity: row.quantity }));
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
    await this.replaceItems(database, cartId, items);
  }

  async replaceForAnonymous(
    database: DatabaseExecutor,
    anonymousSessionHash: string,
    items: PersistedCartLine[],
  ): Promise<void> {
    const cartResult = await database.query<{ id: string }>(
      `INSERT INTO shopping_carts(anonymous_session_hash) VALUES($1)
       ON CONFLICT(anonymous_session_hash) WHERE anonymous_session_hash IS NOT NULL
       DO UPDATE SET updated_at=NOW() RETURNING id`,
      [anonymousSessionHash],
    );
    await this.replaceItems(database, cartResult.rows[0].id, items);
  }

  async mergeAnonymousIntoUser(
    database: DatabaseExecutor,
    anonymousSessionHash: string,
    userId: string,
  ): Promise<void> {
    // Both merge and guest writes lock the guest row first, preventing duplicate merges.
    await database.query("SELECT id FROM shopping_carts WHERE anonymous_session_hash=$1 FOR UPDATE", [anonymousSessionHash]);
    const anonymousItems = await this.listForAnonymous(database, anonymousSessionHash);
    if (anonymousItems.length === 0) return;
    const userItems = await this.listForUser(database, userId);
    const quantities = new Map<string, number>();
    for (const item of [...userItems, ...anonymousItems]) {
      quantities.set(item.productId, Math.min(100, (quantities.get(item.productId) ?? 0) + item.quantity));
    }
    await this.replaceForUser(database, userId, Array.from(quantities, ([productId, quantity]) => ({ productId, quantity })));
    await database.query("DELETE FROM shopping_carts WHERE anonymous_session_hash=$1", [anonymousSessionHash]);
  }

  private async replaceItems(database: DatabaseExecutor, cartId: string, items: PersistedCartLine[]): Promise<void> {
    await database.query("DELETE FROM shopping_cart_items WHERE cart_id = $1", [cartId]);
    if (items.length === 0) return;
    await database.query(
      `INSERT INTO shopping_cart_items(cart_id,product_id,quantity)
       SELECT $1, item.product_id, item.quantity
       FROM jsonb_to_recordset($2::jsonb) AS item(product_id uuid, quantity integer)`,
      [cartId, JSON.stringify(items.map((item) => ({ product_id: item.productId, quantity: item.quantity })))],
    );
  }
}

import { storeDateRange } from "../../lib/admin/order-dates";
import type { DatabaseExecutor } from "../types/common";
import type { AdminOrderListQuery } from "../validators/admin-order-schema";

/**
 * Read and write queries of the admin order screens. Every value from a
 * request goes into a bind parameter; the SQL text contains only fixed
 * fragments and parameter numbers.
 */

export interface SqlCondition {
  /** "WHERE …" or "" */
  clause: string;
  values: unknown[];
}

/** Escape character of LIKE patterns built here (not a backslash: independent of string settings). */
export const LIKE_ESCAPE_CHARACTER = "!";

/** Makes %, _ and the escape character match literally in a LIKE pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[!%_]/g, (character) => `${LIKE_ESCAPE_CHARACTER}${character}`);
}

/**
 * Digits to look for in customer_phone (stored as +7XXXXXXXXXX), or null when
 * the query does not look like a phone number. "8 913 …" is read as "+7 913 …".
 */
export function phoneSearchDigits(query: string): string | null {
  if (!/^[\d\s()+\-.]+$/.test(query)) return null;
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
}

export type AdminOrderListFilters = Pick<
  AdminOrderListQuery,
  "q" | "status" | "integrationStatus" | "from" | "to"
>;

/**
 * WHERE clause of the admin order list: search by order number, customer
 * name, email (substring, case-insensitive) and phone digits; filters by
 * status, 1C transfer status and store-time day range [from, to].
 */
export function buildAdminOrderListCondition(filters: AdminOrderListFilters): SqlCondition {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const parameter = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.status) conditions.push(`orders.status = ${parameter(filters.status)}`);
  if (filters.integrationStatus) {
    conditions.push(`orders.integration_status = ${parameter(filters.integrationStatus)}`);
  }
  const range = storeDateRange(filters.from, filters.to);
  if (range.start) {
    conditions.push(`orders.created_at >= ${parameter(range.start.toISOString())}::timestamptz`);
  }
  if (range.end) {
    conditions.push(`orders.created_at < ${parameter(range.end.toISOString())}::timestamptz`);
  }

  const query = filters.q?.trim();
  if (query) {
    const pattern = parameter(`%${escapeLikePattern(query)}%`);
    const escape = `ESCAPE '${LIKE_ESCAPE_CHARACTER}'`;
    const alternatives = [
      `orders.number ILIKE ${pattern} ${escape}`,
      `orders.customer_name ILIKE ${pattern} ${escape}`,
      `orders.customer_email ILIKE ${pattern} ${escape}`,
    ];
    const digits = phoneSearchDigits(query);
    if (digits) alternatives.push(`orders.customer_phone LIKE ${parameter(`%${digits}%`)}`);
    conditions.push(`(${alternatives.join(" OR ")})`);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
  };
}

export interface AdminOrderListRow {
  id: string;
  number: string;
  status: string;
  payment_status: string;
  integration_status: string;
  total_kopecks: number | string;
  delivery_method: string;
  created_at: Date | string;
  customer_name: string;
  customer_phone: string;
}

export interface AdminOrderListItemRow {
  order_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  total_kopecks: number | string;
}

export interface AdminOrderRow {
  id: string;
  number: string;
  status: string;
  payment_status: string;
  user_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string;
  subtotal_kopecks: number | string;
  discount_kopecks: number | string;
  delivery_kopecks: number | string;
  total_kopecks: number | string;
  delivery_method: string;
  delivery_address: string | null;
  comment: string | null;
  requires_tire_service: boolean;
  integration_status: string;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: Date | string | null;
  synced_at: Date | string | null;
  external_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AdminOrderItemRow {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_kopecks: number | string;
  discount_kopecks: number | string;
  total_kopecks: number | string;
  catalog_product_id: string | null;
  product_kind: string | null;
  product_slug: string | null;
  product_is_active: boolean | null;
}

export interface AdminOrderHistoryRow {
  id: string;
  status: string;
  actor_user_id: string | null;
  actor_name: string | null;
  comment: string | null;
  created_at: Date | string;
}

export interface AdminOrderReservationRow {
  status: string;
  expired: boolean;
  expires_at: Date | string;
}

export interface AdminOrderQueueRow {
  status: string;
  retry_count: number;
  next_attempt_at: Date | string | null;
  last_error: string | null;
}

export interface LockedOrderRow {
  id: string;
  number: string;
  status: string;
  payment_status: string;
  customer_email: string | null;
}

export class AdminOrderRepository {
  async countOrders(database: DatabaseExecutor, filters: AdminOrderListFilters): Promise<number> {
    const condition = buildAdminOrderListCondition(filters);
    const result = await database.query<{ total: number }>(
      `SELECT COUNT(*)::integer AS total FROM orders ${condition.clause}`,
      condition.values,
    );
    return result.rows[0]?.total ?? 0;
  }

  async listOrders(
    database: DatabaseExecutor,
    filters: AdminOrderListFilters,
    page: { limit: number; offset: number },
  ): Promise<Array<AdminOrderListRow & { items: AdminOrderListItemRow[] }>> {
    const condition = buildAdminOrderListCondition(filters);
    const limitParameter = condition.values.length + 1;
    const ordersResult = await database.query<AdminOrderListRow>(
      `SELECT orders.id, orders.number, orders.status, orders.payment_status,
              orders.integration_status, orders.total_kopecks, orders.delivery_method,
              orders.created_at, orders.customer_name, orders.customer_phone
       FROM orders
       ${condition.clause}
       ORDER BY orders.created_at DESC, orders.id DESC
       LIMIT $${limitParameter} OFFSET $${limitParameter + 1}`,
      [...condition.values, page.limit, page.offset],
    );
    if (ordersResult.rows.length === 0) return [];
    const itemsResult = await database.query<AdminOrderListItemRow>(
      `SELECT order_id, product_name, sku, quantity, total_kopecks
       FROM order_items
       WHERE order_id = ANY($1::uuid[])
       ORDER BY order_id, id`,
      [ordersResult.rows.map((order) => order.id)],
    );
    const itemsByOrder = new Map<string, AdminOrderListItemRow[]>();
    for (const item of itemsResult.rows) {
      const items = itemsByOrder.get(item.order_id) ?? [];
      items.push(item);
      itemsByOrder.set(item.order_id, items);
    }
    return ordersResult.rows.map((order) => ({
      ...order,
      items: itemsByOrder.get(order.id) ?? [],
    }));
  }

  async findOrder(database: DatabaseExecutor, orderId: string): Promise<AdminOrderRow | null> {
    const result = await database.query<AdminOrderRow>(
      `SELECT id, number, status, payment_status, user_id, customer_name,
              customer_email, customer_phone, subtotal_kopecks, discount_kopecks,
              delivery_kopecks, total_kopecks, delivery_method, delivery_address,
              comment, requires_tire_service, integration_status, retry_count,
              last_error, last_attempt_at, synced_at, external_id, created_at,
              updated_at
       FROM orders
       WHERE id = $1`,
      [orderId],
    );
    return result.rows[0] ?? null;
  }

  async listItems(database: DatabaseExecutor, orderId: string): Promise<AdminOrderItemRow[]> {
    const result = await database.query<AdminOrderItemRow>(
      `SELECT order_items.id, order_items.product_id, order_items.sku,
              order_items.product_name, order_items.quantity,
              order_items.unit_price_kopecks, order_items.discount_kopecks,
              order_items.total_kopecks,
              products.id AS catalog_product_id, products.kind AS product_kind,
              products.slug AS product_slug, products.is_active AS product_is_active
       FROM order_items
       LEFT JOIN products ON products.id = order_items.product_id
       WHERE order_items.order_id = $1
       ORDER BY order_items.id`,
      [orderId],
    );
    return result.rows;
  }

  async listStatusHistory(database: DatabaseExecutor, orderId: string): Promise<AdminOrderHistoryRow[]> {
    const result = await database.query<AdminOrderHistoryRow>(
      `SELECT history.id, history.status, history.actor_user_id,
              users.name AS actor_name, history.comment, history.created_at
       FROM order_status_history history
       LEFT JOIN users ON users.id = history.actor_user_id
       WHERE history.order_id = $1
       ORDER BY history.created_at DESC, history.id DESC
       LIMIT 200`,
      [orderId],
    );
    return result.rows;
  }

  async listReservations(
    database: DatabaseExecutor,
    orderId: string,
  ): Promise<AdminOrderReservationRow[]> {
    const result = await database.query<AdminOrderReservationRow>(
      `SELECT status,
              (status = 'expired' OR (status = 'active' AND expires_at <= NOW())) AS expired,
              expires_at
       FROM inventory_reservations
       WHERE order_id = $1`,
      [orderId],
    );
    return result.rows;
  }

  async findQueueItem(database: DatabaseExecutor, orderId: string): Promise<AdminOrderQueueRow | null> {
    const result = await database.query<AdminOrderQueueRow>(
      `SELECT status, retry_count, next_attempt_at, last_error
       FROM integration_queue
       WHERE source_system = '1c' AND entity_type = 'order' AND entity_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [orderId],
    );
    return result.rows[0] ?? null;
  }

  /** Locks the order row for a status or payment change (inside a transaction). */
  async lockOrder(database: DatabaseExecutor, orderId: string): Promise<LockedOrderRow | null> {
    const result = await database.query<LockedOrderRow>(
      `SELECT id, number, status, payment_status, customer_email
       FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    return result.rows[0] ?? null;
  }

  /** Same check as before T21c: an expired hold allows only "new" and "cancelled". */
  async hasExpiredReservation(database: DatabaseExecutor, orderId: string): Promise<boolean> {
    const result = await database.query(
      `SELECT 1 FROM inventory_reservations
       WHERE order_id = $1
         AND (status = 'expired' OR (status = 'active' AND expires_at <= NOW()))
       LIMIT 1`,
      [orderId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Actor and comment for the order_status_history row that the status
   * trigger writes (migration 012). Transaction-local: must run inside the
   * transaction of the status UPDATE; clearStatusChangeContext() resets it.
   */
  async setStatusChangeContext(
    database: DatabaseExecutor,
    context: { actorUserId: string; comment: string | null },
  ): Promise<void> {
    await database.query(
      `SELECT set_config('apex.order_status_actor', $1, true),
              set_config('apex.order_status_comment', $2, true)`,
      [context.actorUserId, context.comment ?? ""],
    );
  }

  async clearStatusChangeContext(database: DatabaseExecutor): Promise<void> {
    await database.query(
      `SELECT set_config('apex.order_status_actor', '', true),
              set_config('apex.order_status_comment', '', true)`,
    );
  }

  async updatePaymentStatus(
    database: DatabaseExecutor,
    orderId: string,
    paymentStatus: string,
  ): Promise<boolean> {
    const result = await database.query(
      `UPDATE orders SET payment_status = $2, updated_at = NOW() WHERE id = $1`,
      [orderId, paymentStatus],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

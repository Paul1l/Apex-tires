import type { DatabaseExecutor, JsonValue } from "../types/common";
import type {
  CreateOrderInput,
} from "../validators/order-schemas";
import type { OrderStatusSyncItem } from "../validators/one-c-schemas";
import { formatOrderNumber } from "../services/order-number-service";

export interface CreatedOrderRow {
  id: string;
  number: string;
  status: string;
  integration_status: "pending" | "processing" | "synced" | "failed";
  total_kopecks: number | string;
  created_at: Date | string;
}

export interface CheckoutProductRow {
  id: string;
  sku: string;
  name: string;
  is_active: boolean;
  amount_kopecks: number | string | null;
  available: number;
  product_attributes?: JsonValue;
}

export interface NormalizedOrderItem {
  productId: string;
  quantity: number;
  sku: string;
  name: string;
  unitPriceKopecks: number;
  totalKopecks: number;
  productAttributes: JsonValue;
}

export interface PersistedOrderInput extends Omit<CreateOrderInput, "items"> {
  items: NormalizedOrderItem[];
  subtotalKopecks: number;
  deliveryKopecks: number;
  totalKopecks: number;
  managerNotificationEmail?: string;
  userId?: string;
  requesterAddress?: string | null;
  userAgent?: string | null;
  stockReservations?: StockReservation[];
}

export interface StockReservation { productId: string; warehouseId: string; quantity: number; }

interface IntegrationOrderItemRow {
  order_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_kopecks: number | string;
  discount_kopecks: number | string;
  total_kopecks: number | string;
}

export interface IntegrationOrderRow {
  id: string;
  number: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string;
  status: string;
  payment_status: string;
  subtotal_kopecks: number | string;
  discount_kopecks: number | string;
  delivery_kopecks: number | string;
  total_kopecks: number | string;
  delivery_method: string;
  delivery_address: string | null;
  comment: string | null;
  requires_tire_service: boolean;
  created_at: Date | string;
  items: IntegrationOrderItemRow[];
}

export interface IntegrationQueueItem {
  id: string;
  idempotency_key: string;
  payload: JsonValue;
}

export type IntegrationStatusCounts = Record<string, number>;

export interface AccountOrderItemRow {
  order_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  total_kopecks: number | string;
}

export interface AccountOrderRow {
  id: string;
  number: string;
  status: string;
  payment_status: string;
  total_kopecks: number | string;
  delivery_method: string;
  created_at: Date | string;
  items: AccountOrderItemRow[];
}

export class OrderRepository {
  async updateStatus(
    database: DatabaseExecutor,
    orderId: string,
    status: string,
    paymentStatus?: string,
  ): Promise<boolean> {
    const result = await database.query(
      `UPDATE orders
       SET status = $2,
           payment_status = COALESCE($3, payment_status),
           updated_at = NOW()
       WHERE id = $1`,
      [orderId, status, paymentStatus ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listForUser(
    database: DatabaseExecutor,
    userId: string,
    limit = 50,
  ): Promise<AccountOrderRow[]> {
    const ordersResult = await database.query<Omit<AccountOrderRow, "items">>(
      `SELECT id, number, status, payment_status, total_kopecks,
              delivery_method, created_at
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    if (ordersResult.rows.length === 0) return [];
    const itemsResult = await database.query<AccountOrderItemRow>(
      `SELECT order_id, product_name, sku, quantity, total_kopecks
       FROM order_items
       WHERE order_id = ANY($1::uuid[])
       ORDER BY id`,
      [ordersResult.rows.map((order) => order.id)],
    );
    const itemsByOrder = new Map<string, AccountOrderItemRow[]>();
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

  async listForAdministration(
    database: DatabaseExecutor,
    limit = 100,
  ): Promise<AccountOrderRow[]> {
    const ordersResult = await database.query<Omit<AccountOrderRow, "items">>(
      `SELECT id, number, status, payment_status, total_kopecks,
              delivery_method, created_at
       FROM orders
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    if (ordersResult.rows.length === 0) return [];
    const itemsResult = await database.query<AccountOrderItemRow>(
      `SELECT order_id, product_name, sku, quantity, total_kopecks
       FROM order_items
       WHERE order_id = ANY($1::uuid[])
       ORDER BY id`,
      [ordersResult.rows.map((order) => order.id)],
    );
    const itemsByOrder = new Map<string, AccountOrderItemRow[]>();
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

  async getDeliveryPriceKopecks(
    database: DatabaseExecutor,
    deliveryMethod: CreateOrderInput["delivery"]["method"],
  ): Promise<number> {
    const settingKey = `delivery_${deliveryMethod}_price_kopecks`;
    const result = await database.query<{ value: unknown }>(
      "SELECT value FROM store_settings WHERE key = $1",
      [settingKey],
    );
    const configuredPrice = result.rows[0]?.value;
    if (typeof configuredPrice !== "number" || !Number.isInteger(configuredPrice)) {
      throw new Error("DELIVERY_PRICE_NOT_CONFIGURED");
    }
    return configuredPrice;
  }

  async findByCheckoutIdempotencyKey(
    database: DatabaseExecutor,
    idempotencyKey: string,
  ): Promise<CreatedOrderRow | null> {
    const result = await database.query<CreatedOrderRow>(
      `SELECT id, number, status, integration_status, total_kopecks, created_at
       FROM orders
       WHERE checkout_idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async lockProductsForCheckout(
    database: DatabaseExecutor,
    productIds: string[],
  ): Promise<CheckoutProductRow[]> {
    const result = await database.query<CheckoutProductRow>(
      `SELECT
         products.id,
         products.sku,
         products.name,
         products.is_active,
         jsonb_build_object('kind', products.kind, 'condition', products.condition,
           'brand', products.brand, 'model', products.model,
           'tire', (SELECT to_jsonb(t) - 'product_id' FROM tire_specs t WHERE t.product_id=products.id),
           'wheel', (SELECT to_jsonb(w) - 'product_id' FROM wheel_specs w WHERE w.product_id=products.id)) AS product_attributes,
         prices.amount_kopecks,
         COALESCE((
           SELECT SUM(inventories.quantity - inventories.reserved)
           FROM inventories
           JOIN warehouses ON warehouses.id=inventories.warehouse_id
           WHERE inventories.product_id = products.id AND warehouses.is_active
         ), 0)::integer AS available
       FROM products
       LEFT JOIN prices
         ON prices.product_id = products.id AND prices.price_type = 'retail'
       WHERE products.id = ANY($1::uuid[])
       ORDER BY products.id FOR UPDATE OF products`,
      [productIds],
    );
    return result.rows;
  }

  async create(
    database: DatabaseExecutor,
    order: PersistedOrderInput,
  ): Promise<CreatedOrderRow> {
    const sequenceResult = await database.query<{ value: string | number }>(
      "SELECT nextval('order_number_sequence') AS value",
    );
    const orderNumber = formatOrderNumber(sequenceResult.rows[0].value);
    const orderResult = await database.query<CreatedOrderRow>(
      `INSERT INTO orders (
         number, user_id, checkout_idempotency_key, customer_name, customer_email,
         customer_phone, subtotal_kopecks, discount_kopecks, delivery_kopecks,
         total_kopecks, delivery_method, delivery_address, comment,
         requires_tire_service
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13)
       RETURNING id, number, status, integration_status, total_kopecks, created_at`,
      [
        orderNumber,
        order.userId ?? null,
        order.idempotencyKey,
        order.customer.name,
        order.customer.email ?? null,
        order.customer.phone,
        order.subtotalKopecks,
        order.deliveryKopecks,
        order.totalKopecks,
        order.delivery.method,
        order.delivery.address ?? null,
        order.comment ?? null,
        order.requiresTireService,
      ],
    );
    const createdOrder = orderResult.rows[0];
    const reservationHours = Number(process.env.ORDER_RESERVATION_TTL_HOURS || 24);
    if (!Number.isFinite(reservationHours) || reservationHours < 1 || reservationHours > 168) throw new Error("Invalid ORDER_RESERVATION_TTL_HOURS");
    for (const reservation of order.stockReservations ?? []) {
      await database.query(`INSERT INTO inventory_reservations(order_id,product_id,warehouse_id,quantity,expires_at)
        VALUES($1,$2,$3,$4,NOW()+make_interval(hours=>$5))`,
      [createdOrder.id,reservation.productId,reservation.warehouseId,reservation.quantity,Math.floor(reservationHours)]);
    }

    for (const documentSlug of ["offer", "personal-data-consent"]) {
      await database.query(
        `INSERT INTO consents (
           user_id, purpose, document_slug, document_version,
           ip_address, user_agent, source
         ) VALUES ($1, 'checkout', $2, '2026-07-31', $3, $4, $5)`,
        [
          order.userId ?? null,
          documentSlug,
          order.requesterAddress ?? null,
          order.userAgent ?? null,
          `checkout:${createdOrder.id}`,
        ],
      );
    }

    for (const item of order.items) {
      await database.query(
        `INSERT INTO order_items (
           order_id, product_id, sku, product_name, quantity,
           unit_price_kopecks, total_kopecks, product_attributes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          createdOrder.id,
          item.productId,
          item.sku,
          item.name,
          item.quantity,
          item.unitPriceKopecks,
          item.totalKopecks,
          JSON.stringify(item.productAttributes),
        ],
      );
    }

    const integrationPayload = {
      siteOrderId: createdOrder.id,
      orderNumber: createdOrder.number,
      createdAt: createdOrder.created_at,
      customer: order.customer,
      items: order.items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
        price: item.unitPriceKopecks / 100,
        discount: 0,
      })),
      subtotal: order.subtotalKopecks / 100,
      discount: 0,
      deliveryPrice: order.deliveryKopecks / 100,
      total: order.totalKopecks / 100,
      delivery: order.delivery,
      requiresTireService: order.requiresTireService,
      comment: order.comment ?? null,
      status: "new",
      paymentStatus: "pending",
    };

    await database.query(
      `INSERT INTO integration_queue (
         source_system, entity_type, entity_id, operation, idempotency_key, payload
       ) VALUES ('1c', 'order', $1, 'send_order', $2, $3::jsonb)`,
      [
        createdOrder.id,
        `order:${createdOrder.id}`,
        JSON.stringify(integrationPayload),
      ],
    );

    if (order.customer.email) {
      await database.query(
        `INSERT INTO notification_outbox (channel, template, recipient, payload)
         VALUES ('email', 'customer-order-created', $1, $2::jsonb)`,
        [
          order.customer.email,
          JSON.stringify({
            orderId: createdOrder.id,
            orderNumber: createdOrder.number,
          }),
        ],
      );
    }
    if (order.managerNotificationEmail) {
      await database.query(
        `INSERT INTO notification_outbox (channel, template, recipient, payload)
         VALUES ('email', 'manager-order-created', $1, $2::jsonb)`,
        [
          order.managerNotificationEmail,
          JSON.stringify({
            orderId: createdOrder.id,
            orderNumber: createdOrder.number,
          }),
        ],
      );
    }

    return createdOrder;
  }

  async reserveStock(
    database: DatabaseExecutor,
    productId: string,
    requestedQuantity: number,
  ): Promise<StockReservation[]> {
    const allocations: StockReservation[] = [];
    const inventoryResult = await database.query<{
      product_id: string;
      warehouse_id: string;
      quantity: number;
      reserved: number;
    }>(
      `SELECT product_id, warehouse_id, quantity, reserved
       FROM inventories
       WHERE product_id = $1 AND quantity > reserved
         AND warehouse_id IN (SELECT id FROM warehouses WHERE is_active)
       ORDER BY (quantity - reserved) DESC, warehouse_id
       FOR UPDATE`,
      [productId],
    );
    let remainingQuantity = requestedQuantity;

    for (const inventory of inventoryResult.rows) {
      if (remainingQuantity === 0) break;
      const available = inventory.quantity - inventory.reserved;
      const allocated = Math.min(available, remainingQuantity);
      await database.query(
        `UPDATE inventories
         SET reserved = reserved + $3, updated_at = NOW()
         WHERE product_id = $1 AND warehouse_id = $2`,
        [productId, inventory.warehouse_id, allocated],
      );
      remainingQuantity -= allocated;
      allocations.push({ productId, warehouseId: inventory.warehouse_id, quantity: allocated });
    }

    if (remainingQuantity > 0) {
      throw new Error("INSUFFICIENT_STOCK");
    }
    return allocations;
  }

  async getOrdersForIntegration(
    database: DatabaseExecutor,
    limit: number,
  ): Promise<IntegrationOrderRow[]> {
    const orderResult = await database.query<Omit<IntegrationOrderRow, "items">>(
      `SELECT id, number, customer_name, customer_email, customer_phone,
              status, payment_status, subtotal_kopecks, discount_kopecks,
              delivery_kopecks, total_kopecks, delivery_method,
              delivery_address, comment, requires_tire_service, created_at
       FROM orders
       WHERE integration_status IN ('pending', 'failed')
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit],
    );
    const orderIds = orderResult.rows.map((order) => order.id);
    if (orderIds.length === 0) return [];

    const itemResult = await database.query<IntegrationOrderItemRow>(
      `SELECT order_id, sku, product_name, quantity, unit_price_kopecks,
              discount_kopecks, total_kopecks
       FROM order_items
       WHERE order_id = ANY($1::uuid[])
       ORDER BY id`,
      [orderIds],
    );
    const itemsByOrderId = new Map<string, IntegrationOrderItemRow[]>();
    for (const item of itemResult.rows) {
      const items = itemsByOrderId.get(item.order_id) ?? [];
      items.push(item);
      itemsByOrderId.set(item.order_id, items);
    }

    return orderResult.rows.map((order) => ({
      ...order,
      items: itemsByOrderId.get(order.id) ?? [],
    }));
  }

  async updateFromOneC(
    database: DatabaseExecutor,
    orderStatus: OrderStatusSyncItem,
  ): Promise<void> {
    const result = await database.query(
      `UPDATE orders
       SET external_id = $1, status = $2, payment_status = $3,
           integration_status = 'synced', last_error = NULL,
           synced_at = NOW(), updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [
        orderStatus.externalOrderId,
        orderStatus.status,
        orderStatus.paymentStatus,
        orderStatus.siteOrderId,
      ],
    );
    if (result.rowCount === 0) throw new Error("ORDER_NOT_FOUND");
  }

  async claimNextQueueItem(
    database: DatabaseExecutor,
  ): Promise<IntegrationQueueItem | null> {
    const result = await database.query<IntegrationQueueItem>(
      `WITH selected AS (
         SELECT id
         FROM integration_queue
         WHERE source_system = '1c'
           AND entity_type = 'order'
           AND (
             (status IN ('pending', 'failed') AND next_attempt_at <= NOW())
             OR (
               status = 'processing'
               AND last_attempt_at < NOW() - INTERVAL '15 minutes'
             )
           )
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE integration_queue queue
       SET status = 'processing', last_attempt_at = NOW(), updated_at = NOW()
       FROM selected
       WHERE queue.id = selected.id
       RETURNING queue.*`,
    );
    const queueItem = result.rows[0] ?? null;
    if (queueItem) {
      await database.query(
        `UPDATE orders
         SET integration_status = 'processing', last_attempt_at = NOW(),
             updated_at = NOW()
         WHERE id = (SELECT entity_id FROM integration_queue WHERE id = $1)`,
        [queueItem.id],
      );
    }
    return queueItem;
  }

  async markQueueItemSynced(
    database: DatabaseExecutor,
    queueItemId: string,
    externalOrderId?: string,
  ): Promise<void> {
    await database.query(
      `UPDATE integration_queue
       SET status = 'synced', synced_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [queueItemId],
    );
    await database.query(
      `UPDATE orders
       SET integration_status = 'synced', external_id = COALESCE($2, external_id),
           synced_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE id = (SELECT entity_id FROM integration_queue WHERE id = $1)`,
      [queueItemId, externalOrderId ?? null],
    );
  }

  async markQueueItemFailed(
    database: DatabaseExecutor,
    queueItemId: string,
    safeMessage: string,
  ): Promise<void> {
    await database.query(
      `UPDATE integration_queue
       SET status = 'failed', retry_count = retry_count + 1,
           next_attempt_at = NOW() + LEAST(INTERVAL '1 hour', INTERVAL '1 minute' * POWER(2, retry_count)),
           last_error = $2, updated_at = NOW()
       WHERE id = $1`,
      [queueItemId, safeMessage],
    );
    await database.query(
      `UPDATE orders
       SET integration_status = 'failed', retry_count = retry_count + 1,
           last_error = $2, last_attempt_at = NOW(), updated_at = NOW()
       WHERE id = (SELECT entity_id FROM integration_queue WHERE id = $1)`,
      [queueItemId, safeMessage],
    );
  }

  async retryFailed(database: DatabaseExecutor): Promise<number> {
    const result = await database.query(
      `UPDATE integration_queue
       SET status = 'pending', next_attempt_at = NOW(), last_error = NULL,
           updated_at = NOW()
       WHERE source_system = '1c' AND entity_type = 'order' AND status = 'failed'`,
    );
    await database.query(
      `UPDATE orders
       SET integration_status = 'pending', last_error = NULL, updated_at = NOW()
       WHERE integration_status = 'failed'`,
    );
    return result.rowCount ?? 0;
  }

  async getIntegrationStatusCounts(
    database: DatabaseExecutor,
  ): Promise<IntegrationStatusCounts> {
    const result = await database.query<{
      integration_status: string;
      count: number;
    }>(
      `SELECT integration_status, COUNT(*)::integer AS count
       FROM orders
       GROUP BY integration_status`,
    );
    return Object.fromEntries(
      result.rows.map((row) => [row.integration_status, row.count]),
    );
  }
}

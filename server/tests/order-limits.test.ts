import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { CreatedOrderRow } from "../repositories/order-repository.js";
import { OrderService, type OrderServiceDependencies } from "../services/order-service.js";
import { ApplicationError } from "../utils/errors.js";
import { createOrderSchema, type CreateOrderInput } from "../validators/order-schemas.js";

const productId = "11111111-1111-4111-8111-111111111111";
const otherProductId = "22222222-2222-4222-8222-222222222222";

function orderPayload(items: Array<{ productId: string; quantity: number }>) {
  return {
    idempotencyKey: "k".repeat(16),
    customer: { name: "Bot", phone: "+79990000000", email: "Anyone@Example.org" },
    items,
    delivery: { method: "pickup" },
    offerAccepted: true,
    personalDataConsent: true,
  };
}

test("duplicate lines cannot exceed the per-product maximum after aggregation", () => {
  const flood = createOrderSchema.safeParse(
    orderPayload(Array.from({ length: 50 }, () => ({ productId, quantity: 20 }))),
  );
  assert.equal(flood.success, false);
  assert.equal(flood.error?.issues.filter((issue) => issue.path[0] === "items").length, 1);

  assert.equal(createOrderSchema.safeParse(orderPayload([{ productId, quantity: 12 }, { productId, quantity: 9 }])).success, false);
  assert.equal(createOrderSchema.safeParse(orderPayload([{ productId, quantity: 12 }, { productId, quantity: 8 }])).success, true);
  assert.equal(
    createOrderSchema.safeParse(orderPayload([{ productId, quantity: 20 }, { productId: otherProductId, quantity: 20 }])).success,
    true,
  );
});

function createService(options: { activeOrders?: number; maximumActiveReservationsPerContact?: number } = {}) {
  const database = { async query() { return { rows: [] }; }, release() {} };
  const pool = { async connect() { return database; } } as unknown as Pool;
  const contacts: Array<{ phone: string; email?: string | null }> = [];
  let created = 0;
  const orderRepository: OrderServiceDependencies["orderRepository"] = {
    async findByCheckoutIdempotencyKey() { return null; },
    async countActiveReservationOrdersForContact(_database, contact) {
      contacts.push(contact);
      return options.activeOrders ?? 0;
    },
    async lockProductsForCheckout(_database, ids) {
      return ids.map((id) => ({ id, sku: `SKU-${id.slice(0, 4)}`, name: "Шина", is_active: true, amount_kopecks: 1_000, available: 1_000 }));
    },
    async reserveStock() { return []; },
    async getDeliveryPriceKopecks() { return 0; },
    async listForUser() { return []; },
    async listForAdministration() { return []; },
    async create(): Promise<CreatedOrderRow> {
      created += 1;
      return { id: "o1", number: "AW-001001", status: "new", integration_status: "pending", total_kopecks: 0, created_at: "2026-10-10T00:00:00Z" };
    },
  };
  const service = new OrderService({
    pool,
    orderRepository,
    enabledDeliveryMethods: ["pickup"],
    maximumActiveReservationsPerContact: options.maximumActiveReservationsPerContact,
  });
  return { service, contacts, createdCount: () => created };
}

test("order service re-checks the aggregated quantity (defence in depth)", async () => {
  const { service, createdCount } = createService();
  const input = orderPayload([{ productId, quantity: 15 }, { productId, quantity: 15 }]) as CreateOrderInput;
  await assert.rejects(
    service.createOrder({ ...input, requiresTireService: false }),
    (error: unknown) => error instanceof ApplicationError && error.code === "VALIDATION_ERROR" && error.statusCode === 422,
  );
  assert.equal(createdCount(), 0);
});

test("checkout is refused when the contact already holds the maximum of active reservations", async () => {
  const blocked = createService({ activeOrders: 3 });
  const input = { ...(orderPayload([{ productId, quantity: 4 }]) as CreateOrderInput), requiresTireService: false };
  await assert.rejects(
    blocked.service.createOrder(input),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "ACTIVE_RESERVATIONS_LIMIT_EXCEEDED" &&
      error.statusCode === 429 &&
      /менеджера/.test(error.message),
  );
  assert.equal(blocked.createdCount(), 0);
  assert.deepEqual(blocked.contacts, [{ phone: "+79990000000", email: "Anyone@Example.org" }]);

  const allowed = createService({ activeOrders: 2 });
  await allowed.service.createOrder(input);
  assert.equal(allowed.createdCount(), 1);

  const configured = createService({ activeOrders: 3, maximumActiveReservationsPerContact: 5 });
  await configured.service.createOrder(input);
  assert.equal(configured.createdCount(), 1);
});

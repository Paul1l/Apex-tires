import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { CreatedOrderRow, PersistedOrderInput } from "../repositories/order-repository.js";
import { OrderService, type OrderServiceDependencies } from "../services/order-service.js";
import { hashCheckoutRequest } from "../services/checkout-request-hash.js";
import { ApplicationError } from "../utils/errors.js";
import type { CreateOrderInput } from "../validators/order-schemas.js";

const TIRE = "d5d4657d-9992-4b87-8b58-36af33ef5144";
const WHEEL = "0a8f3a61-7f8e-4a4b-9d42-4f3b7c2e9a10";

function order(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    idempotencyKey: "4f1c2d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    customer: { name: "Иван", phone: "+79123456789", email: "Ivan@Example.com" },
    items: [{ productId: TIRE, quantity: 4 }, { productId: WHEEL, quantity: 2 }],
    delivery: { method: "pickup" },
    requiresTireService: false,
    offerAccepted: true,
    personalDataConsent: true,
    ...overrides,
  };
}

test("request hash: the same order in another form gives the same value", () => {
  const base = hashCheckoutRequest(order());
  assert.match(base, /^[0-9a-f]{64}$/);
  // Line order, duplicate lines (merged at checkout), email and UUID case.
  assert.equal(hashCheckoutRequest(order({ items: [{ productId: WHEEL, quantity: 2 }, { productId: TIRE, quantity: 4 }] })), base);
  assert.equal(hashCheckoutRequest(order({ items: [{ productId: TIRE, quantity: 1 }, { productId: WHEEL, quantity: 2 }, { productId: TIRE.toUpperCase(), quantity: 3 }] })), base);
  assert.equal(hashCheckoutRequest(order({ customer: { name: "Иван", phone: "+79123456789", email: "ivan@example.com" } })), base);
  // The idempotency key itself is not part of the request.
  assert.equal(hashCheckoutRequest(order({ idempotencyKey: "another-key-0123456789" })), base);
});

test("request hash: any change of items, contacts or delivery gives another value", () => {
  const base = hashCheckoutRequest(order());
  const variants: Array<[string, Partial<CreateOrderInput>]> = [
    ["quantity", { items: [{ productId: TIRE, quantity: 3 }, { productId: WHEEL, quantity: 2 }] }],
    ["product", { items: [{ productId: TIRE, quantity: 4 }] }],
    ["name", { customer: { name: "Пётр", phone: "+79123456789", email: "ivan@example.com" } }],
    ["phone", { customer: { name: "Иван", phone: "+79123456780", email: "ivan@example.com" } }],
    ["email", { customer: { name: "Иван", phone: "+79123456789", email: "other@example.com" } }],
    ["no email", { customer: { name: "Иван", phone: "+79123456789" } }],
    ["delivery", { delivery: { method: "courier", address: "Барнаул, ул. Ленина, 1" } }],
    ["address", { delivery: { method: "pickup", address: "Барнаул" } }],
    ["tire service", { requiresTireService: true }],
    ["comment", { comment: "Позвоните заранее" }],
  ];
  const seen = new Set([base]);
  for (const [name, change] of variants) {
    const value = hashCheckoutRequest(order(change));
    assert.notEqual(value, base, name);
    assert.ok(!seen.has(value), `${name} collides with another variant`);
    seen.add(value);
  }
});

interface Scenario {
  /** Order already stored under the key, seen by the first lookup / inside the transaction. */
  stored?: (CreatedOrderRow & { checkout_request_hash: string | null }) | null;
  storedInsideTransaction?: (CreatedOrderRow & { checkout_request_hash: string | null }) | null;
}

function service(scenario: Scenario) {
  const created: PersistedOrderInput[] = [];
  let lookups = 0;
  const database = { async query() { return { rows: [] }; }, release() {}, on() {}, removeListener() {} };
  const orderRepository: OrderServiceDependencies["orderRepository"] = {
    async findByCheckoutIdempotencyKey() {
      lookups += 1;
      return (lookups === 1 ? scenario.stored : scenario.storedInsideTransaction) ?? null;
    },
    async countActiveReservationOrdersForContact() { return 0; },
    async lockProductsForCheckout(_database, productIds) {
      return productIds.map((id) => ({
        id, sku: `SKU-${id.slice(0, 4)}`, name: "Товар", kind: "tire" as const, brand: "Ikon", model: "M",
        width: 205, profile: 55, diameter: 16, pcd: null, is_active: true, amount_kopecks: 500_000, available: 20,
      }));
    },
    async reserveStock() { return []; },
    async getDeliveryPriceKopecks() { return 0; },
    async listForUser() { return []; },
    async listForAdministration() { return []; },
    async create(_database, input) {
      created.push(input);
      return { id: "new-order", number: "AW-2026-001001", status: "new", integration_status: "pending", total_kopecks: 0, created_at: new Date() };
    },
  };
  return {
    created,
    orderService: new OrderService({
      pool: { async connect() { return database; } } as unknown as Pool,
      orderRepository,
      enabledDeliveryMethods: ["pickup", "courier"],
      tireServiceEnabled: true,
    }),
  };
}

function storedOrder(hash: string | null) {
  return {
    id: "existing-order", number: "AW-2026-000900", status: "new", integration_status: "pending" as const,
    total_kopecks: 2_000_000, created_at: new Date(), checkout_request_hash: hash,
  };
}

function isKeyReused(error: unknown) {
  return error instanceof ApplicationError && error.code === "IDEMPOTENCY_KEY_REUSED" && error.statusCode === 409;
}

test("a new order stores the hash of its request", async () => {
  const { orderService, created } = service({});
  const result = await orderService.createOrder(order());
  assert.equal(result.id, "new-order");
  assert.equal(created[0].checkoutRequestHash, hashCheckoutRequest(order()));
});

test("same key, same request → the existing order (retry after a lost response)", async () => {
  const { orderService, created } = service({ stored: storedOrder(hashCheckoutRequest(order())) });
  const result = await orderService.createOrder(
    order({ items: [{ productId: WHEEL, quantity: 2 }, { productId: TIRE, quantity: 4 }] }),
  );
  assert.deepEqual([result.id, result.number, result.duplicate], ["existing-order", "AW-2026-000900", true]);
  assert.equal("checkout_request_hash" in result, false);
  assert.equal(created.length, 0);
});

test("same key, different request → 409 IDEMPOTENCY_KEY_REUSED, nothing created, order not disclosed", async () => {
  for (const change of [
    { customer: { name: "Иван", phone: "+79990000000" } },
    { items: [{ productId: TIRE, quantity: 8 }] },
    { delivery: { method: "courier" as const, address: "Барнаул, ул. Ленина, 1" } },
  ]) {
    const { orderService, created } = service({ stored: storedOrder(hashCheckoutRequest(order())) });
    await assert.rejects(orderService.createOrder(order(change)), (error: unknown) => {
      assert.ok(isKeyReused(error));
      assert.equal((error as Error).message.includes("AW-2026-000900"), false);
      return true;
    });
    assert.equal(created.length, 0);
  }
});

test("the check also applies to an order created by a concurrent request with the same key", async () => {
  const different = service({ stored: null, storedInsideTransaction: storedOrder(hashCheckoutRequest(order({ comment: "другой" }))) });
  await assert.rejects(different.orderService.createOrder(order()), isKeyReused);
  assert.equal(different.created.length, 0);
  const same = service({ stored: null, storedInsideTransaction: storedOrder(hashCheckoutRequest(order())) });
  assert.equal((await same.orderService.createOrder(order())).duplicate, true);
});

test("orders saved before migration 009 (no hash) are returned for the key as before", async () => {
  const { orderService } = service({ stored: storedOrder(null) });
  const result = await orderService.createOrder(order({ customer: { name: "Другой", phone: "+79990000000" } }));
  assert.deepEqual([result.id, result.duplicate], ["existing-order", true]);
});

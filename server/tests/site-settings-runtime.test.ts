import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { getDefaultSiteSettings, SITE_SETTINGS_KEY, type SiteSettings } from "../../lib/site-settings.js";
import type { CreatedOrderRow, PersistedOrderInput } from "../repositories/order-repository.js";
import { FitmentRequestService } from "../services/fitment-request-service.js";
import { OrderService, type OrderServiceDependencies } from "../services/order-service.js";
import type { DatabaseExecutor } from "../types/common.js";
import { ApplicationError } from "../utils/errors.js";
import { createOrderSchema, type CreateOrderInput } from "../validators/order-schemas.js";

const productId = "11111111-1111-4111-8111-111111111111";

function settingsWith(change: (settings: SiteSettings) => void): SiteSettings {
  const settings = structuredClone(getDefaultSiteSettings());
  settings.delivery.pickup = { enabled: true, rules: null };
  settings.delivery.cityDelivery = { enabled: true, rules: null };
  settings.delivery.regionalDelivery = { enabled: false, rules: null };
  settings.services.tireService = true;
  settings.contacts.email = "shop@apex-test.ru";
  settings.contacts.supportEmail = "orders@apex-test.ru";
  change(settings);
  return settings;
}

function orderInput(overrides: Record<string, unknown> = {}, index = 0): CreateOrderInput {
  return createOrderSchema.parse({
    idempotencyKey: `t23a-runtime-key-${String(index).padStart(4, "0")}`,
    customer: { name: "Иван", phone: "+79123456789" },
    items: [{ productId, quantity: 4 }],
    delivery: { method: "pickup" },
    requiresTireService: false,
    offerAccepted: true,
    personalDataConsent: true,
    ...overrides,
  });
}

/** In-memory checkout repository; created orders are collected in `created`. */
function fakeOrderRepository(created: PersistedOrderInput[]): OrderServiceDependencies["orderRepository"] {
  return {
    async findByCheckoutIdempotencyKey() { return null; },
    async countActiveReservationOrdersForContact() { return 0; },
    async lockProductsForCheckout() {
      return [{
        id: productId, sku: "T23A-001", name: "Шина", kind: "tire" as const, brand: "Ikon", model: "Nordman 8",
        width: 205, profile: 55, diameter: 16, pcd: null, is_active: true, amount_kopecks: 500_000, available: 20,
      }];
    },
    async reserveStock() { return []; },
    async getDeliveryPriceKopecks() { return 0; },
    async listForUser() { return []; },
    async listForAdministration() { return []; },
    async create(_database, input): Promise<CreatedOrderRow> {
      created.push(input);
      return { id: "o1", number: "AW-001001", status: "new", integration_status: "pending", total_kopecks: 0, created_at: "2026-10-12T00:00:00Z" };
    },
  };
}

/**
 * Checkout whose `readSettings` returns what the admin has saved at the
 * moment of each order (the reader is called per order).
 */
function checkout(readSettings: OrderServiceDependencies["readSettings"], fixed: Partial<OrderServiceDependencies> = {}) {
  const created: PersistedOrderInput[] = [];
  const client = { async query() { return { rows: [] }; }, release() {}, on() {}, removeListener() {} };
  const service = new OrderService({
    pool: { async connect() { return client; } } as unknown as Pool,
    readSettings,
    ...fixed,
    orderRepository: fakeOrderRepository(created),
  });
  return { service, created };
}

function isError(code: string) {
  return (error: unknown) => error instanceof ApplicationError && error.code === code && error.statusCode === 422;
}

test("order: a delivery method disabled in the saved settings → 422 DELIVERY_METHOD_UNAVAILABLE, nothing created", async () => {
  let current = settingsWith(() => {});
  let reads = 0;
  const { service, created } = checkout(async () => {
    reads += 1;
    return current;
  });

  await service.createOrder(orderInput({}, 1));
  assert.equal(created.length, 1);

  // The administrator switches pickup off: the next order sees it at once.
  current = settingsWith((settings) => { settings.delivery.pickup.enabled = false; });
  await assert.rejects(service.createOrder(orderInput({}, 2)), isError("DELIVERY_METHOD_UNAVAILABLE"));
  await assert.rejects(
    service.createOrder(orderInput({ delivery: { method: "transport_company", address: "Новосибирск, ул. Ленина, 1" } }, 3)),
    isError("DELIVERY_METHOD_UNAVAILABLE"),
  );
  await service.createOrder(orderInput({ delivery: { method: "courier", address: "Барнаул, ул. Попова, 1" } }, 4));
  assert.equal(created.length, 2);
  assert.equal(reads, 4, "settings are read for every order");
});

test("order: tire service switched off in the saved settings → 422 TIRE_SERVICE_UNAVAILABLE", async () => {
  const { service, created } = checkout(async () => settingsWith((settings) => { settings.services.tireService = false; }));
  await assert.rejects(service.createOrder(orderInput({ requiresTireService: true }, 5)), isError("TIRE_SERVICE_UNAVAILABLE"));
  await service.createOrder(orderInput({ requiresTireService: false }, 6));
  assert.equal(created.length, 1);
});

test("order: the manager notification goes to the address from the saved settings", async () => {
  let current = settingsWith(() => {});
  const { service, created } = checkout(async () => current);
  await service.createOrder(orderInput({}, 7));
  assert.equal(created[0].managerNotificationEmail, "orders@apex-test.ru");

  current = settingsWith((settings) => { settings.contacts.supportEmail = null; });
  await service.createOrder(orderInput({}, 8));
  assert.equal(created[1].managerNotificationEmail, "shop@apex-test.ru", "falls back to the store email");

  current = settingsWith((settings) => { settings.contacts.supportEmail = null; settings.contacts.email = null; });
  await service.createOrder(orderInput({}, 9));
  assert.equal(created[2].managerNotificationEmail, undefined, "no address — no manager email");
});

test("order: values fixed in the constructor (tests, tools) win; all fixed — settings are not read", async () => {
  let reads = 0;
  const reader = async () => {
    reads += 1;
    return settingsWith((settings) => { settings.delivery.pickup.enabled = false; });
  };
  const partly = checkout(reader, { enabledDeliveryMethods: ["pickup"] });
  await partly.service.createOrder(orderInput({}, 10));
  assert.equal(partly.created[0].managerNotificationEmail, "orders@apex-test.ru");
  assert.equal(reads, 1);

  const fully = checkout(reader, { enabledDeliveryMethods: ["pickup"], tireServiceEnabled: false, managerNotificationEmail: "fixed@apex-test.ru" });
  await fully.service.createOrder(orderInput({}, 11));
  assert.equal(fully.created[0].managerNotificationEmail, "fixed@apex-test.ru");
  assert.equal(reads, 1);
});

test("order: by default the settings row is read with the order pool; without a row — build-time defaults", async () => {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  let stored: unknown = null;
  const query = async (text: string, values?: unknown[]) => {
    statements.push({ text, values });
    if (text.includes("FROM store_settings")) return { rows: stored ? [{ value: stored }] : [] };
    return { rows: [] };
  };
  const client = { query, release() {}, on() {}, removeListener() {} };
  const created: PersistedOrderInput[] = [];
  // No readSettings: the production default (store_settings via `pool`).
  const service = new OrderService({
    pool: { query, async connect() { return client; } } as unknown as Pool,
    orderRepository: fakeOrderRepository(created),
  });

  stored = settingsWith((settings) => { settings.delivery.pickup.enabled = false; });
  await assert.rejects(service.createOrder(orderInput({}, 12)), isError("DELIVERY_METHOD_UNAVAILABLE"));
  const read = statements.find(({ text }) => text.includes("FROM store_settings"));
  assert.deepEqual(read?.values, [SITE_SETTINGS_KEY]);
  assert.equal(created.length, 0);

  stored = settingsWith(() => {});
  await service.createOrder(orderInput({}, 13));
  assert.equal(created.length, 1);
  assert.equal(created[0].managerNotificationEmail, "orders@apex-test.ru");

  // No row: exactly the previous behaviour (NEXT_PUBLIC_* defaults).
  stored = null;
  const defaults = getDefaultSiteSettings();
  const attempt = service.createOrder(orderInput({}, 14));
  if (defaults.delivery.pickup.enabled) {
    await attempt;
    assert.equal(created.length, 2);
  } else {
    await assert.rejects(attempt, isError("DELIVERY_METHOD_UNAVAILABLE"));
  }
});

test("fitment request: the manager email comes from the saved settings, read in the request transaction", async () => {
  let current = settingsWith(() => {});
  const readers: unknown[] = [];
  const enqueued: Array<{ recipient: string; template: string }> = [];
  const client = { async query() { return { rows: [] }; }, release() {}, on() {}, removeListener() {} };
  const service = new FitmentRequestService(
    { async connect() { return client; } } as unknown as Pool,
    { async create() { return { id: "r1", status: "new" as const, created_at: "2026-10-12T00:00:00Z" }; } },
    {
      async enqueue(_database: DatabaseExecutor, notification: { recipient: string; template: string }) {
        enqueued.push({ recipient: notification.recipient, template: notification.template });
      },
    },
    async (database) => {
      readers.push(database);
      return current;
    },
  );
  const request = {
    make: "Lada", model: "Vesta", customerName: "Иван", customerPhone: "+79123456789", personalDataConsent: true as const,
  };
  await service.create(request);
  assert.deepEqual(enqueued, [{ recipient: "orders@apex-test.ru", template: "manager-fitment-request-created" }]);
  assert.equal(readers[0], client, "read with the transaction client");

  current = settingsWith((settings) => { settings.contacts.supportEmail = null; settings.contacts.email = null; });
  await service.create(request);
  assert.equal(enqueued.length, 1, "no address — nothing enqueued");
});

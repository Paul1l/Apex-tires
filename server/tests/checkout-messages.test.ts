import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  InsufficientStockError,
  OrderRepository,
  type CheckoutProductRow,
  type CreatedOrderRow,
} from "../repositories/order-repository.js";
import { OrderService, formatInsufficientStockMessage, type OrderServiceDependencies } from "../services/order-service.js";
import { ApplicationError } from "../utils/errors.js";
import { validateCreateOrder } from "../validators/order-schemas.js";
import { formatProductDisplayName } from "../utils/product-title.js";
import { getDefaultSiteSettings } from "../../lib/site-settings.js";

const productId = "11111111-1111-4111-8111-111111111111";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "checkout-key-at-least-16-characters",
    customer: { name: "Иван", phone: "+79123456789" },
    items: [{ productId, quantity: 4 }],
    delivery: { method: "pickup" },
    offerAccepted: true,
    personalDataConsent: true,
    ...overrides,
  };
}

const tire: CheckoutProductRow = {
  id: productId, sku: "T5C-T-001", name: "Шина", kind: "tire", brand: "Ikon", model: "Nordman 8",
  width: 205, profile: 55, diameter: 16, pcd: null, is_active: true, amount_kopecks: 500_000, available: 5,
};

function service(product: CheckoutProductRow, reserveStock?: OrderServiceDependencies["orderRepository"]["reserveStock"]) {
  const database = { async query() { return { rows: [] }; }, release() {}, on() {}, removeListener() {} };
  const pool = { async connect() { return database; } } as unknown as Pool;
  return new OrderService({
    pool,
    enabledDeliveryMethods: ["pickup"],
    readSettings: async () => getDefaultSiteSettings(),
    orderRepository: {
      async findByCheckoutIdempotencyKey() { return null; },
      async countActiveReservationOrdersForContact() { return 0; },
      async lockProductsForCheckout() { return [product]; },
      reserveStock: reserveStock ?? (async () => []),
      async getDeliveryPriceKopecks() { return 0; },
      async listForUser() { return []; },
      async listForAdministration() { return []; },
      async create(): Promise<CreatedOrderRow> {
        return { id: "o1", number: "AW-001001", status: "new", integration_status: "pending", total_kopecks: 0, created_at: "2026-10-10T00:00:00Z" };
      },
    },
  });
}

function input(quantity: number) {
  const result = validateCreateOrder(payload({ items: [{ productId, quantity }] }));
  assert.ok(result.success && result.data);
  return result.data;
}

test("product display name follows the catalog: brand, model and size", () => {
  assert.equal(formatProductDisplayName(tire), "Ikon Nordman 8, 205/55 R16");
  assert.equal(
    formatProductDisplayName({ ...tire, kind: "wheel", brand: "Replica", model: "TY-1", diameter: 18, pcd: "5x112" }),
    "Replica TY-1, R18 5x112",
  );
});

test("insufficient stock names the product and the available quantity, not the SKU", async () => {
  await assert.rejects(service(tire).createOrder(input(8)), (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, "INSUFFICIENT_STOCK");
    assert.equal(error.statusCode, 409);
    // Default display mode is on_request: the quantity stays private.
    assert.equal(error.message, "Товара «Ikon Nordman 8, 205/55 R16» нет в нужном количестве. Уменьшите количество в корзине или свяжитесь с нами.");
    assert.ok(!error.message.includes("T5C-T-001") && !error.message.includes(productId));
    return true;
  });
  await assert.rejects(service({ ...tire, available: 0 }).createOrder(input(1)), {
    code: "INSUFFICIENT_STOCK",
    message: "Товар «Ikon Nordman 8, 205/55 R16» закончился. Удалите его из корзины.",
  });
});

test("exact quantity is shown only when the catalog shows exact stock", () => {
  const name = "Ikon Nordman 8, 205/55 R16";
  assert.equal(
    formatInsufficientStockMessage(name, 5, "exact"),
    "Товара «Ikon Nordman 8, 205/55 R16» сейчас в наличии только 5 шт. Уменьшите количество в корзине.",
  );
  for (const mode of ["limited", "available", "on_request", "out_of_stock"] as const) {
    assert.ok(!/\d+ шт/.test(formatInsufficientStockMessage(name, 5, mode)), mode);
  }
  assert.equal(formatInsufficientStockMessage(name, 0, "on_request"), "Товар «Ikon Nordman 8, 205/55 R16» закончился. Удалите его из корзины.");
});

test("stock that disappears before reservation is a 409, not a 500 (SEC-19)", async () => {
  const racing = service(tire, async () => { throw new InsufficientStockError(productId, 2); });
  await assert.rejects(racing.createOrder(input(4)), {
    code: "INSUFFICIENT_STOCK",
    statusCode: 409,
    message: "Товара «Ikon Nordman 8, 205/55 R16» нет в нужном количестве. Уменьшите количество в корзине или свяжитесь с нами.",
  });
  const failing = service(tire, async () => { throw new Error("connection reset"); });
  await assert.rejects(failing.createOrder(input(4)), /connection reset/);
});

test("reserveStock throws a typed error before reserving anything", async () => {
  const queries: string[] = [];
  const database = {
    async query(sql: string) {
      queries.push(sql.trim().split(/\s+/)[0]);
      return { rows: [{ product_id: productId, warehouse_id: "w1", quantity: 5, reserved: 2 }] };
    },
  };
  await assert.rejects(
    new OrderRepository().reserveStock(database as never, productId, 4),
    (error: unknown) => error instanceof InsufficientStockError && error.availableQuantity === 3,
  );
  assert.deepEqual(queries, ["SELECT"], "no UPDATE before the shortage is detected");
});

test("order validation messages are Russian and the summary names the problem", () => {
  const tooMany = validateCreateOrder(payload({ items: [{ productId, quantity: 21 }] }));
  assert.equal(tooMany.success, false);
  assert.equal(tooMany.message, "Количество одного товара — от 1 до 20 шт.");
  assert.deepEqual(tooMany.details, [{ path: "items.0.quantity", message: "Количество одного товара — от 1 до 20 шт." }]);

  const duplicates = validateCreateOrder(payload({ items: [{ productId, quantity: 12 }, { productId, quantity: 9 }] }));
  assert.equal(duplicates.message, "Одного товара в заказе может быть не больше 20 шт.");

  const phone = validateCreateOrder(payload({ customer: { name: "Иван", phone: "89123456789" } }));
  assert.equal(phone.message, "Проверьте контактные данные: Телефон должен быть в формате +7XXXXXXXXXX.");

  const consent = validateCreateOrder(payload({ personalDataConsent: false }));
  assert.equal(consent.message, "Дайте согласие на обработку персональных данных.");

  for (const broken of [
    null,
    {},
    payload({ items: [] }),
    payload({ items: [{ productId: "x", quantity: "2" }], delivery: { method: "drone" }, comment: 5 }),
    payload({ customer: { name: "И", phone: 7, email: "not-an-email" }, offerAccepted: "yes" }),
    payload({ delivery: { method: "courier" } }),
  ]) {
    const result = validateCreateOrder(broken);
    assert.equal(result.success, false);
    for (const text of [result.message, ...result.details.map((detail) => detail.message)]) {
      assert.match(text, /[А-Яа-яЁё]/, `not Russian: ${text}`);
      assert.doesNotMatch(text, /expected|Too big|Invalid|Required/i, `English zod text: ${text}`);
    }
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { Pool } from "pg";
import type { LockedOrderRow } from "../repositories/admin-order-repository.js";
import { AdminOrderRepository } from "../repositories/admin-order-repository.js";
import { AdminAuditRepository } from "../repositories/admin-audit-repository.js";
import { NotificationOutboxRepository } from "../repositories/notification-outbox-repository.js";
import { OrderCommentRepository } from "../repositories/order-comment-repository.js";
import { OrderRepository } from "../repositories/order-repository.js";
import {
  CUSTOMER_ORDER_STATUS_TEMPLATE,
  renderCustomerOrderStatusNotification,
} from "../services/admin-order-notifications.js";
import {
  AdminOrderService,
  summarizeIntegrationError,
  summarizeReservations,
  type AdminOrderServiceOptions,
} from "../services/admin-order-service.js";
import { ApplicationError } from "../utils/errors.js";

const ORDER_ID = "6f1c2f4e-5b7a-4c1d-9e2f-0a1b2c3d4e5f";
const MANAGER = { id: "0b8e1a52-3c4d-4e5f-8a9b-1c2d3e4f5a6b", role: "manager" as const };
const ADMIN = { id: "1c9f2b63-4d5e-4f60-9bac-2d3e4f5a6b7c", role: "admin" as const };

/** Pool whose single client only answers BEGIN/COMMIT/ROLLBACK (withTransaction). */
function createFakePool(log: string[]) {
  const client = {
    async query(sql: string) {
      log.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() {},
    on() {},
    removeListener() {},
  };
  return { async connect() { return client; } } as unknown as Pool;
}

type FakeAdminOrderRepository = NonNullable<AdminOrderServiceOptions["adminOrderRepository"]>;

/** Every repository method answers "nothing found"; tests override what they need. */
function fakeAdminOrderRepository(overrides: Partial<FakeAdminOrderRepository> = {}): FakeAdminOrderRepository {
  return {
    countOrders: async () => 0,
    listOrders: async () => [],
    findOrder: async () => null,
    listItems: async () => [],
    listStatusHistory: async () => [],
    listReservations: async () => [],
    findQueueItem: async () => null,
    lockOrder: async () => null,
    hasExpiredReservation: async () => false,
    setStatusChangeContext: async () => {},
    clearStatusChangeContext: async () => {},
    updatePaymentStatus: async () => false,
    ...overrides,
  };
}

interface Harness {
  service: AdminOrderService;
  log: string[];
  audits: Array<Record<string, unknown>>;
  enqueued: Array<Record<string, unknown>>;
  statusContexts: Array<{ actorUserId: string; comment: string | null }>;
}

function createHarness(options: {
  order?: LockedOrderRow | null;
  expired?: boolean;
  notifications?: boolean;
  updateError?: Error;
} = {}): Harness {
  const log: string[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const enqueued: Array<Record<string, unknown>> = [];
  const statusContexts: Array<{ actorUserId: string; comment: string | null }> = [];
  const order = options.order === undefined
    ? { id: ORDER_ID, number: "AW-2026-000042", status: "new", payment_status: "pending", customer_email: "buyer@example.invalid" }
    : options.order;
  const adminOrderRepository = fakeAdminOrderRepository({
    async lockOrder() { log.push("lockOrder"); return order; },
    async hasExpiredReservation() { log.push("hasExpiredReservation"); return Boolean(options.expired); },
    async setStatusChangeContext(_database, context) { log.push("setStatusChangeContext"); statusContexts.push(context); },
    async clearStatusChangeContext() { log.push("clearStatusChangeContext"); },
    async updatePaymentStatus() { log.push("updatePaymentStatus"); return true; },
  });
  const orderRepository = {
    async updateStatus() {
      log.push("updateStatus");
      if (options.updateError) throw options.updateError;
      return true;
    },
  };
  const auditRepository = {
    async record(_database: unknown, event: Record<string, unknown>) { log.push("audit"); audits.push(event); },
  };
  const commentRepository: AdminOrderServiceOptions["commentRepository"] = {
    async create(_database, comment) {
      log.push("createComment");
      return { id: randomUUID(), order_id: comment.orderId, author_user_id: comment.authorUserId, author_name: "Мария", body: comment.body, created_at: new Date("2026-10-11T03:00:00Z") };
    },
    listForOrder: async () => [],
  };
  const service = new AdminOrderService(createFakePool(log), orderRepository as unknown as OrderRepository, auditRepository as unknown as AdminAuditRepository, {
    adminOrderRepository,
    commentRepository,
    notificationOutboxRepository: { async enqueue(_database, item) { log.push("enqueue"); enqueued.push(item as unknown as Record<string, unknown>); } },
    customerStatusNotifications: options.notifications ?? false,
  });
  return { service, log, audits, enqueued, statusContexts };
}

async function rejectsWith(promise: Promise<unknown>, code: string, statusCode: number) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApplicationError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}

test("status change records actor and comment for the history trigger, then audits without the text", async () => {
  const harness = createHarness();
  const result = await harness.service.updateStatus(MANAGER, ORDER_ID, {
    status: "confirmed",
    comment: "Наличие подтверждено, позвонить +7 913 000-00-00",
  });
  assert.deepEqual(result, { status: "confirmed", previousStatus: "new", notificationQueued: false });
  assert.deepEqual(harness.statusContexts, [
    { actorUserId: MANAGER.id, comment: "Наличие подтверждено, позвонить +7 913 000-00-00" },
  ]);
  const steps = harness.log.filter((step) => !/^(BEGIN|COMMIT|ROLLBACK)$/.test(step));
  assert.deepEqual(steps, ["lockOrder", "hasExpiredReservation", "setStatusChangeContext", "updateStatus", "clearStatusChangeContext", "audit"]);
  assert.equal(harness.log[0], "BEGIN");
  assert.equal(harness.log.at(-1), "COMMIT");
  assert.deepEqual(harness.audits, [{
    actorUserId: MANAGER.id,
    action: "order.status_updated",
    entityType: "order",
    entityId: ORDER_ID,
    details: { orderId: ORDER_ID, previousStatus: "new", status: "confirmed", hasComment: true },
  }]);
  assert.ok(!JSON.stringify(harness.audits).includes("913"), "the comment text is not copied to the audit log");
});

test("status change without comment passes an empty comment", async () => {
  const harness = createHarness();
  await harness.service.updateStatus(ADMIN, ORDER_ID, { status: "processing" });
  assert.deepEqual(harness.statusContexts, [{ actorUserId: ADMIN.id, comment: null }]);
  assert.equal(harness.audits[0].actorUserId, ADMIN.id);
});

test("payment status: managers are refused before anything is written", async () => {
  const harness = createHarness();
  await rejectsWith(harness.service.updateStatus(MANAGER, ORDER_ID, { status: "confirmed", paymentStatus: "paid" }), "PAYMENT_STATUS_FORBIDDEN", 403);
  await rejectsWith(harness.service.updatePaymentStatus(MANAGER, ORDER_ID, { paymentStatus: "paid" }), "PAYMENT_STATUS_FORBIDDEN", 403);
  assert.deepEqual(harness.log, []);
  assert.deepEqual(harness.audits, []);
});

test("payment status: admin changes it with an audit entry; the same value is a no-op", async () => {
  const harness = createHarness();
  assert.deepEqual(await harness.service.updatePaymentStatus(ADMIN, ORDER_ID, { paymentStatus: "paid" }), { paymentStatus: "paid", changed: true });
  assert.deepEqual(harness.audits, [{
    actorUserId: ADMIN.id,
    action: "order.payment_status_updated",
    entityType: "order",
    entityId: ORDER_ID,
    details: { orderId: ORDER_ID, previousPaymentStatus: "pending", paymentStatus: "paid" },
  }]);
  const unchanged = createHarness();
  assert.deepEqual(await unchanged.service.updatePaymentStatus(ADMIN, ORDER_ID, { paymentStatus: "pending" }), { paymentStatus: "pending", changed: false });
  assert.ok(!unchanged.log.includes("updatePaymentStatus"));
  assert.deepEqual(unchanged.audits, []);

  const withStatus = createHarness();
  await withStatus.service.updateStatus(ADMIN, ORDER_ID, { status: "confirmed", paymentStatus: "paid" });
  assert.deepEqual(withStatus.audits[0].details, {
    orderId: ORDER_ID, previousStatus: "new", status: "confirmed", previousPaymentStatus: "pending", paymentStatus: "paid", hasComment: false,
  });
});

test("existing rule: an expired reservation allows only new and cancelled", async () => {
  for (const status of ["confirmed", "processing", "ready_for_pickup", "shipped", "completed"] as const) {
    const harness = createHarness({ expired: true });
    await rejectsWith(harness.service.updateStatus(MANAGER, ORDER_ID, { status }), "ORDER_RESERVATION_EXPIRED", 409);
    assert.ok(!harness.log.includes("updateStatus"), status);
    assert.ok(harness.log.includes("ROLLBACK"));
  }
  for (const status of ["new", "cancelled"] as const) {
    const harness = createHarness({ expired: true, order: { id: ORDER_ID, number: "AW-2026-000042", status: "confirmed", payment_status: "pending", customer_email: null } });
    await harness.service.updateStatus(MANAGER, ORDER_ID, { status });
    assert.ok(harness.log.includes("updateStatus"), status);
  }
});

test("the reservation trigger error becomes the same 409", async () => {
  const harness = createHarness({ updateError: new Error("ORDER_RESERVATION_EXPIRED") });
  await rejectsWith(harness.service.updateStatus(MANAGER, ORDER_ID, { status: "shipped" }), "ORDER_RESERVATION_EXPIRED", 409);
});

test("a comment without a status change is refused instead of being lost", async () => {
  const harness = createHarness();
  await rejectsWith(harness.service.updateStatus(MANAGER, ORDER_ID, { status: "new", comment: "текст" }), "ORDER_STATUS_UNCHANGED", 409);
  assert.ok(!harness.log.includes("updateStatus"));
  // Without a comment the old behaviour stays (idempotent repeat).
  const repeat = createHarness();
  await repeat.service.updateStatus(MANAGER, ORDER_ID, { status: "new" });
  assert.ok(repeat.log.includes("updateStatus"));
});

test("unknown order: 404 for status, payment and comments", async () => {
  await rejectsWith(createHarness({ order: null }).service.updateStatus(MANAGER, ORDER_ID, { status: "confirmed" }), "ORDER_NOT_FOUND", 404);
  await rejectsWith(createHarness({ order: null }).service.updatePaymentStatus(ADMIN, ORDER_ID, { paymentStatus: "paid" }), "ORDER_NOT_FOUND", 404);
  await rejectsWith(createHarness({ order: null }).service.addComment(MANAGER, ORDER_ID, { body: "текст" }), "ORDER_NOT_FOUND", 404);
});

test("customer notification: only through the outbox, only for customer-relevant statuses with an email", async () => {
  const confirmed = createHarness({ notifications: true });
  const result = await confirmed.service.updateStatus(MANAGER, ORDER_ID, { status: "confirmed", comment: "внутренний текст" });
  assert.equal(result.notificationQueued, true);
  assert.deepEqual(confirmed.enqueued, [{
    channel: "email",
    template: CUSTOMER_ORDER_STATUS_TEMPLATE,
    recipient: "buyer@example.invalid",
    payload: { orderId: ORDER_ID, orderNumber: "AW-2026-000042", status: "confirmed" },
  }]);
  assert.ok(!JSON.stringify(confirmed.enqueued).includes("внутренний"), "staff comments never reach the customer");

  const internal = createHarness({ notifications: true });
  assert.equal((await internal.service.updateStatus(MANAGER, ORDER_ID, { status: "processing" })).notificationQueued, false);
  const withoutEmail = createHarness({ notifications: true, order: { id: ORDER_ID, number: "AW-2026-000042", status: "new", payment_status: "pending", customer_email: null } });
  assert.equal((await withoutEmail.service.updateStatus(MANAGER, ORDER_ID, { status: "cancelled" })).notificationQueued, false);
  const disabled = createHarness({ notifications: false });
  assert.equal((await disabled.service.updateStatus(MANAGER, ORDER_ID, { status: "confirmed" })).notificationQueued, false);
  const unchanged = createHarness({ notifications: true });
  assert.equal((await unchanged.service.updateStatus(MANAGER, ORDER_ID, { status: "new" })).notificationQueued, false);
  for (const harness of [internal, withoutEmail, disabled, unchanged]) assert.deepEqual(harness.enqueued, []);

  const rendered = renderCustomerOrderStatusNotification({ orderNumber: "AW-2026-000042", status: "ready_for_pickup" });
  assert.equal(rendered.subject, "Заказ AW-2026-000042 готов к выдаче");
  assert.throws(() => renderCustomerOrderStatusNotification({ orderNumber: "AW-1", status: "processing" }));
  assert.ok(renderCustomerOrderStatusNotification({ orderNumber: "<b>", status: "shipped" }).html.includes("&lt;b&gt;"));
});

test("staff comment is stored with its author and audited without the text", async () => {
  const harness = createHarness();
  const comment = await harness.service.addComment(MANAGER, ORDER_ID, { body: "Клиент просил позвонить вечером" });
  assert.equal(comment.body, "Клиент просил позвонить вечером");
  assert.deepEqual(comment.author, { id: MANAGER.id, name: "Мария" });
  assert.equal(comment.createdAt, "2026-10-11T03:00:00.000Z");
  assert.equal(harness.audits[0].action, "order.comment_added");
  assert.ok(!JSON.stringify(harness.audits).includes("Клиент"));
});

test("list pagination: total pages and no list query beyond the last page", async () => {
  let listCalls = 0;
  const service = new AdminOrderService(createFakePool([]), {} as OrderRepository, {} as AdminAuditRepository, {
    adminOrderRepository: fakeAdminOrderRepository({
      countOrders: async () => 51,
      async listOrders(_database, _filters, page) {
        listCalls += 1;
        assert.deepEqual(page, { limit: 25, offset: 25 });
        return [{ id: ORDER_ID, number: "AW-2026-000042", status: "new", payment_status: "pending", integration_status: "failed", total_kopecks: "1234550", delivery_method: "pickup", created_at: new Date("2026-10-11T03:00:00Z"), customer_name: "Иван", customer_phone: "+79130000000", items: [{ order_id: ORDER_ID, product_name: "Шина", sku: "S1", quantity: 4, total_kopecks: 1234550 }] }];
      },
    }),
  });
  const page = await service.listOrders({ page: 2, pageSize: 25 });
  assert.deepEqual(page.pagination, { page: 2, pageSize: 25, total: 51, totalPages: 3 });
  assert.equal(page.items[0].total, 12345.5);
  assert.equal(page.items[0].integrationStatus, "failed");
  assert.equal(page.items[0].createdAt, "2026-10-11T03:00:00.000Z");
  const beyond = await service.listOrders({ page: 9, pageSize: 25 });
  assert.deepEqual(beyond.items, []);
  assert.equal(listCalls, 1);
});

test("details helpers: sanitized 1C error and reservation summary", () => {
  assert.equal(summarizeIntegrationError("Ошибка для ivan@example.ru, тел. +7 913 123-45-67"), "Ошибка для [email], тел. [phone]");
  assert.equal(summarizeIntegrationError("x".repeat(1000))?.length, 300);
  assert.equal(summarizeIntegrationError(null), null);
  assert.deepEqual(summarizeReservations([]), { state: "none", expiresAt: null, expired: false });
  assert.deepEqual(
    summarizeReservations([
      { status: "active", expired: false, expires_at: "2026-10-12T05:00:00Z" },
      { status: "active", expired: false, expires_at: "2026-10-12T03:00:00Z" },
    ]),
    { state: "active", expiresAt: "2026-10-12T03:00:00.000Z", expired: false },
  );
  assert.equal(summarizeReservations([{ status: "active", expired: true, expires_at: "2026-10-01T00:00:00Z" }]).expired, true);
  assert.equal(summarizeReservations([{ status: "released", expired: false, expires_at: "2026-10-01T00:00:00Z" }]).state, "released");
  assert.equal(summarizeReservations([{ status: "consumed", expired: false, expires_at: "2026-10-01T00:00:00Z" }]).state, "consumed");
});

test("admin order API refuses requests without a staff session or from another origin", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = { DATABASE_URL: environment.DATABASE_URL, DATABASE_SSL_MODE: environment.DATABASE_SSL_MODE };
  const silenced = [console.error, console.warn] as const;
  console.error = () => {};
  console.warn = () => {};
  try {
    delete environment.DATABASE_URL;
    const list = await import("../../app/api/admin/orders/route.js");
    const notConfigured = await list.GET(new Request("https://store.example/api/admin/orders"));
    assert.equal(notConfigured.status, 503);

    environment.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
    environment.DATABASE_SSL_MODE = "disable";
    const anonymous = await list.GET(new Request("https://store.example/api/admin/orders?q=1"));
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("cache-control"), "no-store");

    const details = await import("../../app/api/admin/orders/[orderId]/route.js");
    const params = Promise.resolve({ orderId: ORDER_ID });
    assert.equal((await details.GET(new Request(`https://store.example/api/admin/orders/${ORDER_ID}`), { params })).status, 401);

    const comments = await import("../../app/api/admin/orders/[orderId]/comments/route.js");
    const crossSite = await comments.POST(
      new Request(`https://store.example/api/admin/orders/${ORDER_ID}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: "apex_session=forged" },
        body: JSON.stringify({ body: "x" }),
      }),
      { params },
    );
    assert.equal(crossSite.status, 403);
    assert.equal(((await crossSite.json()) as { code: string }).code, "UNTRUSTED_ORIGIN");

    const payment = await import("../../app/api/admin/orders/[orderId]/payment/route.js");
    const status = await import("../../app/api/admin/orders/[orderId]/status/route.js");
    for (const handler of [payment.PATCH, status.PATCH]) {
      const response = await handler(
        new Request(`https://store.example/api/admin/orders/${ORDER_ID}/x`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Origin: "https://store.example" },
          body: JSON.stringify({ status: "new", paymentStatus: "paid" }),
        }),
        { params },
      );
      assert.equal(response.status, 401);
    }
  } finally {
    [console.error, console.warn] = silenced;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  }
});

// Real PostgreSQL with migration 012: actor and comment in order_status_history,
// no leak of the actor into later writes on the same connection, LIKE escaping.
// Runs when TEST_DATABASE_URL points to a disposable database; skipped otherwise.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
test("PostgreSQL: staff status change writes actor and comment to history; other writers stay anonymous", { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not set" }, async () => {
  // max 1: every query below reuses the same server session.
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  pool.on("error", () => {});
  const marker = `t21c-${randomUUID()}`;
  const staff = await pool.query<{ id: string }>(
    "INSERT INTO users (email, name, role) VALUES ($1, 'TEST ONLY manager', 'manager') RETURNING id",
    [`${marker}@example.invalid`],
  );
  const managerId = staff.rows[0].id;
  const insertOrder = async (suffix: string, customerName: string) => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO orders (number, checkout_idempotency_key, customer_name, customer_phone,
         subtotal_kopecks, total_kopecks, delivery_method)
       VALUES ($1, $2, $3, '+70000000000', 100, 100, 'pickup') RETURNING id`,
      [`${marker}-${suffix}`, `${marker}-${suffix}`, customerName],
    );
    return result.rows[0].id;
  };
  try {
    const orderId = await insertOrder("a", "TEST 100% done");
    const otherId = await insertOrder("b", "TEST 1000 done");
    const service = new AdminOrderService(pool, new OrderRepository(), new AdminAuditRepository(), {
      adminOrderRepository: new AdminOrderRepository(),
      commentRepository: new OrderCommentRepository(),
      notificationOutboxRepository: new NotificationOutboxRepository(),
    });

    await service.updateStatus({ id: managerId, role: "manager" }, orderId, { status: "confirmed", comment: "Проверено по складу" });
    // Same connection, no staff context: a 1C-like write must not inherit the actor.
    await pool.query("UPDATE orders SET status = 'processing' WHERE id = $1", [orderId]);

    const history = await pool.query<{ status: string; actor_user_id: string | null; comment: string | null }>(
      "SELECT status, actor_user_id, comment FROM order_status_history WHERE order_id = $1 ORDER BY created_at, status",
      [orderId],
    );
    const byStatus = new Map(history.rows.map((row) => [row.status, row]));
    assert.deepEqual(byStatus.get("new"), { status: "new", actor_user_id: null, comment: null }, "checkout row");
    assert.deepEqual(byStatus.get("confirmed"), { status: "confirmed", actor_user_id: managerId, comment: "Проверено по складу" });
    assert.deepEqual(byStatus.get("processing"), { status: "processing", actor_user_id: null, comment: null });

    const audit = await pool.query("SELECT 1 FROM admin_audit_log WHERE entity_id = $1 AND action = 'order.status_updated' AND actor_user_id = $2", [orderId, managerId]);
    assert.equal(audit.rowCount, 1);

    const comment = await service.addComment({ id: managerId, role: "manager" }, orderId, { body: "Внутренний комментарий" });
    assert.equal(comment.author?.id, managerId);
    const details = await service.getOrderDetails(orderId);
    assert.equal(details?.comments[0].body, "Внутренний комментарий");
    assert.equal(details?.statusHistory.find((entry) => entry.status === "confirmed")?.actor?.name, "TEST ONLY manager");

    // "%" is literal: "100%" matches only the first order, not "1000".
    const percent = await service.listOrders({ q: "100%", page: 1, pageSize: 100 });
    const found = percent.items.map((item) => item.id);
    assert.ok(found.includes(orderId));
    assert.ok(!found.includes(otherId));
    const underscore = await service.listOrders({ q: `${marker}_a`, page: 1, pageSize: 100 });
    assert.equal(underscore.pagination.total, 0, "_ is not a single-character wildcard");
    const exact = await service.listOrders({ q: `${marker}-a`, page: 1, pageSize: 100 });
    assert.deepEqual(exact.items.map((item) => item.id), [orderId]);
  } finally {
    await pool.query("DELETE FROM admin_audit_log WHERE actor_user_id = $1", [managerId]);
    await pool.query("DELETE FROM orders WHERE number LIKE $1", [`${marker}-%`]);
    await pool.query("DELETE FROM users WHERE id = $1", [managerId]);
    await pool.end();
  }
});

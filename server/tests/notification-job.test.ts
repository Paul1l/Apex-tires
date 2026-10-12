import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { NotificationProvider } from "../integrations/notifications/notification-provider.js";
import { NotificationOutboxRepository, type NotificationOutboxItem } from "../repositories/notification-outbox-repository.js";
import { NotificationService } from "../services/notification-service.js";

const environment = process.env as Record<string, string | undefined>;
const JOB_SECRET = "j".repeat(40);
const POSTBOX = {
  YANDEX_POSTBOX_ACCESS_KEY_ID: "test-key-id",
  YANDEX_POSTBOX_SECRET_ACCESS_KEY: "test-secret",
  YANDEX_POSTBOX_FROM_EMAIL: "shop@example.com",
};

/** Fake pool: records statements; the outbox holds `queued` undelivered rows. */
function fakePool(queued: number) {
  const statements: string[] = [];
  const query = async (text: string) => {
    statements.push(text.replace(/\s+/g, " ").trim());
    if (text.includes("COUNT(*)::integer AS count FROM notification_outbox")) return { rows: [{ count: queued }] };
    return { rows: [] };
  };
  const client = { query, release() {}, on() {}, removeListener() {} };
  return { statements, pool: { query, async connect() { return client; } } as unknown as Pool };
}

async function withJobEnvironment(
  values: Record<string, string | undefined>,
  pool: Pool,
  run: () => Promise<void>,
) {
  const keys = ["DATABASE_URL", "DATABASE_SSL_MODE", "INTERNAL_JOB_SECRET", ...Object.keys(POSTBOX)];
  const previous = Object.fromEntries(keys.map((key) => [key, environment[key]]));
  const previousPool = globalThis.apexPostgresPool;
  for (const key of Object.keys(POSTBOX)) delete environment[key];
  Object.assign(environment, {
    DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
    DATABASE_SSL_MODE: "disable",
    INTERNAL_JOB_SECRET: JOB_SECRET,
  }, values);
  globalThis.apexPostgresPool = pool;
  try {
    await run();
  } finally {
    globalThis.apexPostgresPool = previousPool;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  }
}

function jobRequest(key = JOB_SECRET) {
  return new Request("http://127.0.0.1:3000/api/internal/jobs/notifications", {
    method: "POST",
    headers: { "X-Job-Key": key },
  });
}

test("without a provider the job succeeds and leaves the queue untouched", async () => {
  const { pool, statements } = fakePool(3);
  await withJobEnvironment({}, pool, async () => {
    const { POST } = await import("../../app/api/internal/jobs/notifications/route.js");
    const response = await POST(jobRequest());
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      sent: 0,
      failed: 0,
      providerConfigured: false,
      queued: 3,
      message: "Провайдер уведомлений не настроен, уведомления остаются в очереди.",
    });
  });
  // Only the count: nothing claimed, marked failed or rescheduled.
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^SELECT COUNT\(\*\)/);
});

test("the job key is still required, and the job needs its secret and the database", async () => {
  const { pool, statements } = fakePool(0);
  await withJobEnvironment({}, pool, async () => {
    const { POST } = await import("../../app/api/internal/jobs/notifications/route.js");
    assert.equal((await POST(jobRequest("wrong-key"))).status, 401);
    environment.INTERNAL_JOB_SECRET = "";
    const unconfigured = await POST(jobRequest(""));
    assert.equal(unconfigured.status, 503);
    assert.equal(((await unconfigured.json()) as { code: string }).code, "NOTIFICATION_JOB_NOT_CONFIGURED");
  });
  assert.equal(statements.length, 0);
});

test("with Postbox configured the job processes the queue as before", async () => {
  const { pool, statements } = fakePool(0);
  await withJobEnvironment(POSTBOX, pool, async () => {
    const { POST } = await import("../../app/api/internal/jobs/notifications/route.js");
    const response = await POST(jobRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, sent: 0, failed: 0 });
  });
  assert.ok(statements.some((statement) => statement.includes("SET status = 'processing'")), "the queue is claimed");
});

test("a delivery failure is still reported (ok: false) and the notification is retried later", async () => {
  const item: NotificationOutboxItem = { id: "n1", channel: "email", template: "t", recipient: "a@example.com", payload: {} };
  const marked: string[] = [];
  let claimed = false;
  const repository = {
    async claimNext() { if (claimed) return null; claimed = true; return item; },
    async markSent() { marked.push("sent"); },
    async markFailed(_database: unknown, _id: string, reason: string) { marked.push(`failed:${reason}`); },
    async countUnsent() { return 1; },
  } as unknown as NotificationOutboxRepository;
  const provider: NotificationProvider = {
    channel: "email",
    async send() { throw new Error("Postbox 503"); },
  } as NotificationProvider;
  const client = { query: async () => ({ rows: [] }), release() {}, on() {}, removeListener() {} };
  const service = new NotificationService(
    { async connect() { return client; } } as unknown as Pool,
    repository,
    [provider],
    { error() {}, warn() {} },
  );
  assert.equal(service.hasProviders(), true);
  assert.deepEqual(await service.processPending(5), { sent: 0, failed: 1 });
  assert.deepEqual(marked, ["failed:Провайдер временно не принял уведомление."]);
});

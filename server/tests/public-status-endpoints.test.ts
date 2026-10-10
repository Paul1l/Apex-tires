import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import {
  CachedDatabaseProbe,
  createPublicHealthReport,
  probeDatabase,
} from "../services/health-check.js";

const environment = process.env as Record<string, string | undefined>;
const STORE = "https://store.example";
const PEPPER = "p".repeat(40);

async function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, environment[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  }
}

type QueryHandler = (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;

/** Replaces the shared PostgreSQL pool (server/bootstrap/application-services.ts). */
async function withFakePool(query: QueryHandler, run: () => Promise<void>): Promise<void> {
  const previousPool = globalThis.apexPostgresPool;
  globalThis.apexPostgresPool = { query } as unknown as Pool;
  globalThis.apexDatabaseHealthProbe = undefined;
  try {
    await withEnvironment(
      {
        DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
        DATABASE_SSL_MODE: "disable",
        OTP_CODE_PEPPER: PEPPER,
      },
      run,
    );
  } finally {
    globalThis.apexPostgresPool = previousPool;
    globalThis.apexDatabaseHealthProbe = undefined;
  }
}

async function readJson(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function sessionRequest(cookie?: string) {
  return new NextRequest(`${STORE}/api/auth/session`, {
    headers: cookie ? { cookie } : {},
  });
}

function clearsSessionCookie(response: Response): boolean {
  const header = response.headers.get("set-cookie") ?? "";
  return /apex_session=;/.test(header) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(header);
}

test("session: a guest gets 200 with user null when sign-in is not configured", async () => {
  await withEnvironment({ DATABASE_URL: undefined, OTP_CODE_PEPPER: undefined }, async () => {
    const { GET } = await import("../../app/api/auth/session/route.js");
    for (const cookie of [undefined, "apex_session=stale-token"]) {
      const response = await GET(sessionRequest(cookie));
      assert.deepEqual(await readJson(response), { status: 200, body: { ok: true, user: null } });
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });
});

test("session: a guest without a cookie gets 200 with user null and no database query", async () => {
  let queries = 0;
  await withFakePool(async () => {
    queries += 1;
    return { rows: [], rowCount: 0 };
  }, async () => {
    const { GET } = await import("../../app/api/auth/session/route.js");
    const response = await GET(sessionRequest());
    assert.deepEqual(await readJson(response), { status: 200, body: { ok: true, user: null } });
    assert.equal(response.headers.get("set-cookie"), null);
  });
  assert.equal(queries, 0);
});

test("session: unknown or expired session → 200 with user null and the cookie is cleared", async () => {
  const expiredRow = {
    session_id: "s1",
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    id: "u1",
    email: "buyer@example.com",
    phone: null,
    name: "Покупатель",
    role: "customer",
    status: "active",
  };
  for (const rows of [[], [expiredRow]]) {
    const statements: string[] = [];
    await withFakePool(async (text) => {
      statements.push(text);
      return { rows: text.trimStart().startsWith("SELECT") ? rows : [], rowCount: rows.length };
    }, async () => {
      const { GET } = await import("../../app/api/auth/session/route.js");
      const response = await GET(sessionRequest("apex_session=some-session-token"));
      assert.deepEqual(await readJson(response), { status: 200, body: { ok: true, user: null } });
      assert.ok(clearsSessionCookie(response), response.headers.get("set-cookie") ?? "no set-cookie");
    });
    // The expired session is also deleted on the server.
    if (rows.length > 0) assert.ok(statements.some((statement) => /DELETE/i.test(statement)));
  }
});

test("session: an active session returns the profile; a failed lookup is still 503", async () => {
  const activeRow = {
    session_id: "s1",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    id: "u1",
    email: "buyer@example.com",
    phone: null,
    name: "Покупатель",
    role: "customer",
    status: "active",
  };
  await withFakePool(async () => ({ rows: [activeRow], rowCount: 1 }), async () => {
    const { GET } = await import("../../app/api/auth/session/route.js");
    const { status, body } = await readJson(await GET(sessionRequest("apex_session=token")));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal((body.user as { id: string }).id, "u1");
  });
  await withFakePool(async () => {
    throw new Error("connection refused");
  }, async () => {
    const { GET } = await import("../../app/api/auth/session/route.js");
    const { status, body } = await readJson(await GET(sessionRequest("apex_session=token")));
    assert.deepEqual([status, body.code], [503, "AUTH_SERVICE_UNAVAILABLE"]);
  });
});

test("health: minimal anonymous report without version or configuration details", async () => {
  await withEnvironment({ DATABASE_URL: undefined }, async () => {
    const { GET } = await import("../../app/api/health/route.js");
    const { status, body } = await readJson(await GET());
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body).sort(), ["database", "ok", "status", "timestamp"]);
    assert.deepEqual([body.ok, body.status, body.database], [true, "ok", "not_configured"]);
  });
  await withFakePool(async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 }), async () => {
    const { GET } = await import("../../app/api/health/route.js");
    const { status, body } = await readJson(await GET());
    assert.deepEqual([status, body.ok, body.status, body.database], [200, true, "ok", "available"]);
  });
  await withFakePool(async () => {
    throw new Error("connection refused");
  }, async () => {
    const { GET } = await import("../../app/api/health/route.js");
    const response = await GET();
    const { status, body } = await readJson(response);
    assert.deepEqual([status, body.ok, body.status, body.database], [503, false, "degraded", "unavailable"]);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(JSON.stringify(body).includes("connection refused"), false);
  });
});

test("health: database probe times out and is shared between close requests", async () => {
  const hanging = await probeDatabase({ query: () => new Promise(() => {}), timeoutMilliseconds: 20 });
  assert.equal(hanging, "unavailable");

  let queries = 0;
  let currentTime = 1_000;
  const probe = new CachedDatabaseProbe(
    { query: async () => { queries += 1; } },
    5_000,
    () => currentTime,
  );
  assert.deepEqual(await Promise.all([probe.check(), probe.check()]), ["available", "available"]);
  currentTime += 4_999;
  await probe.check();
  assert.equal(queries, 1);
  currentTime += 1;
  await probe.check();
  assert.equal(queries, 2);

  assert.deepEqual(
    createPublicHealthReport("unavailable", new Date("2026-10-10T00:00:00.000Z")),
    { ok: false, status: "degraded", database: "unavailable", timestamp: "2026-10-10T00:00:00.000Z" },
  );
});

test("integration status requires a staff session, also without a database", async () => {
  await withEnvironment({ DATABASE_URL: undefined, OTP_CODE_PEPPER: undefined }, async () => {
    const { GET } = await import("../../app/api/integration-status/route.js");
    const { status, body } = await readJson(await GET(new Request(`${STORE}/api/integration-status`)));
    assert.deepEqual([status, body.code], [401, "AUTHENTICATION_REQUIRED"]);
    assert.equal("database" in body, false);
    assert.equal("oneC" in body, false);
  });
  await withFakePool(async () => ({ rows: [], rowCount: 0 }), async () => {
    const { GET } = await import("../../app/api/integration-status/route.js");
    const { status, body } = await readJson(await GET(new Request(`${STORE}/api/integration-status`)));
    assert.deepEqual([status, body.code], [401, "AUTHENTICATION_REQUIRED"]);
  });
});

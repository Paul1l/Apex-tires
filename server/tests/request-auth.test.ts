import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createSecureDigest } from "../../lib/auth/security.js";
import type { SessionAuthMethod } from "../../lib/auth/session.js";
import type { AuthRepository, SessionUserRow, UserRole } from "../repositories/auth-repository.js";
import { authorizeRequest, decideRoleAccess, readSessionToken } from "../security/request-auth.js";
import { resolveStaffPageAccess } from "../security/staff-page-guard.js";
import { effectiveSessionRole } from "../security/staff-roles.js";
import { AuthService, roleHasAccess } from "../services/auth-service.js";
import { ApplicationError } from "../utils/errors.js";

test("session token is read only from the named cookie", () => {
  assert.equal(
    readSessionToken("theme=dark; apex_session=secure%20token; locale=ru"),
    "secure token",
  );
  assert.equal(readSessionToken("theme=dark"), null);
  assert.equal(readSessionToken("apex_session=%invalid"), null);
});

test("manager and admin roles can be checked explicitly", () => {
  assert.equal(roleHasAccess("manager", ["manager", "admin"]), true);
  assert.equal(roleHasAccess("customer", ["manager", "admin"]), false);
});

// --- Effective role: staff rights only through a staff (TOTP) session ---

const SESSION_SECRET = "s".repeat(40);

function createSessionHarness() {
  const sessions = new Map<string, SessionUserRow>();
  const repository = {
    async findUserBySessionTokenHash(_database: unknown, tokenHash: string) {
      return sessions.get(tokenHash) ?? null;
    },
    async deleteSessionByTokenHash(_database: unknown, tokenHash: string) {
      sessions.delete(tokenHash);
    },
  };
  const service = new AuthService({
    pool: {} as Pool,
    repository: repository as unknown as AuthRepository,
    securitySecret: SESSION_SECRET,
    emailEnvironment: {},
  });
  return {
    lookUp: (token: string) => service.getUserBySessionToken(token),
    async addSession(
      token: string,
      user: { role: UserRole; authMethod: SessionAuthMethod; expiresAt?: Date; status?: "active" | "blocked" },
    ) {
      sessions.set(await createSecureDigest(SESSION_SECRET, `session:${token}`), {
        session_id: `session-${token}`,
        expires_at: user.expiresAt ?? new Date(Date.now() + 3_600_000),
        auth_method: user.authMethod,
        id: `user-${token}`,
        email: `${token}@shop.ru`,
        phone: null,
        name: "Сотрудник",
        role: user.role,
        status: user.status ?? "active",
      });
    },
  };
}

function requestWithSession(token: string | null, method = "GET"): Request {
  const headers: Record<string, string> = { origin: "http://localhost:3000" };
  if (token) headers.cookie = `theme=dark; apex_session=${token}`;
  return new Request("http://localhost:3000/api/admin/orders", { method, headers });
}

async function assertRejected(promise: Promise<unknown>, statusCode: number, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    return true;
  });
}

test("staff roles count only for a staff authenticator session", () => {
  assert.equal(effectiveSessionRole("admin", "staff_totp"), "admin");
  assert.equal(effectiveSessionRole("manager", "staff_totp"), "manager");
  assert.equal(effectiveSessionRole("admin", "customer_otp"), "customer");
  assert.equal(effectiveSessionRole("manager", "customer_otp"), "customer");
  assert.equal(effectiveSessionRole("admin", undefined), "customer");
  assert.equal(effectiveSessionRole("customer", "staff_totp"), "customer");
});

test("an admin's email-code session is refused by admin API routes (403)", async () => {
  const harness = createSessionHarness();
  await harness.addSession("customer-session-of-admin", { role: "admin", authMethod: "customer_otp" });
  await harness.addSession("customer-session-of-manager", { role: "manager", authMethod: "customer_otp" });

  for (const token of ["customer-session-of-admin", "customer-session-of-manager"]) {
    await assertRejected(
      authorizeRequest(requestWithSession(token), ["manager", "admin"], harness.lookUp),
      403,
      "ACCESS_DENIED",
    );
    await assertRejected(
      authorizeRequest(requestWithSession(token, "PATCH"), ["admin"], harness.lookUp),
      403,
      "ACCESS_DENIED",
    );
    // Customer endpoints keep working with the same session.
    const customer = await authorizeRequest(
      requestWithSession(token),
      ["customer", "manager", "admin"],
      harness.lookUp,
    );
    assert.equal(customer.role, "customer");
  }
});

test("a staff authenticator session grants the stored role", async () => {
  const harness = createSessionHarness();
  await harness.addSession("staff-admin", { role: "admin", authMethod: "staff_totp" });
  await harness.addSession("staff-manager", { role: "manager", authMethod: "staff_totp" });

  const admin = await authorizeRequest(requestWithSession("staff-admin", "PATCH"), ["admin"], harness.lookUp);
  assert.equal(admin.role, "admin");
  const manager = await authorizeRequest(
    requestWithSession("staff-manager"),
    ["manager", "admin"],
    harness.lookUp,
  );
  assert.equal(manager.role, "manager");
  await assertRejected(
    authorizeRequest(requestWithSession("staff-manager"), ["admin"], harness.lookUp),
    403,
    "ACCESS_DENIED",
  );
  // Customer endpoints work with a staff session too.
  const asCustomer = await authorizeRequest(
    requestWithSession("staff-admin"),
    ["customer", "manager", "admin"],
    harness.lookUp,
  );
  assert.equal(asCustomer.role, "admin");
});

test("missing, expired and blocked sessions are signed out (401)", async () => {
  const harness = createSessionHarness();
  await harness.addSession("expired", {
    role: "admin",
    authMethod: "staff_totp",
    expiresAt: new Date(Date.now() - 1_000),
  });
  await harness.addSession("blocked", { role: "admin", authMethod: "staff_totp", status: "blocked" });
  for (const token of [null, "unknown", "expired", "blocked"]) {
    await assertRejected(
      authorizeRequest(requestWithSession(token), ["manager", "admin"], harness.lookUp),
      401,
      "AUTHENTICATION_REQUIRED",
    );
  }
});

test("pages and API routes decide the same way", async () => {
  const harness = createSessionHarness();
  await harness.addSession("customer-session-of-admin", { role: "admin", authMethod: "customer_otp" });
  await harness.addSession("staff-admin", { role: "admin", authMethod: "staff_totp" });
  assert.equal(decideRoleAccess(await harness.lookUp("customer-session-of-admin"), ["manager", "admin"]), "forbidden");
  assert.equal(decideRoleAccess(await harness.lookUp("staff-admin"), ["manager", "admin"]), "allowed");
  assert.equal(decideRoleAccess(await harness.lookUp("unknown"), ["manager", "admin"]), "signed_out");
});

test("state-changing staff requests from another site are refused before the session check", async () => {
  const harness = createSessionHarness();
  await harness.addSession("staff-admin", { role: "admin", authMethod: "staff_totp" });
  const request = new Request("http://localhost:3000/api/admin/staff", {
    method: "POST",
    headers: { origin: "https://evil.example", cookie: "apex_session=staff-admin" },
  });
  await assertRejected(authorizeRequest(request, ["admin"], harness.lookUp), 403, "UNTRUSTED_ORIGIN");
});

test("admin pages answer \"unavailable\" instead of failing when the database is down", async () => {
  const harness = createSessionHarness();
  await harness.addSession("staff-admin", { role: "admin", authMethod: "staff_totp" });
  await harness.addSession("customer-session-of-admin", { role: "admin", authMethod: "customer_otp" });
  const databaseDown = async () => {
    throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
  };
  const brokenSchema = async () => {
    throw Object.assign(new Error('column "auth_method" does not exist'), { code: "42703" });
  };
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => {
    logged.push(values);
  };
  try {
    assert.deepEqual(await resolveStaffPageAccess("staff-admin", ["manager", "admin"], databaseDown), {
      status: "unavailable",
    });
    assert.deepEqual(await resolveStaffPageAccess("staff-admin", ["manager", "admin"], brokenSchema), {
      status: "unavailable",
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(logged.length, 2);
  assert.ok(!JSON.stringify(logged).includes("staff-admin"), "the session token is not logged");

  assert.deepEqual(await resolveStaffPageAccess(null, ["manager", "admin"], databaseDown), {
    status: "signed_out",
  });
  const allowed = await resolveStaffPageAccess("staff-admin", ["manager", "admin"], harness.lookUp);
  assert.equal(allowed.status, "allowed");
  assert.deepEqual(
    await resolveStaffPageAccess("customer-session-of-admin", ["manager", "admin"], harness.lookUp),
    { status: "forbidden" },
  );
  assert.deepEqual(await resolveStaffPageAccess("unknown", ["manager", "admin"], harness.lookUp), {
    status: "signed_out",
  });
});

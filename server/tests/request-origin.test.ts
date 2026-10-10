import assert from "node:assert/strict";
import test from "node:test";
import { requireSameOrigin } from "../security/request-origin.js";
import { ApplicationError } from "../utils/errors.js";

const environment = process.env as Record<string, string | undefined>;
const STORE = "https://store.example";

function withEnvironment(values: Record<string, string | undefined>, run: () => void | Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, environment[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  };
  try {
    const result = run();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return undefined;
  } catch (error) {
    restore();
    throw error;
  }
}

function request(headers: Record<string, string>, method = "POST", url = `${STORE}/api/v1/orders`) {
  return new Request(url, { method, headers });
}

function isUntrustedOrigin(error: unknown): boolean {
  return error instanceof ApplicationError && error.code === "UNTRUSTED_ORIGIN" && error.statusCode === 403;
}

test("same-origin browser requests pass", () => {
  withEnvironment({ NEXT_PUBLIC_SITE_URL: STORE, NODE_ENV: "production" }, () => {
    requireSameOrigin(request({ Origin: STORE }));
    requireSameOrigin(request({ Origin: STORE, "Sec-Fetch-Site": "same-origin" }));
    // Browsers that omit Origin still send Sec-Fetch-Site.
    requireSameOrigin(request({ "Sec-Fetch-Site": "same-origin" }));
    // Safe methods are never blocked.
    requireSameOrigin(request({ Origin: "https://evil.example" }, "GET"));
  });
});

test("cross-site and header-less mutating requests are rejected", () => {
  withEnvironment({ NEXT_PUBLIC_SITE_URL: STORE, NODE_ENV: "production" }, () => {
    const rejectedHeaders: Array<Record<string, string>> = [
      {},
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { Origin: `${STORE}.evil.example` },
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
      { "Sec-Fetch-Site": "none" },
      { Origin: STORE, "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of rejectedHeaders) {
      assert.throws(() => requireSameOrigin(request(headers)), isUntrustedOrigin, JSON.stringify(headers));
      assert.throws(() => requireSameOrigin(request(headers, "PUT")), isUntrustedOrigin);
    }
  });
});

test("production trusts only NEXT_PUBLIC_SITE_URL; development also trusts the local origin", () => {
  const local = "http://localhost:3000";
  withEnvironment({ NEXT_PUBLIC_SITE_URL: STORE, NODE_ENV: "production" }, () => {
    assert.throws(
      () => requireSameOrigin(request({ Origin: local }, "POST", `${local}/api/v1/orders`)),
      isUntrustedOrigin,
    );
  });
  withEnvironment({ NEXT_PUBLIC_SITE_URL: STORE, NODE_ENV: "development" }, () => {
    requireSameOrigin(request({ Origin: local }, "POST", `${local}/api/v1/orders`));
    requireSameOrigin(request({ Origin: STORE }, "POST", `${local}/api/v1/orders`));
    assert.throws(
      () => requireSameOrigin(request({ Origin: "http://localhost:4000" }, "POST", `${local}/api/v1/orders`)),
      isUntrustedOrigin,
    );
  });
  withEnvironment({ NEXT_PUBLIC_SITE_URL: undefined, NODE_ENV: "production" }, () => {
    requireSameOrigin(request({ Origin: STORE }));
    assert.throws(() => requireSameOrigin(request({ Origin: "https://evil.example" })), isUntrustedOrigin);
  });
});

async function readJson(response: Response) {
  return { status: response.status, body: (await response.json()) as { code?: string } };
}

test("auth routes now require a same-origin request", async () => {
  await withEnvironment(
    { NEXT_PUBLIC_SITE_URL: STORE, NODE_ENV: "production", DATABASE_URL: undefined, OTP_CODE_PEPPER: undefined },
    async () => {
      const requestCode = await import("../../app/api/auth/request-code/route.js");
      const verifyCode = await import("../../app/api/auth/verify-code/route.js");
      for (const handler of [requestCode.POST, verifyCode.POST]) {
        const crossSite = await readJson(
          await handler(new Request(`${STORE}/api/auth/x`, {
            method: "POST",
            headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
            body: "{}",
          })),
        );
        assert.deepEqual([crossSite.status, crossSite.body.code], [403, "UNTRUSTED_ORIGIN"]);
        const noHeaders = await readJson(
          await handler(new Request(`${STORE}/api/auth/x`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })),
        );
        assert.deepEqual([noHeaders.status, noHeaders.body.code], [403, "UNTRUSTED_ORIGIN"]);
        // Same origin passes the guard and reaches the (unconfigured) service.
        const sameOrigin = await readJson(
          await handler(new Request(`${STORE}/api/auth/x`, {
            method: "POST",
            headers: { Origin: STORE, "Content-Type": "application/json" },
            body: "{}",
          })),
        );
        assert.deepEqual([sameOrigin.status, sameOrigin.body.code], [503, "AUTH_INFRASTRUCTURE_NOT_CONFIGURED"]);
      }
    },
  );
});

test("key-authenticated 1C and internal job endpoints are not affected by the origin guard", async () => {
  await withEnvironment(
    { NEXT_PUBLIC_SITE_URL: STORE, NODE_ENV: "production", DATABASE_URL: undefined, INTERNAL_JOB_SECRET: undefined },
    async () => {
      const oneC = await import("../../app/api/integrations/1c/v1/[...action]/route.js");
      const reservations = await import("../../app/api/internal/jobs/reservations/route.js");
      const oneCResponse = await readJson(
        await oneC.POST(
          new Request(`${STORE}/api/integrations/1c/v1/stocks/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Integration-Key": "k".repeat(40) },
            body: "{}",
          }),
          { params: Promise.resolve({ action: ["stocks", "batch"] }) },
        ),
      );
      // No Origin / Sec-Fetch-Site: the request reaches the database check, not a 403.
      assert.deepEqual([oneCResponse.status, oneCResponse.body.code], [503, "DATABASE_NOT_CONFIGURED"]);
      const jobResponse = await reservations.POST(
        new Request(`${STORE}/api/internal/jobs/reservations`, { method: "POST", headers: { "X-Job-Key": "x" } }),
      );
      assert.equal(jobResponse.status, 401);
    },
  );
});

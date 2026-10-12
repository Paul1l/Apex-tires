import assert from "node:assert/strict";
import test from "node:test";

test("next build does not query the database for the initial catalog (QA-40)", async () => {
  const environment = process.env as Record<string, string | undefined>;
  Object.assign(environment, {
    NEXT_PUBLIC_CATALOG_DATA_MODE: "database",
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    NEXT_PHASE: "phase-production-build",
    OTP_CODE_PEPPER: "p".repeat(40),
  });
  const messages: unknown[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...values: unknown[]) => { messages.push(values[0]); };
  console.warn = (...values: unknown[]) => { messages.push(values[0]); };
  try {
    const { loadInitialCatalog } = await import("../../lib/api/initial-catalog");
    assert.equal(await loadInitialCatalog("all"), null);
    // A database attempt would fail on port 1 and log the rendering error.
    assert.deepEqual(messages, []);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test("the whole-site cache reset job requires the job key", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const { POST } = await import("../../app/api/internal/jobs/site-revalidation/route.js");
  const request = (key?: string) =>
    new Request("http://127.0.0.1:3000/api/internal/jobs/site-revalidation", {
      method: "POST",
      headers: key ? { "X-Job-Key": key } : {},
    });
  delete environment.INTERNAL_JOB_SECRET;
  assert.equal((await POST(request("anything"))).status, 401);
  environment.INTERNAL_JOB_SECRET = "j".repeat(48);
  assert.equal((await POST(request())).status, 401);
  const refused = await POST(request("wrong".repeat(10)));
  assert.equal(refused.status, 401);
  assert.equal(refused.headers.get("cache-control"), "no-store");
});

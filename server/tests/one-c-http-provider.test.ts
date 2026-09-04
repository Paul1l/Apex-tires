import assert from "node:assert/strict";
import test from "node:test";
import { OneCHttpProvider } from "../integrations/onec/one-c-http-provider.js";

function createProvider() {
  return new OneCHttpProvider({
    baseUrl: "https://onec.example.test",
    apiKey: "secret",
    apiKeyHeader: "X-API-Key",
    timeoutMilliseconds: 1_000,
    safeRetryCount: 1,
    logger: { warn() {}, error() {} },
  });
}

test("sendOrder forwards an idempotency key", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let receivedHeaders: HeadersInit | undefined;
  globalThis.fetch = async (_url, options) => {
    receivedHeaders = options?.headers;
    return new Response(JSON.stringify({ externalOrderId: "1c-order-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await createProvider().sendOrder(
    { siteOrderId: "site-order-1" },
    { idempotencyKey: "order:site-order-1" },
  );

  assert.equal(
    new Headers(receivedHeaders).get("Idempotency-Key"),
    "order:site-order-1",
  );
  assert.equal(result.externalOrderId, "1c-order-1");
});

test("unsafe POST without an idempotency key is not retried", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("unavailable", { status: 503 });
  };

  await assert.rejects(
    createProvider().request("/orders", { method: "POST", body: {} }),
    /1С вернула HTTP 503/,
  );
  assert.equal(calls, 1);
});

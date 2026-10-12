import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRateLimiter } from "../security/fixed-window-rate-limiter.js";
import { ApplicationError } from "../utils/errors.js";
import { readJsonRequest } from "../utils/http.js";

test("integration rate limiter rejects requests after the configured limit", async () => {
  let now = 1_000;
  const limiter = new InMemoryRateLimiter({ now: () => now });

  assert.equal((await limiter.consume("client", 2, 60)).allowed, true);
  now = 2_000;
  assert.equal((await limiter.consume("client", 2, 60)).allowed, true);
  now = 3_000;
  const rejected = await limiter.consume("client", 2, 60);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds, 58);
});

test("JSON request reader reports malformed input safely", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json",
  });

  await assert.rejects(
    readJsonRequest(request),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "INVALID_JSON",
  );
});

test("JSON request reader enforces the body size limit", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "too long" }),
  });

  await assert.rejects(
    readJsonRequest(request, 5),
    (error: unknown) =>
      error instanceof ApplicationError && error.statusCode === 413,
  );
});

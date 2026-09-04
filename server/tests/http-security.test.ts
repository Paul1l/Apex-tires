import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowRateLimiter } from "../security/fixed-window-rate-limiter.js";
import { ApplicationError } from "../utils/errors.js";
import { readJsonRequest } from "../utils/http.js";

test("integration rate limiter rejects requests after the configured limit", () => {
  const limiter = new FixedWindowRateLimiter(2, 60_000);

  assert.equal(limiter.consume("client", 1_000).allowed, true);
  assert.equal(limiter.consume("client", 2_000).allowed, true);
  const rejected = limiter.consume("client", 3_000);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfter, 58);
});

test("JSON request reader reports malformed input safely", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST",
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
    body: JSON.stringify({ value: "too long" }),
  });

  await assert.rejects(
    readJsonRequest(request, 5),
    (error: unknown) =>
      error instanceof ApplicationError && error.statusCode === 413,
  );
});

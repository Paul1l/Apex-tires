import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { readSecurityLimits } from "../config/security-limits.js";
import { InMemoryRateLimiter } from "../security/fixed-window-rate-limiter.js";
import { PostgresRateLimiter } from "../security/postgres-rate-limiter.js";
import { enforceRateLimit, formatRetryAfter } from "../security/rate-limit-policies.js";
import { ApplicationError } from "../utils/errors.js";

test("in-memory limiter allows `limit` requests per window and then reports retry-after", async () => {
  let now = 0;
  const limiter = new InMemoryRateLimiter({ now: () => now });
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(await limiter.consume("orders:ip:a", 3, 60), { allowed: true, retryAfterSeconds: 0 });
  }
  now = 15_000;
  assert.deepEqual(await limiter.consume("orders:ip:a", 3, 60), { allowed: false, retryAfterSeconds: 45 });
  // Other keys and other windows are independent.
  assert.equal((await limiter.consume("orders:ip:b", 3, 60)).allowed, true);
  assert.equal((await limiter.consume("orders:ip:a", 3, 3600)).allowed, true);
  // The window resets.
  now = 60_000;
  assert.equal((await limiter.consume("orders:ip:a", 3, 60)).allowed, true);
});

test("in-memory limiter evicts expired windows instead of growing forever", async () => {
  let now = 0;
  const limiter = new InMemoryRateLimiter({ now: () => now, sweepIntervalMilliseconds: 1_000 });
  for (let index = 0; index < 20_000; index += 1) {
    limiter.consumeNow(`fitment:ip:10.0.${index >> 8}.${index & 255}`, 5, 3600);
  }
  assert.ok(limiter.size <= 10_000, `size ${limiter.size} must respect the default cap`);
  now = 2 * 3_600_000;
  await limiter.consume("fresh", 5, 3600);
  assert.equal(limiter.size, 1);
});

test("in-memory limiter keeps the map under the hard cap with live windows", () => {
  const limiter = new InMemoryRateLimiter({ now: () => 0, maximumEntries: 100 });
  for (let index = 0; index < 1_000; index += 1) limiter.consumeNow(`key-${index}`, 1, 60);
  assert.ok(limiter.size <= 100);
  // The newest key is still tracked and limited.
  assert.equal(limiter.consumeNow("key-999", 1, 60).allowed, false);
});

test("limiter rejects invalid arguments", async () => {
  const limiter = new InMemoryRateLimiter();
  await assert.rejects(limiter.consume("", 1, 60));
  await assert.rejects(limiter.consume("k", 0, 60));
  await assert.rejects(limiter.consume("k", 1, 0));
  await assert.rejects(limiter.consume("k", 1.5, 60));
});

test("PostgreSQL limiter hashes keys and maps the upsert result to a decision", async () => {
  const calls: unknown[][] = [];
  let nextRows: Array<{ hits: number; retry_after_seconds: number }> = [];
  const database = {
    async query(_sql: string, values: unknown[]) {
      calls.push(values);
      return { rows: nextRows, rowCount: nextRows.length };
    },
  } as unknown as Pool;
  const limiter = new PostgresRateLimiter(database, { keySecret: "s".repeat(32), cleanupProbability: 0 });

  nextRows = [{ hits: 2, retry_after_seconds: 100 }];
  assert.deepEqual(await limiter.consume("orders:phone:+79990000000", 2, 3600), { allowed: true, retryAfterSeconds: 0 });
  const [bucketKey, windowSeconds, limit] = calls[0];
  assert.match(String(bucketKey), /^[0-9a-f]{64}$/);
  assert.ok(!String(bucketKey).includes("7999"), "raw phone must not be stored");
  assert.equal(windowSeconds, 3600);
  assert.equal(limit, 2);

  nextRows = [{ hits: 3, retry_after_seconds: 100 }];
  assert.deepEqual(await limiter.consume("orders:phone:+79990000000", 2, 3600), { allowed: false, retryAfterSeconds: 100 });

  // Already over the limit: the row is not rewritten and no row is returned.
  nextRows = [];
  const decision = await limiter.consume("orders:phone:+79990000000", 2, 3600);
  assert.equal(decision.allowed, false);
  assert.ok(decision.retryAfterSeconds >= 1 && decision.retryAfterSeconds <= 3600);
});

test("enforceRateLimit throws the existing 429 format and skips unknown subjects", async () => {
  const limiter = new InMemoryRateLimiter({ now: () => 0 });
  const rule = { scope: "orders:ip", limit: 1, windowSeconds: 3600 };
  await enforceRateLimit(limiter, rule, null, { message: "x" });
  await enforceRateLimit(limiter, rule, null, { message: "x" });
  await enforceRateLimit(limiter, rule, "203.0.113.7", { message: "Слишком много заказов." });
  await assert.rejects(
    enforceRateLimit(limiter, rule, "203.0.113.7", { message: "Слишком много заказов." }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "RATE_LIMIT_EXCEEDED" &&
      error.statusCode === 429 &&
      error.message === "Слишком много заказов. Повторите через 1 ч.",
  );
  assert.equal(formatRetryAfter(5), "5 сек.");
  assert.equal(formatRetryAfter(61), "2 мин.");
});

test("security limits use conservative defaults and validate env overrides", () => {
  const defaults = readSecurityLimits({});
  assert.equal(defaults.orders.perIp.limit, 10);
  assert.equal(defaults.orders.perPhone.limit, 5);
  assert.equal(defaults.orders.maximumActiveReservationsPerContact, 3);
  assert.equal(defaults.otp.maximumFailedAttemptsPerEmail, 15);
  assert.equal(defaults.otp.failedAttemptsWindowSeconds, 86_400);
  assert.equal(defaults.oneC.perIp.limit, 120);
  assert.equal(defaults.oneC.perIp.windowSeconds, 60);

  const overridden = readSecurityLimits({ RATE_LIMIT_ORDERS_PER_IP: "25", OTP_MAX_FAILED_ATTEMPTS_PER_EMAIL: "" });
  assert.equal(overridden.orders.perIp.limit, 25);
  assert.equal(overridden.otp.maximumFailedAttemptsPerEmail, 15);

  assert.throws(
    () => readSecurityLimits({ RATE_LIMIT_ORDERS_PER_IP: "0", ORDER_MAX_ACTIVE_RESERVATIONS_PER_CONTACT: "abc" }),
    /RATE_LIMIT_ORDERS_PER_IP, ORDER_MAX_ACTIVE_RESERVATIONS_PER_CONTACT/,
  );
});

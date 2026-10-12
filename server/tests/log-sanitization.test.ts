import assert from "node:assert/strict";
import test from "node:test";
import { redactPersonalData, sanitizeError, sanitizeLogContext } from "../types/common.js";
import { ApplicationError } from "../utils/errors.js";

test("emails and phones are masked in logged text", () => {
  assert.equal(
    redactPersonalData("Yandex Postbox вернул HTTP 400: Address victim.name+tag@mail.ru rejected, call +7 (999) 123-45-67"),
    "Yandex Postbox вернул HTTP 400: Address [email] rejected, call [phone]",
  );
  assert.equal(redactPersonalData("order AW-001001 failed"), "order AW-001001 failed");
});

test("pg errors are logged without detail and with a redacted message", () => {
  const pgError = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
    code: "23505",
    detail: "Key (email)=(victim@mail.ru) already exists.",
    constraint: "users_email_key",
    table: "users",
  });
  const summary = sanitizeError(pgError);
  assert.equal(summary.code, "23505");
  assert.equal(summary.constraint, "users_email_key");
  assert.equal(summary.detail, undefined);
  assert.ok(!JSON.stringify(summary).includes("victim@mail.ru"));
  assert.ok(String(summary.stack ?? "").startsWith("at "));
});

test("log context keeps safe fields and summarizes errors", () => {
  const context = sanitizeLogContext({
    error: new ApplicationError({ code: "RATE_LIMIT_EXCEEDED", message: "Слишком много запросов.", statusCode: 429 }),
    notificationId: "n1",
    recipient: "victim@mail.ru",
    attempt: 3,
  });
  assert.deepEqual(context.error, {
    name: "ApplicationError",
    code: "RATE_LIMIT_EXCEEDED",
    statusCode: 429,
    message: "Слишком много запросов.",
  });
  assert.equal(context.notificationId, "n1");
  assert.equal(context.recipient, "[email]");
  assert.equal(context.attempt, 3);
  assert.deepEqual(sanitizeLogContext({ error: "boom" }).error, { type: "string" });
});

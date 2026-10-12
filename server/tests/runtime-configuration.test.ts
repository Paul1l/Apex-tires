import assert from "node:assert/strict";
import test from "node:test";
import {
  findRuntimeConfigurationProblems,
  reportRuntimeConfigurationOnce,
} from "../config/runtime-configuration.js";

const pepper = "p".repeat(40);
const database = "postgresql://apex@127.0.0.1:5432/apex";

function resetReportedFlag() {
  delete (globalThis as { apexRuntimeConfigurationReported?: boolean }).apexRuntimeConfigurationReported;
}

test("preview without a database reports nothing (Cloudflare demo, Docker build)", () => {
  assert.deepEqual(findRuntimeConfigurationProblems({}, "preview"), []);
  assert.deepEqual(findRuntimeConfigurationProblems({ NODE_ENV: "production" }, undefined), []);
});

test("database mode without OTP_CODE_PEPPER is reported by name", () => {
  const problems = findRuntimeConfigurationProblems(
    { DATABASE_URL: database, TRUSTED_PROXY: "nginx", NODE_ENV: "production" },
    "database",
  );
  assert.deepEqual(problems.map((problem) => [problem.severity, problem.variable]), [["error", "OTP_CODE_PEPPER"]]);
  assert.match(problems[0].message, /CART_SECURITY_NOT_CONFIGURED/);
});

test("database build without DATABASE_URL, invalid env and limits are reported", () => {
  const missingDatabase = findRuntimeConfigurationProblems({ OTP_CODE_PEPPER: pepper }, "database");
  assert.deepEqual(missingDatabase.map((problem) => problem.variable), ["DATABASE_URL"]);

  const invalid = findRuntimeConfigurationProblems(
    { DATABASE_URL: database, OTP_CODE_PEPPER: "short", RATE_LIMIT_ORDERS_PER_IP: "0", TRUSTED_PROXY: "proxy" },
    "database",
  );
  assert.deepEqual(invalid.map((problem) => problem.variable), ["backend", "rate limits", "TRUSTED_PROXY"]);
  assert.match(invalid[0].message, /OTP_CODE_PEPPER/);
  assert.ok(!JSON.stringify(invalid).includes("short"), "values are never logged");
});

test("missing TRUSTED_PROXY in production is a warning", () => {
  const problems = findRuntimeConfigurationProblems(
    { DATABASE_URL: database, OTP_CODE_PEPPER: pepper, NODE_ENV: "production" },
    "database",
  );
  assert.deepEqual(problems.map((problem) => [problem.severity, problem.variable]), [["warning", "TRUSTED_PROXY"]]);
});

test("problems are logged once per process", () => {
  resetReportedFlag();
  const lines: string[] = [];
  const logger = { error: (line: string) => lines.push(line), warn: (line: string) => lines.push(line) };
  const environment = { DATABASE_URL: database, NODE_ENV: "development" };
  reportRuntimeConfigurationOnce(environment, logger);
  reportRuntimeConfigurationOnce(environment, logger);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[config\] ОШИБКА \(OTP_CODE_PEPPER\)/);
  resetReportedFlag();
});

test("instrumentation reports at server start and never throws", async (context) => {
  resetReportedFlag();
  const environment = process.env as Record<string, string | undefined>;
  const previous = { DATABASE_URL: environment.DATABASE_URL, OTP_CODE_PEPPER: environment.OTP_CODE_PEPPER, NEXT_RUNTIME: environment.NEXT_RUNTIME };
  const errors: string[] = [];
  context.mock.method(console, "error", (line: string) => errors.push(line));
  try {
    environment.DATABASE_URL = database;
    delete environment.OTP_CODE_PEPPER;
    environment.NEXT_RUNTIME = "nodejs";
    const { register } = await import("../../instrumentation.js");
    await register();
    assert.ok(errors.some((line) => line.includes("OTP_CODE_PEPPER")), JSON.stringify(errors));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
    resetReportedFlag();
  }
});

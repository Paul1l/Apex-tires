import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import type { Pool } from "pg";
import {
  DATABASE_RETRY_DEADLINE_MILLISECONDS,
  retryWhileDatabaseUnavailable,
} from "../database/database-retry.js";
import { ImportJobRepository } from "../repositories/import-job-repository.js";
import { AdminAuditRepository } from "../repositories/admin-audit-repository.js";
import { ProductRepository } from "../repositories/product-repository.js";
import {
  CatalogImportService,
  DEFAULT_STALE_IMPORT_MINUTES,
  failStaleImportJobs,
  readStaleImportMinutes,
  staleImportReason,
} from "../services/catalog-import-service.js";

function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Fake clock: sleep() advances time instead of waiting. */
function fakeTime() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (milliseconds: number) => { sleeps.push(milliseconds); now += milliseconds; },
  };
}

async function quietly<Result>(run: () => Promise<Result>): Promise<Result> {
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

test("retry: repeats while the database is unavailable, then succeeds", async () => {
  const time = fakeTime();
  const failures = [
    pgError("the database system is shutting down", "57P03"),
    pgError("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED"),
  ];
  let calls = 0;
  const result = await retryWhileDatabaseUnavailable(async () => {
    calls += 1;
    const failure = failures.shift();
    if (failure) throw failure;
    return "saved";
  }, time);
  assert.equal(result, "saved");
  assert.equal(calls, 3);
  assert.deepEqual(time.sleeps, [1_000, 2_000]);
});

test("retry: other errors are not repeated", async () => {
  let calls = 0;
  await assert.rejects(
    retryWhileDatabaseUnavailable(async () => {
      calls += 1;
      throw pgError("duplicate key value violates unique constraint", "23505");
    }, fakeTime()),
    (error: Error & { code?: string }) => error.code === "23505",
  );
  assert.equal(calls, 1);
});

test("retry: gives up within the deadline (30–60 s) and throws the last error", async () => {
  const time = fakeTime();
  let calls = 0;
  await assert.rejects(
    retryWhileDatabaseUnavailable(async () => {
      calls += 1;
      throw pgError(`connect ECONNREFUSED (attempt ${calls})`, "ECONNREFUSED");
    }, time),
    /attempt 6/,
  );
  assert.deepEqual(time.sleeps, [1_000, 2_000, 4_000, 8_000, 15_000]);
  const waited = time.sleeps.reduce((sum, value) => sum + value, 0);
  assert.ok(waited >= 30_000 && waited <= DATABASE_RETRY_DEADLINE_MILLISECONDS);
  assert.ok(DATABASE_RETRY_DEADLINE_MILLISECONDS <= 60_000);

  // Slow attempts (each 6 s, e.g. connect timeouts) also stop at the deadline.
  const slow = fakeTime();
  let slowCalls = 0;
  await assert.rejects(retryWhileDatabaseUnavailable(async () => {
    slowCalls += 1;
    await slow.sleep(6_000);
    throw pgError("timeout", "ETIMEDOUT");
  }, { sleep: slow.sleep, now: slow.now }));
  assert.ok(slow.now() <= DATABASE_RETRY_DEADLINE_MILLISECONDS + 6_000, String(slow.now()));
  assert.ok(slowCalls < 6);
});

/** Import job repository double that records calls; finish() follows a script. */
function fakeJobs(finishFailures: Error[]) {
  const calls: string[] = [];
  const finished: Array<{ status: string; summary?: string }> = [];
  const repository = {
    async failStale(_database: unknown, minutes: number, reason: string) {
      calls.push(`failStale:${minutes}:${reason}`);
      return [];
    },
    async create() { calls.push("create"); return "job-1"; },
    async start() { calls.push("start"); },
    async finish(_database: unknown, _id: string, status: string, summary?: string) {
      calls.push(`finish:${status}`);
      const failure = finishFailures.shift();
      if (failure) throw failure;
      finished.push({ status, summary });
    },
  };
  return { calls, finished, repository: repository as unknown as ImportJobRepository };
}

function brokenStream(message: string): ReadableStream<Uint8Array> {
  return new ReadableStream({ pull(controller) { controller.error(pgError(message, "57P01")); } });
}

function service(jobs: ReturnType<typeof fakeJobs>, time = fakeTime(), staleImportMinutes = 30) {
  return new CatalogImportService(
    {} as Pool,
    {} as ProductRepository,
    {} as AdminAuditRepository,
    jobs.repository,
    undefined,
    { statusRetry: { sleep: time.sleep, now: time.now }, staleImportMinutes },
  );
}

test("interrupted import: the failed status is saved after PostgreSQL comes back (QA-24)", async () => {
  const jobs = fakeJobs([
    pgError("the database system is shutting down", "57P03"),
    pgError("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED"),
  ]);
  const time = fakeTime();
  await quietly(() =>
    assert.rejects(
      service(jobs, time).importProductsCsvStream(brokenStream("terminating connection"), "a.csv"),
      // The caller gets the original error, not the status-write error.
      (error: Error & { code?: string }) => error.code === "57P01",
    ),
  );
  assert.deepEqual(jobs.finished, [{ status: "failed", summary: "terminating connection" }]);
  assert.deepEqual(time.sleeps, [1_000, 2_000]);
});

test("interrupted import: if PostgreSQL stays down, the import still ends after a bounded wait", async () => {
  const down = () => pgError("connect ECONNREFUSED", "ECONNREFUSED");
  const jobs = fakeJobs(Array.from({ length: 20 }, down));
  const time = fakeTime();
  await quietly(() =>
    assert.rejects(
      service(jobs, time).importFitmentsCsvStream(brokenStream("terminating connection"), "f.csv"),
      (error: Error & { code?: string }) => error.code === "57P01",
    ),
  );
  assert.deepEqual(jobs.finished, []);
  assert.equal(jobs.calls.filter((call) => call === "finish:failed").length, 6);
  assert.ok(time.now() <= DATABASE_RETRY_DEADLINE_MILLISECONDS);
});

test("each import first closes stale jobs with the configured threshold", async () => {
  const jobs = fakeJobs([]);
  await quietly(() =>
    assert.rejects(service(jobs, fakeTime(), 7).importProductsCsvStream(brokenStream("x"), "a.csv")),
  );
  assert.deepEqual(jobs.calls.slice(0, 3), [
    `failStale:7:${staleImportReason(7)}`,
    "create",
    "start",
  ]);
});

test("stale threshold: IMPORT_JOB_STALE_MINUTES 1–1440, default 30", () => {
  assert.equal(DEFAULT_STALE_IMPORT_MINUTES, 30);
  assert.equal(readStaleImportMinutes(undefined), 30);
  assert.equal(readStaleImportMinutes("5"), 5);
  for (const value of ["", "0", "-5", "1.5", "abc", "1441"]) assert.equal(readStaleImportMinutes(value), 30, value);
  assert.equal(staleImportReason(30), "Импорт прерван: нет признаков работы 30 мин.");
});

test("admin job list closes stale jobs before reading", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = { DATABASE_URL: environment.DATABASE_URL, DATABASE_SSL_MODE: environment.DATABASE_SSL_MODE, OTP_CODE_PEPPER: environment.OTP_CODE_PEPPER, IMPORT_JOB_STALE_MINUTES: environment.IMPORT_JOB_STALE_MINUTES };
  const previousPool = globalThis.apexPostgresPool;
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  Object.assign(environment, {
    DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
    DATABASE_SSL_MODE: "disable",
    OTP_CODE_PEPPER: "p".repeat(40),
    IMPORT_JOB_STALE_MINUTES: "12",
  });
  globalThis.apexPostgresPool = {
    query: async (text: string, values?: unknown[]) => {
      statements.push({ text, values });
      if (text.includes("FROM sessions")) {
        return { rows: [{ session_id: "s", expires_at: new Date(Date.now() + 60_000), id: "u", email: "a@example.com", phone: null, name: "A", role: "admin", status: "active" }] };
      }
      return { rows: [] };
    },
  } as unknown as Pool;
  try {
    const { GET } = await import("../../app/api/admin/imports/jobs/route.js");
    const response = await GET(new Request("https://store.example/api/admin/imports/jobs", {
      headers: { cookie: "apex_session=token" },
    }));
    assert.equal(response.status, 200);
    const stale = statements.findIndex((statement) => statement.text.includes("SET status = 'failed'"));
    const list = statements.findIndex((statement) => statement.text.includes("FROM import_jobs ORDER BY"));
    assert.ok(stale >= 0 && list > stale, "stale jobs are closed before the list is read");
    assert.deepEqual(statements[stale].values, [12, staleImportReason(12)]);
  } finally {
    globalThis.apexPostgresPool = previousPool;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  }
});

// Threshold semantics against a real PostgreSQL (schema with migration 008).
// Runs when TEST_DATABASE_URL points to a disposable database; skipped otherwise.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
test("PostgreSQL: only jobs without progress for the threshold are failed; a live long import is kept", { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not set" }, async () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 2 });
  pool.on("error", () => {});
  const repository = new ImportJobRepository();
  const insert = async (label: string, status: string, columns: string) => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO import_jobs (import_type, filename, status, started_at, last_progress_at, created_at)
       SELECT 'products_csv', $1, $2, ${columns} RETURNING id`,
      [`t17a-${label}.csv`, status],
    );
    return result.rows[0].id;
  };
  const ids: Record<string, string> = {};
  try {
    ids.dead = await insert("dead", "processing", "NOW() - interval '2 hours', NOW() - interval '31 minutes', NOW() - interval '2 hours'");
    ids.liveLong = await insert("live-long", "processing", "NOW() - interval '3 hours', NOW() - interval '2 minutes', NOW() - interval '3 hours'");
    ids.justStarted = await insert("just-started", "processing", "NOW() - interval '1 minute', NOW() - interval '1 minute', NOW() - interval '1 minute'");
    ids.legacy = await insert("legacy", "processing", "NOW() - interval '40 minutes', NULL, NOW() - interval '40 minutes'");
    ids.queued = await insert("queued", "queued", "NULL, NULL, NOW() - interval '40 minutes'");
    ids.done = await insert("done", "completed", "NOW() - interval '5 hours', NOW() - interval '5 hours', NOW() - interval '5 hours'");

    const failed = await failStaleImportJobs(pool, repository, 30);
    const ours = Object.values(ids);
    assert.deepEqual(new Set(failed.filter((id) => ours.includes(id))), new Set([ids.dead, ids.legacy, ids.queued]));
    const rows = (await pool.query<{ id: string; status: string; error_summary: string | null; finished: boolean }>(
      "SELECT id, status, error_summary, finished_at IS NOT NULL AS finished FROM import_jobs WHERE id = ANY($1::uuid[])",
      [ours],
    )).rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const key of ["dead", "legacy", "queued"]) {
      assert.equal(byId.get(ids[key])?.status, "failed", key);
      assert.equal(byId.get(ids[key])?.error_summary, staleImportReason(30), key);
      assert.equal(byId.get(ids[key])?.finished, true, key);
    }
    assert.equal(byId.get(ids.liveLong)?.status, "processing");
    assert.equal(byId.get(ids.justStarted)?.status, "processing");
    assert.equal(byId.get(ids.done)?.status, "completed");

    // Progress of a live import moves last_progress_at forward.
    await pool.query("UPDATE import_jobs SET last_progress_at = NOW() - interval '29 minutes' WHERE id = $1", [ids.liveLong]);
    await repository.updateProgress(pool, ids.liveLong, { totalRows: 10, processedRows: 10, createdRows: 1, updatedRows: 9, failedRows: 0 });
    const progressed = await pool.query<{ fresh: boolean }>(
      "SELECT last_progress_at > NOW() - interval '1 minute' AS fresh FROM import_jobs WHERE id = $1",
      [ids.liveLong],
    );
    assert.equal(progressed.rows[0].fresh, true);
  } finally {
    await pool.query("DELETE FROM import_jobs WHERE filename LIKE 't17a-%'");
    await pool.end();
  }
});

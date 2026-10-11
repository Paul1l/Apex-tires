import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import pg from "pg";
import type { Pool } from "pg";
import { checkOutClient, withTransaction } from "../database/postgres-client.js";
import { ApplicationError, isDatabaseUnavailableError, toSafeError } from "../utils/errors.js";

type QueryScript = (sql: string, client: FakeClient) => Promise<unknown>;

/**
 * Stand-in for pg.Client used by the real pg-pool (`new pg.Pool({ Client })`):
 * pg-pool removes its idle "error" listener on checkout exactly as with a
 * real connection, so an "error" emitted while checked out is unhandled
 * unless withTransaction / checkOutClient listen for it.
 */
class FakeClient extends EventEmitter {
  static script: QueryScript = async () => ({ rows: [] });
  static instances: FakeClient[] = [];
  readonly queries: string[] = [];
  _queryable = true;
  _ending = false;
  released: Array<Error | undefined> = [];

  constructor() {
    super();
    FakeClient.instances.push(this);
  }

  connect(callback?: (error?: Error) => void) {
    callback?.();
    return Promise.resolve();
  }

  query(sql: string) {
    this.queries.push(sql);
    return FakeClient.script(sql, this);
  }

  end(callback?: () => void) {
    this._ending = true;
    this._queryable = false;
    callback?.();
    return Promise.resolve();
  }

  /** Simulates the socket closing under an active query (pg_terminate_backend). */
  loseConnection() {
    this._queryable = false;
    // Like pg: the event comes from the socket, outside the query's promise chain.
    setImmediate(() => this.emit("error", new Error("Connection terminated unexpectedly")));
  }
}

function fakePool(script: QueryScript): Pool {
  FakeClient.script = script;
  FakeClient.instances = [];
  const pool = new pg.Pool({ Client: FakeClient as unknown as typeof pg.Client, max: 1 });
  pool.on("error", () => {});
  return pool;
}

function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

async function captureConsoleErrors<Result>(run: () => Promise<Result>) {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    return { result: await run().catch((error: unknown) => ({ rejected: error })), logged };
  } finally {
    console.error = original;
  }
}

test("withTransaction: commit, listener removed and client reused", async () => {
  const pool = fakePool(async () => ({ rows: [] }));
  const result = await withTransaction(pool, async (client) => {
    assert.equal(client.listenerCount("error"), 1);
    await client.query("SELECT 1");
    return "done";
  });
  assert.equal(result, "done");
  const [client] = FakeClient.instances;
  assert.deepEqual(client.queries, ["BEGIN", "SELECT 1", "COMMIT"]);
  // Only pg-pool's own idle listener is left; the client stays in the pool.
  assert.equal(client.listenerCount("error"), 1);
  assert.equal(pool.idleCount, 1);
  await pool.end();
});

test("withTransaction: an SQL error is rethrown after ROLLBACK and the connection is kept", async () => {
  const pool = fakePool(async (sql) => {
    if (sql === "INSERT") throw pgError("duplicate key value violates unique constraint", "23505");
    return { rows: [] };
  });
  await assert.rejects(
    withTransaction(pool, async (client) => client.query("INSERT")),
    (error: Error & { code?: string }) => error.code === "23505",
  );
  assert.deepEqual(FakeClient.instances[0].queries, ["BEGIN", "INSERT", "ROLLBACK"]);
  assert.equal(pool.idleCount, 1);
  await pool.end();
});

test("withTransaction: lost connection mid-transaction → original error, no uncaught 'error', client closed", async () => {
  let uncaught: unknown;
  const onUncaught = (error: unknown) => { uncaught = error; };
  process.on("uncaughtException", onUncaught);
  const pool = fakePool(async (sql, client) => {
    if (sql === "UPDATE products") {
      client.loseConnection();
      await new Promise((resolve) => setImmediate(resolve));
      throw pgError("terminating connection due to administrator command (buyer@example.com)", "57P01");
    }
    if (sql === "ROLLBACK" && !client._queryable) {
      throw new Error("Client has encountered a connection error and is not queryable");
    }
    return { rows: [] };
  });
  try {
    const { result, logged } = await captureConsoleErrors(() =>
      withTransaction(pool, async (client) => client.query("UPDATE products")),
    );
    const rejected = (result as { rejected?: Error & { code?: string } }).rejected;
    // The operation error reaches the caller; the failed ROLLBACK does not replace it.
    assert.equal(rejected?.code, "57P01");
    assert.equal(uncaught, undefined);
    const messages = logged.map((entry) => String(entry[0]));
    assert.ok(messages.includes("PostgreSQL connection lost while in use"), messages.join(" | "));
    assert.ok(messages.includes("PostgreSQL ROLLBACK failed"));
    // Logged through sanitizeError: no personal data, no raw error objects.
    assert.equal(JSON.stringify(logged).includes("buyer@example.com"), false);
    for (const entry of logged) assert.equal(entry[1] instanceof Error, false);
    // The broken connection is closed, not returned to the pool.
    const [client] = FakeClient.instances;
    assert.equal(client._ending, true);
    assert.equal(pool.idleCount, 0);
    assert.equal(pool.totalCount, 0);
  } finally {
    process.off("uncaughtException", onUncaught);
    await pool.end();
  }
});

test("checkOutClient: 'error' on a checked-out client is handled; release removes the listener once", async () => {
  const pool = fakePool(async () => ({ rows: [] }));
  const connection = await checkOutClient(pool);
  const client = connection.client as unknown as FakeClient;
  // pg-pool removed its idle listener on checkout: ours is the only one.
  assert.equal(client.listenerCount("error"), 1);
  const { logged } = await captureConsoleErrors(async () => {
    assert.doesNotThrow(() => client.emit("error", new Error("Connection terminated unexpectedly")));
  });
  assert.equal(logged.length, 1);
  connection.release();
  connection.release(); // second call is a no-op (pg-pool would throw)
  assert.equal(client._ending, true, "a client that emitted 'error' is closed on release");
  await pool.end();
});

test("database unavailability is recognised and mapped to 503", () => {
  const unavailable = [
    pgError("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED"),
    pgError("terminating connection due to administrator command", "57P01"),
    pgError("the database system is starting up", "57P03"),
    pgError("connection failure", "08006"),
    pgError("sorry, too many clients already", "53300"),
    new Error("Connection terminated unexpectedly"),
    new Error("timeout exceeded when trying to connect"),
    new Error("Client has encountered a connection error and is not queryable"),
  ];
  for (const error of unavailable) {
    assert.equal(isDatabaseUnavailableError(error), true, error.message);
    assert.deepEqual(
      [toSafeError(error).statusCode, toSafeError(error).body.code],
      [503, "DATABASE_UNAVAILABLE"],
      error.message,
    );
    assert.equal(JSON.stringify(toSafeError(error).body).includes("127.0.0.1"), false);
  }
  for (const error of [
    pgError("duplicate key value violates unique constraint", "23505"),
    pgError("syntax error", "42601"),
    new Error("something else"),
    "not an error",
  ]) {
    assert.equal(isDatabaseUnavailableError(error), false);
    assert.equal(toSafeError(error).statusCode, 500);
  }
  const applicationError = new ApplicationError({ code: "X", message: "m", statusCode: 409 });
  assert.equal(toSafeError(applicationError).statusCode, 409);
});

test("GET /api/v1/products answers 503 DATABASE_UNAVAILABLE when PostgreSQL is down", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = { DATABASE_URL: environment.DATABASE_URL, DATABASE_SSL_MODE: environment.DATABASE_SSL_MODE };
  const previousPool = globalThis.apexPostgresPool;
  environment.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
  environment.DATABASE_SSL_MODE = "disable";
  globalThis.apexPostgresPool = {
    query: async () => { throw pgError("connect ECONNREFUSED 127.0.0.1:1", "ECONNREFUSED"); },
  } as unknown as Pool;
  const original = console.error;
  console.error = () => {};
  try {
    const { GET } = await import("../../app/api/v1/products/route.js");
    const response = await GET(new Request("https://store.example/api/v1/products"));
    const body = (await response.json()) as Record<string, unknown>;
    assert.deepEqual([response.status, body.ok, body.code], [503, false, "DATABASE_UNAVAILABLE"]);
    assert.equal(typeof body.message, "string");
  } finally {
    console.error = original;
    globalThis.apexPostgresPool = previousPool;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  }
});

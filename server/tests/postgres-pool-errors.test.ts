import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresPool } from "../database/postgres-client.js";
import type { ServerEnvironment } from "../config/environment.js";

test("pool logs idle client errors instead of crashing the process", async () => {
  const pool = createPostgresPool({
    DATABASE_URL: "postgres://user:password@127.0.0.1:1/none",
    databaseSsl: false,
  } as unknown as ServerEnvironment);
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    assert.ok(pool.listenerCount("error") >= 1);
    // Emitting without a listener would throw; with the listener it is logged.
    pool.emit("error", new Error("terminating connection due to administrator command"));
    assert.equal(logged.length, 1);
    assert.match(String(logged[0][0]), /PostgreSQL idle client error/);
  } finally {
    console.error = originalError;
    await pool.end();
  }
});

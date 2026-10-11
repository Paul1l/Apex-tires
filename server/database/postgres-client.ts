import pg from "pg";
import type { Pool as PgPool, PoolClient } from "pg";
import type { ServerEnvironment } from "../config/environment";
import { sanitizeError } from "../types/common";

const { Pool } = pg;

export function createPostgresPool(environment: ServerEnvironment): PgPool {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    ssl: environment.databaseSsl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "apex-wheels-backend",
  });
  // An idle client that loses its connection (PostgreSQL restart, network
  // drop) emits "error" on the pool. Without a listener Node treats it as an
  // uncaught exception and a CLI process (CSV import, migrations) would exit.
  // The broken client is discarded by pg; the next query opens a new one.
  pool.on("error", (error) => {
    console.error("PostgreSQL idle client error", sanitizeError(error));
  });
  return pool;
}

export interface CheckedOutClient {
  client: PoolClient;
  /** Marks the connection as unusable: release() then closes it instead of reusing it. */
  markBroken(error: unknown): void;
  /** Removes the error listener and returns the client to the pool (once). */
  release(): void;
}

/**
 * Takes a client from the pool for several queries (transaction, migrations).
 *
 * pg-pool removes its own "error" listener from a client while it is checked
 * out. If the connection is lost meanwhile (PostgreSQL restart,
 * pg_terminate_backend, network drop), the client emits "error"; without a
 * listener Node treats it as an uncaught exception, and a CLI process (CSV
 * import, migrations) exits. This listener logs the error without personal
 * data and marks the client as broken; the failed query still rejects, so the
 * caller gets the error. The listener is removed on release().
 */
export async function checkOutClient(pool: PgPool): Promise<CheckedOutClient> {
  const client = await pool.connect();
  let brokenBy: Error | undefined;
  let released = false;
  const onError = (error: Error) => {
    brokenBy ??= error;
    console.error("PostgreSQL connection lost while in use", sanitizeError(error));
  };
  client.on("error", onError);
  return {
    client,
    markBroken(error) {
      brokenBy ??= error instanceof Error ? error : new Error(String(error));
    },
    release() {
      if (released) return;
      released = true;
      client.removeListener("error", onError);
      // An error argument makes pg-pool close the connection instead of reusing it.
      client.release(brokenBy);
    },
  };
}

/**
 * ROLLBACK that never replaces the error which caused it: on a lost connection
 * it fails too, and the connection is then closed on release.
 */
export async function rollbackQuietly(connection: CheckedOutClient): Promise<void> {
  try {
    await connection.client.query("ROLLBACK");
  } catch (rollbackError) {
    connection.markBroken(rollbackError);
    console.error("PostgreSQL ROLLBACK failed", sanitizeError(rollbackError));
  }
}

export async function withTransaction<Result>(
  pool: PgPool,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const connection = await checkOutClient(pool);

  try {
    await connection.client.query("BEGIN");
    const result = await operation(connection.client);
    await connection.client.query("COMMIT");
    return result;
  } catch (error) {
    await rollbackQuietly(connection);
    throw error;
  } finally {
    connection.release();
  }
}

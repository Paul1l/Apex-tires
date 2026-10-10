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

export async function withTransaction<Result>(
  pool: PgPool,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

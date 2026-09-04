import pg from "pg";
import type { Pool as PgPool, PoolClient } from "pg";
import type { ServerEnvironment } from "../config/environment";

const { Pool } = pg;

export function createPostgresPool(environment: ServerEnvironment): PgPool {
  return new Pool({
    connectionString: environment.DATABASE_URL,
    ssl: environment.databaseSsl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "apex-wheels-backend",
  });
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

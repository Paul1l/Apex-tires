import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvironment } from "../config/environment";
import { createPostgresPool } from "./postgres-client";

const migrationsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);
const environment = readEnvironment();
const pool = createPostgresPool(environment);

try {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('apex_wheels_migrations'))");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
    );

    const appliedResult = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const appliedVersions = new Set(appliedResult.rows.map((row) => row.version));
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort();

    for (const migrationFile of migrationFiles) {
      if (appliedVersions.has(migrationFile)) continue;

      const migrationSql = await readFile(
        path.join(migrationsDirectory, migrationFile),
        "utf8",
      );
      await client.query("BEGIN");
      try {
        await client.query(migrationSql);
        await client.query(
          "INSERT INTO schema_migrations(version) VALUES ($1)",
          [migrationFile],
        );
        await client.query("COMMIT");
        process.stdout.write(`Applied ${migrationFile}\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('apex_wheels_migrations'))");
    client.release();
  }
} finally {
  await pool.end();
}

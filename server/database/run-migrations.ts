import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvironment } from "../config/environment";
import { sanitizeError } from "../types/common";
import { checkOutClient, createPostgresPool, rollbackQuietly } from "./postgres-client";

const migrationsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

// No top-level await: the package is CommonJS for tsx (no "type": "module"),
// and esbuild cannot emit top-level await in CJS output.
async function main(): Promise<void> {
  const environment = readEnvironment();
  const pool = createPostgresPool(environment);

  try {
    // The listener of checkOutClient keeps a lost connection from crashing
    // the process with an unhandled "error" event; the failed query rejects
    // and the migration error below is reported instead.
    const connection = await checkOutClient(pool);
    const { client } = connection;
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
          await rollbackQuietly(connection);
          console.error(`Migration ${migrationFile} was not applied`);
          throw error;
        }
      }
    } finally {
      // On a lost connection the session lock is already gone; a failed
      // unlock must not replace the original error.
      await client
        .query("SELECT pg_advisory_unlock(hashtext('apex_wheels_migrations'))")
        .catch((unlockError: unknown) => connection.markBroken(unlockError));
      connection.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migrations stopped", sanitizeError(error));
  process.exitCode = 1;
});

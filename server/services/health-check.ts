import type { ApplicationLogger } from "../types/common";

export type DatabaseHealth = "available" | "unavailable" | "not_configured";

/** Minimal anonymous health report: no versions, dependencies or settings. */
export interface PublicHealthReport {
  ok: boolean;
  status: "ok" | "degraded";
  database: DatabaseHealth;
  timestamp: string;
}

export interface DatabaseProbeOptions {
  /** Runs a trivial query; rejects when the database cannot answer. */
  query: () => Promise<unknown>;
  timeoutMilliseconds?: number;
  logger?: Pick<ApplicationLogger, "warn">;
}

export const DATABASE_PROBE_TIMEOUT_MILLISECONDS = 2_000;
/** Probe results are reused this long, so frequent anonymous checks cost one query. */
export const DATABASE_PROBE_CACHE_MILLISECONDS = 5_000;

export async function probeDatabase({
  query,
  timeoutMilliseconds = DATABASE_PROBE_TIMEOUT_MILLISECONDS,
  logger,
}: DatabaseProbeOptions): Promise<Exclude<DatabaseHealth, "not_configured">> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      query(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Database health probe timed out")),
          timeoutMilliseconds,
        );
      }),
    ]);
    return "available";
  } catch (error) {
    logger?.warn({ error }, "Database health probe failed");
    return "unavailable";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface CachedProbe {
  expiresAt: number;
  result: Promise<Exclude<DatabaseHealth, "not_configured">>;
}

/**
 * Shares one probe between concurrent and closely spaced requests (one per
 * DATABASE_PROBE_CACHE_MILLISECONDS per process).
 */
export class CachedDatabaseProbe {
  private cached: CachedProbe | null = null;

  constructor(
    private readonly options: DatabaseProbeOptions,
    private readonly cacheMilliseconds = DATABASE_PROBE_CACHE_MILLISECONDS,
    private readonly now: () => number = Date.now,
  ) {}

  check(): Promise<Exclude<DatabaseHealth, "not_configured">> {
    const currentTime = this.now();
    if (this.cached && this.cached.expiresAt > currentTime) return this.cached.result;
    const result = probeDatabase(this.options);
    this.cached = { expiresAt: currentTime + this.cacheMilliseconds, result };
    return result;
  }
}

export function createPublicHealthReport(
  database: DatabaseHealth,
  now: Date = new Date(),
): PublicHealthReport {
  const ok = database !== "unavailable";
  return { ok, status: ok ? "ok" : "degraded", database, timestamp: now.toISOString() };
}

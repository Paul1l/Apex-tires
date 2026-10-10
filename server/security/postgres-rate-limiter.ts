import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import {
  assertRateLimitArguments,
  type RateLimitDecision,
  type RateLimiter,
} from "./fixed-window-rate-limiter";

type Queryable = Pick<Pool, "query">;

// Keys are stored only as HMAC digests: IP addresses, phones and emails must
// not appear in the rate-limit table in clear text.
const FALLBACK_KEY_SECRET = "apex-wheels-rate-limit-key";

export interface PostgresRateLimiterOptions {
  /** HMAC secret for bucket keys; OTP_CODE_PEPPER in production. */
  keySecret?: string;
  /** Share of calls that also delete a bounded batch of expired buckets. */
  cleanupProbability?: number;
  random?: () => number;
}

/**
 * Persistent fixed-window limiter shared by all application processes.
 * Every call is one atomic `INSERT … ON CONFLICT DO UPDATE`, so concurrent
 * requests cannot exceed the limit. Windows are aligned to the epoch:
 * a 3600-second window resets at the start of every hour.
 */
export class PostgresRateLimiter implements RateLimiter {
  private readonly keySecret: string;
  private readonly cleanupProbability: number;
  private readonly random: () => number;

  constructor(
    private readonly database: Queryable,
    options: PostgresRateLimiterOptions = {},
  ) {
    this.keySecret = options.keySecret || FALLBACK_KEY_SECRET;
    this.cleanupProbability = options.cleanupProbability ?? 0.01;
    this.random = options.random ?? Math.random;
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    assertRateLimitArguments(key, limit, windowSeconds);
    const bucketKey = createHmac("sha256", this.keySecret).update(key).digest("hex");
    // Once a bucket is over the limit the row is no longer rewritten
    // (the WHERE clause), so a flood does not turn into a write storm.
    const result = await this.database.query<{ hits: number; retry_after_seconds: number }>(
      `WITH bucket AS (
         SELECT to_timestamp(floor(extract(epoch FROM now()) / $2::integer) * $2::integer) AS started_at
       )
       INSERT INTO rate_limit_buckets AS existing
         (bucket_key, window_seconds, window_started_at, hits, expires_at)
       SELECT $1, $2::integer, bucket.started_at, 1,
              bucket.started_at + make_interval(secs => $2::integer)
       FROM bucket
       ON CONFLICT (bucket_key, window_seconds, window_started_at)
       DO UPDATE SET hits = existing.hits + 1
       WHERE existing.hits <= $3::integer
       RETURNING hits,
         GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::integer AS retry_after_seconds`,
      [bucketKey, windowSeconds, limit],
    );

    if (this.random() < this.cleanupProbability) {
      await pruneExpiredRateLimitBuckets(this.database).catch(() => undefined);
    }

    const row = result.rows[0];
    if (row && row.hits <= limit) return { allowed: true, retryAfterSeconds: 0 };
    const retryAfterSeconds =
      row?.retry_after_seconds ??
      Math.max(1, windowSeconds - (Math.floor(Date.now() / 1_000) % windowSeconds));
    return { allowed: false, retryAfterSeconds };
  }
}

/** Deletes a bounded batch of expired buckets; safe to call repeatedly. */
export async function pruneExpiredRateLimitBuckets(
  database: Queryable,
  batchSize = 1_000,
): Promise<number> {
  const result = await database.query(
    `DELETE FROM rate_limit_buckets
     WHERE ctid = ANY(ARRAY(
       SELECT ctid FROM rate_limit_buckets
       WHERE expires_at < now()
       LIMIT $1
     ))`,
    [Math.max(1, Math.min(10_000, Math.floor(batchSize)))],
  );
  return result.rowCount ?? 0;
}

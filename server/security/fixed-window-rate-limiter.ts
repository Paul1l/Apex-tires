export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the current window closes; 0 when the request is allowed. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limiter. `key` identifies the protected subject
 * (scope + address/phone/email); `limit` requests are allowed per
 * `windowSeconds`.
 */
export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>;
}

export function assertRateLimitArguments(key: string, limit: number, windowSeconds: number): void {
  if (!key) throw new Error("Rate limit key is required");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer");
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 604_800) {
    throw new Error("Rate limit window must be between 1 second and 7 days");
  }
}

interface RateLimitEntry {
  hits: number;
  resetsAt: number;
}

export interface InMemoryRateLimiterOptions {
  /** Hard cap on tracked keys; the oldest windows are evicted beyond it. */
  maximumEntries?: number;
  /** How often expired windows are swept out of the map. */
  sweepIntervalMilliseconds?: number;
  now?: () => number;
}

/**
 * Process-local limiter for the no-database mode and for tests. It does not
 * share state between processes or Cloudflare isolates; production uses
 * `PostgresRateLimiter`. Expired windows are evicted periodically and the map
 * never grows past `maximumEntries`.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly maximumEntries: number;
  private readonly sweepIntervalMilliseconds: number;
  private readonly now: () => number;
  private nextSweepAt = 0;

  constructor(options: InMemoryRateLimiterOptions = {}) {
    this.maximumEntries = options.maximumEntries ?? 10_000;
    this.sweepIntervalMilliseconds = options.sweepIntervalMilliseconds ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    return this.consumeNow(key, limit, windowSeconds);
  }

  consumeNow(key: string, limit: number, windowSeconds: number): RateLimitDecision {
    assertRateLimitArguments(key, limit, windowSeconds);
    const now = this.now();
    this.evict(now);

    const entryKey = `${windowSeconds}:${key}`;
    const current = this.entries.get(entryKey);
    if (!current || current.resetsAt <= now) {
      // Re-insert so Map order stays "oldest window first" for eviction.
      this.entries.delete(entryKey);
      this.entries.set(entryKey, { hits: 1, resetsAt: now + windowSeconds * 1_000 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.hits >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1_000)),
      };
    }
    current.hits += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private evict(now: number): void {
    if (now >= this.nextSweepAt) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.resetsAt <= now) this.entries.delete(entryKey);
      }
      this.nextSweepAt = now + this.sweepIntervalMilliseconds;
    }
    // At the cap: drop the oldest windows (Map order), which are also the
    // first to expire. Losing a live window only resets that key's counter,
    // which is preferable to unbounded memory; this stays O(1) per request.
    for (const entryKey of this.entries.keys()) {
      if (this.entries.size < this.maximumEntries) break;
      this.entries.delete(entryKey);
    }
  }
}

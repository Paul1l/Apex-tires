interface RateLimitEntry {
  requests: number;
  resetsAt: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly maximumRequests: number,
    private readonly windowMilliseconds: number,
  ) {}

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    const current = this.entries.get(key);
    if (!current || current.resetsAt <= now) {
      this.entries.set(key, {
        requests: 1,
        resetsAt: now + this.windowMilliseconds,
      });
      return { allowed: true, retryAfter: 0 };
    }

    if (current.requests >= this.maximumRequests) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((current.resetsAt - now) / 1_000)),
      };
    }

    current.requests += 1;
    return { allowed: true, retryAfter: 0 };
  }
}

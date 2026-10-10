import type { RateLimitRule } from "../config/security-limits";
import { ApplicationError } from "../utils/errors";
import type { RateLimiter } from "./fixed-window-rate-limiter";

export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} сек.`;
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)} мин.`;
  return `${Math.ceil(seconds / 3_600)} ч.`;
}

/**
 * Consumes one request from `rule` for `subject` and throws the existing
 * 429 error format when the limit is exhausted. A `null` subject (for example
 * an unknown client IP) is not limited by this rule: grouping all unknown
 * clients into one bucket would block every visitor at once.
 */
export async function enforceRateLimit(
  limiter: RateLimiter,
  rule: RateLimitRule,
  subject: string | null | undefined,
  error: { code?: string; message: string },
): Promise<void> {
  if (!subject) return;
  const decision = await limiter.consume(`${rule.scope}:${subject}`, rule.limit, rule.windowSeconds);
  if (decision.allowed) return;
  throw new ApplicationError({
    code: error.code ?? "RATE_LIMIT_EXCEEDED",
    message: `${error.message} Повторите через ${formatRetryAfter(decision.retryAfterSeconds)}`,
    statusCode: 429,
  });
}

export function normalizeEmailForLimits(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

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

/**
 * Staff sign-in with an authenticator code (POST /api/auth/staff/login).
 * Fixed defensive limits on top of the lockouts (5 wrong codes → 15 minutes):
 * every attempt counts, successful or not.
 * - perIp: always, for the client address;
 * - perEmail: attempts without a valid trusted-device token, for the email
 *   typed (existing or not, so the limit reveals nothing about which
 *   addresses belong to staff);
 * - perDevice: attempts with a valid trusted-device token, for the pair
 *   email + device, so a stranger exhausting perEmail does not block the
 *   employee's own browsers (OWASP "device cookies").
 */
export const STAFF_LOGIN_RATE_LIMITS = {
  perIp: { scope: "staff-login:ip", limit: 20, windowSeconds: 900 },
  perEmail: { scope: "staff-login:email", limit: 10, windowSeconds: 900 },
  perDevice: { scope: "staff-login:device", limit: 10, windowSeconds: 900 },
} as const satisfies Record<string, RateLimitRule>;

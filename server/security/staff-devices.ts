/**
 * Trusted staff devices (OWASP "device cookies", QA-28).
 *
 * After a successful staff sign-in the browser keeps a random device token
 * in an HttpOnly, SameSite=Strict cookie that is sent only to the staff
 * sign-in endpoint. An attempt with a valid token for that email counts
 * failures and lockout on the device only; the account-wide lockout and the
 * per-email limit apply to attempts without one. A stranger who knows the
 * email can therefore lock out new browsers, but not the ones the employee
 * already signed in from.
 *
 * One browser may be shared by several employees: the cookie keeps up to
 * MAXIMUM_DEVICE_TOKENS_PER_COOKIE tokens separated by dots, each bound to
 * one account on the server.
 */
export const STAFF_DEVICE_COOKIE_NAME = "apex_staff_device";
export const STAFF_DEVICE_COOKIE_PATH = "/api/auth/staff/login";
export const STAFF_DEVICE_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
export const MAXIMUM_DEVICE_TOKENS_PER_COOKIE = 5;
/** Trusted devices kept per account; the least recently used are dropped. */
export const MAXIMUM_TRUSTED_DEVICES_PER_USER = 10;
/** Consecutive wrong codes from one trusted device before it is locked. */
export const STAFF_DEVICE_MAX_FAILED_ATTEMPTS = 5;

const DEVICE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Prefix of the HMAC input, distinct from session tokens (`session:`). */
export function staffDeviceDigestInput(token: string): string {
  return `staff-device:${token}`;
}

/** Value of one cookie from a Cookie header (null when absent or malformed). */
export function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return null;
  }
}

/** Well-formed tokens of the cookie, most recent last, without duplicates. */
export function parseStaffDeviceCookie(value: string | null | undefined): string[] {
  if (!value || value.length > 1_000) return [];
  const tokens = value.split(".").filter((token) => DEVICE_TOKEN_PATTERN.test(token));
  return [...new Set(tokens)].slice(-MAXIMUM_DEVICE_TOKENS_PER_COOKIE);
}

/**
 * Cookie tokens after a successful sign-in: the token this account used is
 * replaced by the newly issued one; tokens of other accounts stay.
 */
export function nextStaffDeviceTokens(
  current: readonly string[],
  replaced: string | undefined,
  issued: string,
): string[] {
  const kept = current.filter((token) => token !== replaced && token !== issued);
  return [...kept, issued].slice(-MAXIMUM_DEVICE_TOKENS_PER_COOKIE);
}

export function serializeStaffDeviceCookie(tokens: readonly string[]): string {
  return tokens.join(".");
}

export function staffDeviceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: STAFF_DEVICE_COOKIE_PATH,
    maxAge: STAFF_DEVICE_LIFETIME_SECONDS,
  };
}

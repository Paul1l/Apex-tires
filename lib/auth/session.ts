export const AUTHENTICATION_COOKIE_NAME = "apex_session";
export const GUEST_CART_COOKIE_NAME = "apex_guest_cart";
/** Customer session created by the email-code sign-in. */
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
/** Staff session created by the authenticator-app (TOTP) sign-in at /admin. */
export const STAFF_SESSION_LIFETIME_SECONDS = 12 * 60 * 60;

/**
 * How a session was opened (`sessions.auth_method`). The `manager` and
 * `admin` roles act only through a `staff_totp` session; any other session of
 * the same user is treated as a customer session.
 */
export type SessionAuthMethod = "customer_otp" | "staff_totp";

/** Options of the `apex_session` cookie, shared by every sign-in endpoint. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

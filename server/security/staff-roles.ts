import type { SessionAuthMethod } from "../../lib/auth/session";
import type { UserRole } from "../repositories/auth-repository";

export const STAFF_ROLES = ["manager", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/**
 * Role a session actually grants. `manager` and `admin` act only through a
 * session opened by the staff authenticator sign-in; the email-code session
 * of the same person is a customer session (orders, cart, account).
 */
export function effectiveSessionRole(
  role: UserRole,
  authMethod: SessionAuthMethod | null | undefined,
): UserRole {
  if (!isStaffRole(role)) return role;
  return authMethod === "staff_totp" ? role : "customer";
}

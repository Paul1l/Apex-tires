import { cookies } from "next/headers";
import { AUTHENTICATION_COOKIE_NAME } from "../../lib/auth/session";
import type { UserProfile } from "../../lib/types";
import {
  authenticationSessionsAreConfigured,
  createApplicationServices,
} from "../bootstrap/application-services";
import type { UserRole } from "../repositories/auth-repository";

export type StaffPageAccess =
  | { status: "allowed"; user: UserProfile }
  | { status: "not_configured" }
  | { status: "signed_out" }
  | { status: "forbidden" };

/**
 * Single access check for every /admin/** server page. API routes keep
 * using requireUserRole; both must accept and reject the same sessions.
 */
export async function getStaffPageAccess(
  allowedRoles: readonly UserRole[] = ["manager", "admin"],
): Promise<StaffPageAccess> {
  if (!authenticationSessionsAreConfigured()) return { status: "not_configured" };
  const sessionToken = (await cookies()).get(AUTHENTICATION_COOKIE_NAME)?.value;
  if (!sessionToken) return { status: "signed_out" };
  const user =
    await createApplicationServices().authService?.getUserBySessionToken(sessionToken);
  if (!user) return { status: "signed_out" };
  if (!allowedRoles.includes(user.role)) return { status: "forbidden" };
  return { status: "allowed", user };
}

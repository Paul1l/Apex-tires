import { cookies } from "next/headers";
import { AUTHENTICATION_COOKIE_NAME } from "../../lib/auth/session";
import type { UserProfile } from "../../lib/types";
import { authenticationSessionsAreConfigured } from "../bootstrap/application-services";
import type { UserRole } from "../repositories/auth-repository";
import { decideRoleAccess, lookUpSessionUser } from "./request-auth";

export type StaffPageAccess =
  | { status: "allowed"; user: UserProfile }
  | { status: "not_configured" }
  | { status: "signed_out" }
  | { status: "forbidden" };

/**
 * Single access check for every /admin/** server page. API routes use
 * requireUserRole; both resolve the session with lookUpSessionUser and decide
 * with decideRoleAccess, so they accept and reject the same sessions.
 * `manager`/`admin` count only for a session opened by the staff
 * authenticator sign-in; the email-code session of the same person is
 * "forbidden" here (a customer session).
 */
export async function getStaffPageAccess(
  allowedRoles: readonly UserRole[] = ["manager", "admin"],
): Promise<StaffPageAccess> {
  if (!authenticationSessionsAreConfigured()) return { status: "not_configured" };
  const sessionToken = (await cookies()).get(AUTHENTICATION_COOKIE_NAME)?.value;
  if (!sessionToken) return { status: "signed_out" };
  const user = await lookUpSessionUser(sessionToken);
  const decision = decideRoleAccess(user, allowedRoles);
  if (decision === "allowed" && user) return { status: "allowed", user };
  return { status: decision === "forbidden" ? "forbidden" : "signed_out" };
}

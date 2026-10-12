import { cookies } from "next/headers";
import { AUTHENTICATION_COOKIE_NAME } from "../../lib/auth/session";
import type { UserProfile } from "../../lib/types";
import { authenticationSessionsAreConfigured } from "../bootstrap/application-services";
import type { UserRole } from "../repositories/auth-repository";
import { applicationLogger } from "../types/common";
import { isDatabaseUnavailableError } from "../utils/errors";
import { decideRoleAccess, lookUpSessionUser, type SessionUserLookup } from "./request-auth";

export type StaffPageAccess =
  | { status: "allowed"; user: UserProfile }
  | { status: "not_configured" }
  | { status: "signed_out" }
  | { status: "forbidden" }
  /** The session could not be checked: PostgreSQL is down or not usable. */
  | { status: "unavailable" };

/**
 * Decision for a session token; `lookUpUser` is replaced in tests. A failed
 * lookup is "unavailable" (the page shows a message instead of a 500), and
 * is logged without the token or personal data.
 */
export async function resolveStaffPageAccess(
  sessionToken: string | null | undefined,
  allowedRoles: readonly UserRole[],
  lookUpUser: SessionUserLookup,
): Promise<StaffPageAccess> {
  if (!sessionToken) return { status: "signed_out" };
  let user: UserProfile | null;
  try {
    user = await lookUpUser(sessionToken);
  } catch (error) {
    applicationLogger.error(
      { error },
      isDatabaseUnavailableError(error)
        ? "Staff page access: database unavailable"
        : "Staff page access: session lookup failed",
    );
    return { status: "unavailable" };
  }
  const decision = decideRoleAccess(user, allowedRoles);
  if (decision === "allowed" && user) return { status: "allowed", user };
  return { status: decision === "forbidden" ? "forbidden" : "signed_out" };
}

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
  return resolveStaffPageAccess(sessionToken, allowedRoles, lookUpSessionUser);
}

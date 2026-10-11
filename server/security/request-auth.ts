import { AUTHENTICATION_COOKIE_NAME } from "../../lib/auth/session";
import type { UserProfile } from "../../lib/types";
import {
  authenticationSessionsAreConfigured,
  createApplicationServices,
} from "../bootstrap/application-services";
import type { UserRole } from "../repositories/auth-repository";
import { ApplicationError } from "../utils/errors";
import { requireSameOrigin } from "./request-origin";

/** Resolves a session token to the profile with the role the session grants. */
export type SessionUserLookup = (token: string) => Promise<UserProfile | null>;

export type RoleAccessDecision = "allowed" | "signed_out" | "forbidden";

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTHENTICATION_COOKIE_NAME}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(AUTHENTICATION_COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
}

/**
 * Session lookup shared by API routes (requireUserRole) and /admin pages
 * (getStaffPageAccess). AuthService returns the effective role: `manager`
 * and `admin` only for a session opened by the staff authenticator sign-in.
 */
export async function lookUpSessionUser(token: string | null | undefined): Promise<UserProfile | null> {
  if (!token || !authenticationSessionsAreConfigured()) return null;
  return (await createApplicationServices().authService?.getUserBySessionToken(token)) ?? null;
}

/** One rule for pages and API routes, so both accept the same sessions. */
export function decideRoleAccess(
  user: UserProfile | null,
  allowedRoles: readonly UserRole[],
): RoleAccessDecision {
  if (!user) return "signed_out";
  return allowedRoles.includes(user.role) ? "allowed" : "forbidden";
}

export async function getAuthenticatedUser(
  request: Request,
): Promise<UserProfile | null> {
  return lookUpSessionUser(readSessionToken(request.headers.get("cookie")));
}

/**
 * requireUserRole with an explicit session lookup (tests use a fake one).
 * Checks Origin for state-changing methods, then the session and its role.
 */
export async function authorizeRequest(
  request: Request,
  allowedRoles: readonly UserRole[],
  lookUpUser: SessionUserLookup,
): Promise<UserProfile> {
  requireSameOrigin(request);
  const token = readSessionToken(request.headers.get("cookie"));
  const user = token ? await lookUpUser(token) : null;
  const decision = decideRoleAccess(user, allowedRoles);
  if (decision === "signed_out" || !user) {
    throw new ApplicationError({
      code: "AUTHENTICATION_REQUIRED",
      message: "Для этого действия необходимо войти в аккаунт.",
      statusCode: 401,
    });
  }
  if (decision === "forbidden") {
    throw new ApplicationError({
      code: "ACCESS_DENIED",
      message: "У вашей учетной записи нет прав для этого действия.",
      statusCode: 403,
    });
  }
  return user;
}

export async function requireUserRole(
  request: Request,
  allowedRoles: readonly UserRole[],
): Promise<UserProfile> {
  return authorizeRequest(request, allowedRoles, lookUpSessionUser);
}

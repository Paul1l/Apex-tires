import { AUTHENTICATION_COOKIE_NAME } from "../../lib/auth/session";
import type { UserProfile } from "../../lib/types";
import {
  authenticationSessionsAreConfigured,
  createApplicationServices,
} from "../bootstrap/application-services";
import type { UserRole } from "../repositories/auth-repository";
import { ApplicationError } from "../utils/errors";

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTHENTICATION_COOKIE_NAME}=`));
  if (!cookie) return null;
  return decodeURIComponent(cookie.slice(AUTHENTICATION_COOKIE_NAME.length + 1));
}

export async function getAuthenticatedUser(
  request: Request,
): Promise<UserProfile | null> {
  if (!authenticationSessionsAreConfigured()) return null;
  const token = readSessionToken(request.headers.get("cookie"));
  if (!token) return null;
  return createApplicationServices().authService?.getUserBySessionToken(token) ?? null;
}

export async function requireUserRole(
  request: Request,
  allowedRoles: readonly UserRole[],
): Promise<UserProfile> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    throw new ApplicationError({
      code: "AUTHENTICATION_REQUIRED",
      message: "Для этого действия необходимо войти в аккаунт.",
      statusCode: 401,
    });
  }
  if (!allowedRoles.includes(user.role)) {
    throw new ApplicationError({
      code: "ACCESS_DENIED",
      message: "У вашей учетной записи нет прав для этого действия.",
      statusCode: 403,
    });
  }
  return user;
}

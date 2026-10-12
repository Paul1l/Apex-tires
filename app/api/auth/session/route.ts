import { NextRequest, NextResponse } from "next/server";
import { AUTHENTICATION_COOKIE_NAME } from "@/lib/auth/session";
import {
  authenticationSessionsAreConfigured,
  createApplicationServices,
} from "@/server/bootstrap/application-services";
import { requireSameOrigin } from "@/server/security/request-origin";
import { applicationLogger } from "@/server/types/common";
import { toSafeError } from "@/server/utils/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStoreJson(body: object, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Current visitor. A guest (no session cookie), a session that expired or was
 * revoked, and a site without configured sign-in all get 200 `{ ok: true,
 * user: null }`: being signed out is a normal state, not an error, so the
 * storefront does not log a failed request on every page. An invalid session
 * cookie is cleared. Only a failed session lookup is an error (503).
 */
export async function GET(request: NextRequest) {
  if (!authenticationSessionsAreConfigured()) return noStoreJson({ ok: true, user: null });
  const token = request.cookies.get(AUTHENTICATION_COOKIE_NAME)?.value;
  if (!token) return noStoreJson({ ok: true, user: null });

  try {
    const user = await createApplicationServices().authService?.getUserBySessionToken(
      token,
    );
    if (!user) {
      const response = noStoreJson({ ok: true, user: null });
      response.cookies.delete(AUTHENTICATION_COOKIE_NAME);
      return response;
    }
    return noStoreJson({ ok: true, user });
  } catch (error) {
    applicationLogger.error({ error }, "Session lookup failed");
    return noStoreJson(
      {
        ok: false,
        code: "AUTH_SERVICE_UNAVAILABLE",
        message: "Сессия временно не может быть проверена.",
      },
      503,
    );
  }
}

/**
 * Sign-out (storefront and admin). Same CSRF rule as other state-changing
 * routes: only from a store page (`Origin` of the site or
 * `Sec-Fetch-Site: same-origin`), so a foreign page cannot sign the visitor
 * out. A refused request changes nothing.
 */
export async function DELETE(request: NextRequest) {
  try {
    requireSameOrigin(request);
  } catch (error) {
    const safeError = toSafeError(error);
    return noStoreJson(safeError.body, safeError.statusCode);
  }
  const token = request.cookies.get(AUTHENTICATION_COOKIE_NAME)?.value;
  if (token && authenticationSessionsAreConfigured()) {
    try {
      await createApplicationServices().authService?.revokeSession(token);
    } catch (error) {
      applicationLogger.warn({ error }, "Session revocation failed");
    }
  }
  const response = noStoreJson({ ok: true });
  response.cookies.delete(AUTHENTICATION_COOKIE_NAME);
  return response;
}

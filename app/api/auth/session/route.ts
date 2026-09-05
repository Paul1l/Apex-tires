import { NextRequest, NextResponse } from "next/server";
import { AUTHENTICATION_COOKIE_NAME } from "@/lib/auth/session";
import {
  authenticationSessionsAreConfigured,
  createApplicationServices,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStoreJson(body: object, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  if (!authenticationSessionsAreConfigured()) {
    return noStoreJson(
      {
        ok: false,
        code: "AUTH_INFRASTRUCTURE_NOT_CONFIGURED",
        message: "Сервер регистрации пока не подключён.",
      },
      503,
    );
  }
  const token = request.cookies.get(AUTHENTICATION_COOKIE_NAME)?.value;
  if (!token) return noStoreJson({ ok: false, code: "NOT_AUTHENTICATED" }, 401);

  try {
    const user = await createApplicationServices().authService?.getUserBySessionToken(
      token,
    );
    if (!user) {
      const response = noStoreJson({ ok: false, code: "SESSION_EXPIRED" }, 401);
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

export async function DELETE(request: NextRequest) {
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

import { NextRequest, NextResponse } from "next/server";
import {
  authenticationInfrastructureIsConfigured,
  getAuthenticationEnvironment,
} from "@/lib/auth/runtime";
import { createSecureDigest } from "@/lib/auth/security";
import { AUTHENTICATION_COOKIE_NAME } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface SessionUserRow {
  session_id: string;
  user_id: string;
  name: string;
  email: string;
  role: "customer" | "manager" | "admin";
  status: "active" | "blocked";
  expires_at: string;
}

function unavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: "AUTH_INFRASTRUCTURE_NOT_CONFIGURED",
      message: "Сервер регистрации ещё не подключён.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Resolves the current server-side session for client hydration.
 */
export async function GET(request: NextRequest) {
  const environment = await getAuthenticationEnvironment();
  if (!authenticationInfrastructureIsConfigured(environment)) {
    return unavailableResponse();
  }

  const sessionToken = request.cookies.get(AUTHENTICATION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return NextResponse.json(
      { ok: false, code: "NOT_AUTHENTICATED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const tokenDigest = await createSecureDigest(
      environment.OTP_CODE_PEPPER,
      `session:${sessionToken}`,
    );
    const sessionUser = await environment.DB.prepare(
      `SELECT
         sessions.id AS session_id,
         users.id AS user_id,
         users.name,
         users.email,
         users.role,
         users.status,
         sessions.expires_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
      .bind(tokenDigest)
      .first<SessionUserRow>();

    if (
      !sessionUser ||
      sessionUser.status !== "active" ||
      Date.parse(sessionUser.expires_at) <= Date.now()
    ) {
      const response = NextResponse.json(
        { ok: false, code: "SESSION_EXPIRED" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
      response.cookies.delete(AUTHENTICATION_COOKIE_NAME);
      return response;
    }

    return NextResponse.json(
      {
        ok: true,
        user: {
          id: sessionUser.user_id,
          name: sessionUser.name,
          email: sessionUser.email,
          role: sessionUser.role === "admin" ? "admin" : "customer",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Session lookup failed", error);
    return unavailableResponse();
  }
}

/**
 * Revokes the current session and always removes the browser cookie.
 */
export async function DELETE(request: NextRequest) {
  const environment = await getAuthenticationEnvironment();
  const sessionToken = request.cookies.get(AUTHENTICATION_COOKIE_NAME)?.value;

  if (
    sessionToken &&
    authenticationInfrastructureIsConfigured(environment)
  ) {
    try {
      const tokenDigest = await createSecureDigest(
        environment.OTP_CODE_PEPPER,
        `session:${sessionToken}`,
      );
      await environment.DB.prepare(
        "DELETE FROM sessions WHERE token_hash = ?",
      )
        .bind(tokenDigest)
        .run();
    } catch (error) {
      console.error("Session revocation failed", error);
    }
  }

  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.delete(AUTHENTICATION_COOKIE_NAME);
  return response;
}

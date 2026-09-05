import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { IdentityValidationError } from "@/lib/auth/identity";
import { AUTHENTICATION_COOKIE_NAME } from "@/lib/auth/session";
import {
  authenticationSessionsAreConfigured,
  createApplicationServices,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requesterAddress(request: Request): string | null {
  const address =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  return address && isIP(address) ? address : null;
}

export async function POST(request: Request) {
  try {
    if (!authenticationSessionsAreConfigured()) {
      throw new ApplicationError({
        code: "AUTH_INFRASTRUCTURE_NOT_CONFIGURED",
        message: "Сервер регистрации пока не подключён.",
        statusCode: 503,
      });
    }
    const payload = (await readJsonRequest(request, 20_000)) as {
      challengeId?: unknown;
      code?: unknown;
      email?: unknown;
      name?: unknown;
      personalDataConsent?: unknown;
      termsAccepted?: unknown;
    };
    const challengeId = String(payload.challengeId ?? "");
    const code = String(payload.code ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(challengeId)) {
      throw new ApplicationError({
        code: "INVALID_CHALLENGE",
        message: "Запросите новый код подтверждения.",
        statusCode: 422,
      });
    }
    if (!/^\d{6}$/.test(code)) {
      throw new ApplicationError({
        code: "INVALID_CODE_FORMAT",
        message: "Код должен состоять из 6 цифр.",
        statusCode: 422,
      });
    }
    const authService = createApplicationServices().authService;
    if (!authService) {
      throw new ApplicationError({
        code: "AUTH_INFRASTRUCTURE_NOT_CONFIGURED",
        message: "Сервер регистрации пока не подключён.",
        statusCode: 503,
      });
    }
    const session = await authService.verifyEmailCode({
      challengeId,
      code,
      rawEmail: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      personalDataConsent: payload.personalDataConsent === true,
      termsAccepted: payload.termsAccepted === true,
      requesterAddress: requesterAddress(request),
      userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    });
    const response = NextResponse.json(
      { ok: true, user: session.user },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(AUTHENTICATION_COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: session.expiresInSeconds,
    });
    return response;
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    applicationLogger.error({ error }, "Authentication code verification failed");
    const safeError =
      error instanceof ApplicationError
        ? toSafeError(error)
        : toSafeError(
            new ApplicationError({
              code: "AUTH_SERVICE_UNAVAILABLE",
              message: "Вход сейчас недоступен. Попробуйте позже.",
              statusCode: 503,
            }),
          );
    return NextResponse.json(safeError.body, {
      status: safeError.statusCode,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

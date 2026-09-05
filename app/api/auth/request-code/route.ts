import { NextResponse } from "next/server";
import { DeliveryConfigurationError } from "@/lib/auth/delivery";
import { IdentityValidationError } from "@/lib/auth/identity";
import {
  authenticationSessionsAreConfigured,
  createApplicationServices,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readRequesterAddress(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function POST(request: Request) {
  try {
    if (!authenticationSessionsAreConfigured()) {
      throw new ApplicationError({
        code: "AUTH_INFRASTRUCTURE_NOT_CONFIGURED",
        message: "Подтверждение по почте пока не подключено.",
        statusCode: 503,
      });
    }
    const payload = (await readJsonRequest(request, 20_000)) as {
      email?: unknown;
      intent?: unknown;
    };
    if (payload.intent !== "login" && payload.intent !== "register") {
      throw new ApplicationError({
        code: "INVALID_INTENT",
        message: "Выберите вход или регистрацию.",
        statusCode: 422,
      });
    }
    const authService = createApplicationServices().authService;
    if (!authService) {
      throw new ApplicationError({
        code: "AUTH_INFRASTRUCTURE_NOT_CONFIGURED",
        message: "Подтверждение по почте пока не подключено.",
        statusCode: 503,
      });
    }
    const challenge = await authService.requestEmailCode({
      rawEmail: String(payload.email ?? ""),
      intent: payload.intent,
      requesterAddress: readRequesterAddress(request),
    });
    return NextResponse.json(
      { ok: true, ...challenge },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof DeliveryConfigurationError) {
      return NextResponse.json(
        { ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED", message: error.message },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    applicationLogger.error({ error }, "Authentication code request failed");
    const safeError =
      error instanceof ApplicationError
        ? toSafeError(error)
        : toSafeError(
            new ApplicationError({
              code: "AUTH_SERVICE_UNAVAILABLE",
              message: "Код сейчас не удалось отправить. Попробуйте позже.",
              statusCode: 503,
            }),
          );
    return NextResponse.json(safeError.body, {
      status: safeError.statusCode,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

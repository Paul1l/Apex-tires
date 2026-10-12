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
import { readSecurityLimits } from "@/server/config/security-limits";
import { clientIpRateLimitKey, getClientIp } from "@/server/security/client-ip";
import { enforceRateLimit } from "@/server/security/rate-limit-policies";
import { requireSameOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!authenticationSessionsAreConfigured()) {
      throw new ApplicationError({
        code: "AUTH_INFRASTRUCTURE_NOT_CONFIGURED",
        message: "Подтверждение по почте пока не подключено.",
        statusCode: 503,
      });
    }
    const services = createApplicationServices();
    const clientAddressKey = clientIpRateLimitKey(getClientIp(request));
    // Counts every attempt (including invalid addresses), unlike the
    // per-source challenge limit inside AuthService.
    await enforceRateLimit(
      services.rateLimiter,
      readSecurityLimits().authCodeRequests.perIp,
      clientAddressKey,
      { message: "Слишком много запросов кода с вашего адреса." },
    );
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
    const authService = services.authService;
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
      // Only hashed for the per-source challenge limit; IPv6 is grouped by /64.
      requesterAddress: clientAddressKey ?? "unknown",
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

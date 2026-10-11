import { NextResponse } from "next/server";
import {
  AUTHENTICATION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { clientIpRateLimitKey, getClientIp } from "@/server/security/client-ip";
import {
  enforceRateLimit,
  STAFF_LOGIN_RATE_LIMITS,
} from "@/server/security/rate-limit-policies";
import { requireSameOrigin } from "@/server/security/request-origin";
import { getStaffServices } from "@/server/services/staff-service-factory";
import { STAFF_LOGIN_FAILED_MESSAGE } from "@/server/services/staff-auth-service";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { staffLoginSchema } from "@/server/validators/staff-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Staff sign-in: email + 6-digit authenticator code. On success sets the
 * same `apex_session` cookie as the customer sign-in, for 12 hours, bound to
 * a `staff_totp` session (the only kind that grants manager/admin rights).
 * Sign-out uses DELETE /api/auth/session.
 */
export async function POST(request: Request) {
  try {
    // Login CSRF: a foreign page must not be able to sign the visitor in.
    requireSameOrigin(request);
    const services = getStaffServices();
    // Every attempt counts, before the body is even read.
    await enforceRateLimit(
      services.rateLimiter,
      STAFF_LOGIN_RATE_LIMITS.perIp,
      clientIpRateLimitKey(getClientIp(request)),
      { message: "Слишком много попыток входа с вашего адреса." },
    );
    const validation = staffLoginSchema.safeParse(await readJsonRequest(request, 4_000));
    if (!validation.success) {
      const issue = validation.error.issues[0];
      throw new ApplicationError({
        code: "VALIDATION_ERROR",
        message: issue?.message ?? STAFF_LOGIN_FAILED_MESSAGE,
        statusCode: 422,
        details: { field: issue?.path.join(".") ?? "" },
      });
    }
    const { email, code } = validation.data;
    await enforceRateLimit(services.rateLimiter, STAFF_LOGIN_RATE_LIMITS.perEmail, email, {
      message: "Слишком много попыток входа для этого email.",
    });

    const session = await services.auth.login({ email, code });
    const response = NextResponse.json(
      { ok: true, user: session.user },
      { headers: NO_STORE },
    );
    response.cookies.set(
      AUTHENTICATION_COOKIE_NAME,
      session.token,
      sessionCookieOptions(session.expiresInSeconds),
    );
    return response;
  } catch (error) {
    // Refusals are already logged by the service with a reason only.
    if (!(error instanceof ApplicationError && error.code === "STAFF_LOGIN_FAILED")) {
      applicationLogger.error({ error }, "Staff sign-in failed");
    }
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
      headers: NO_STORE,
    });
  }
}

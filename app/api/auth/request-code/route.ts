import { NextRequest, NextResponse } from "next/server";
import { DeliveryConfigurationError, deliverAuthenticationCode } from "@/lib/auth/delivery";
import {
  type AuthenticationIntent,
  IdentityValidationError,
  maskEmailAddress,
  normalizeEmailAddress,
} from "@/lib/auth/identity";
import {
  authenticationInfrastructureIsConfigured,
  getAuthenticationEnvironment,
} from "@/lib/auth/runtime";
import {
  createSecureDigest,
  generateSixDigitCode,
} from "@/lib/auth/security";

export const dynamic = "force-dynamic";

const CODE_LIFETIME_MILLISECONDS = 10 * 60 * 1000;
const RESEND_DELAY_MILLISECONDS = 60 * 1000;
const RATE_LIMIT_WINDOW_MILLISECONDS = 10 * 60 * 1000;
const MAXIMUM_EMAIL_REQUESTS_PER_WINDOW = 3;
const MAXIMUM_REQUESTER_REQUESTS_PER_WINDOW = 10;

interface RequestCodePayload {
  email?: unknown;
  intent?: unknown;
}

interface MostRecentChallenge {
  created_at: string;
}

interface ChallengeCount {
  count: number;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    { ok: false, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function readRequesterAddress(request: NextRequest): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Creates an email challenge, persists only keyed digests and sends a six-digit
 * code. Repeated requests are limited independently by email and requester.
 */
export async function POST(request: NextRequest) {
  let payload: RequestCodePayload;
  try {
    payload = (await request.json()) as RequestCodePayload;
  } catch {
    return errorResponse(400, "INVALID_JSON", "Не удалось прочитать запрос.");
  }

  const intent = payload.intent;
  if (intent !== "login" && intent !== "register") {
    return errorResponse(
      400,
      "INVALID_INTENT",
      "Выберите вход или регистрацию.",
    );
  }

  let email: string;
  try {
    email = normalizeEmailAddress(String(payload.email ?? ""));
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      return errorResponse(422, error.code, error.message);
    }
    throw error;
  }

  const environment = await getAuthenticationEnvironment();
  if (!authenticationInfrastructureIsConfigured(environment)) {
    return errorResponse(
      503,
      "AUTH_INFRASTRUCTURE_NOT_CONFIGURED",
      "Подтверждение по почте подготовлено, но база данных и секретный ключ ещё не подключены.",
    );
  }

  const database = environment.DB;
  const securitySecret = environment.OTP_CODE_PEPPER;
  const requesterAddress = readRequesterAddress(request);
  const emailDigest = await createSecureDigest(
    securitySecret,
    `email:${email}`,
  );
  const requesterDigest = await createSecureDigest(
    securitySecret,
    `requester:${requesterAddress}`,
  );
  const rateLimitWindowStartedAt = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MILLISECONDS,
  ).toISOString();

  try {
    const [recentChallenge, emailRequestCount, requesterRequestCount] =
      await Promise.all([
        database
          .prepare(
            `SELECT created_at
             FROM otp_challenges
             WHERE email_hash = ?
             ORDER BY created_at DESC
             LIMIT 1`,
          )
          .bind(emailDigest)
          .first<MostRecentChallenge>(),
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM otp_challenges
             WHERE email_hash = ? AND created_at >= ?`,
          )
          .bind(emailDigest, rateLimitWindowStartedAt)
          .first<ChallengeCount>(),
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM otp_challenges
             WHERE requester_hash = ? AND created_at >= ?`,
          )
          .bind(requesterDigest, rateLimitWindowStartedAt)
          .first<ChallengeCount>(),
      ]);

    if (
      recentChallenge &&
      Date.now() - Date.parse(recentChallenge.created_at) <
        RESEND_DELAY_MILLISECONDS
    ) {
      return errorResponse(
        429,
        "RESEND_TOO_EARLY",
        "Новый код можно запросить через минуту.",
      );
    }

    if (
      Number(emailRequestCount?.count ?? 0) >=
        MAXIMUM_EMAIL_REQUESTS_PER_WINDOW ||
      Number(requesterRequestCount?.count ?? 0) >=
        MAXIMUM_REQUESTER_REQUESTS_PER_WINDOW
    ) {
      return errorResponse(
        429,
        "RATE_LIMIT_EXCEEDED",
        "Слишком много запросов. Попробуйте снова через 10 минут.",
      );
    }

    const challengeId = crypto.randomUUID();
    const sixDigitCode = generateSixDigitCode();
    const codeDigest = await createSecureDigest(
      securitySecret,
      `${challengeId}:${email}:${sixDigitCode}`,
    );
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + CODE_LIFETIME_MILLISECONDS,
    ).toISOString();

    await database
      .prepare(
        `INSERT INTO otp_challenges (
          id, email_hash, requester_hash, intent, code_hash, attempts,
          expires_at, consumed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?)`,
      )
      .bind(
        challengeId,
        emailDigest,
        requesterDigest,
        intent satisfies AuthenticationIntent,
        codeDigest,
        expiresAt,
        createdAt,
      )
      .run();

    try {
      await deliverAuthenticationCode(environment, email, sixDigitCode);
    } catch (error) {
      await database
        .prepare("DELETE FROM otp_challenges WHERE id = ?")
        .bind(challengeId)
        .run();

      if (error instanceof DeliveryConfigurationError) {
        return errorResponse(
          503,
          "EMAIL_DELIVERY_NOT_CONFIGURED",
          error.message,
        );
      }
      console.error("Yandex Postbox delivery failed", error);
      return errorResponse(
        502,
        "EMAIL_DELIVERY_FAILED",
        "Почтовый сервис временно не принял письмо. Попробуйте позже.",
      );
    }

    return NextResponse.json(
      {
        ok: true,
        challengeId,
        maskedEmail: maskEmailAddress(email),
        expiresInSeconds: CODE_LIFETIME_MILLISECONDS / 1000,
        resendAfterSeconds: RESEND_DELAY_MILLISECONDS / 1000,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Authentication challenge creation failed", error);
    return errorResponse(
      503,
      "AUTH_DATABASE_UNAVAILABLE",
      "База регистрации пока недоступна. Попробуйте позже.",
    );
  }
}

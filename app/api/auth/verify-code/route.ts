import { NextRequest, NextResponse } from "next/server";
import {
  IdentityValidationError,
  normalizeEmailAddress,
} from "@/lib/auth/identity";
import {
  authenticationInfrastructureIsConfigured,
  getAuthenticationEnvironment,
} from "@/lib/auth/runtime";
import {
  constantTimeStringEquals,
  createSecureDigest,
  generateOpaqueToken,
} from "@/lib/auth/security";
import {
  AUTHENTICATION_COOKIE_NAME,
  SESSION_LIFETIME_SECONDS,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const MAXIMUM_CODE_ATTEMPTS = 5;
const LEGAL_DOCUMENT_VERSION = "2026-07-31";

interface VerifyCodePayload {
  challengeId?: unknown;
  code?: unknown;
  email?: unknown;
  name?: unknown;
  personalDataConsent?: unknown;
  termsAccepted?: unknown;
}

interface ChallengeRow {
  id: string;
  email_hash: string;
  intent: "login" | "register";
  code_hash: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "customer" | "manager" | "admin";
  status: "active" | "blocked";
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

function readRequesterAddress(request: NextRequest): string | null {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

/**
 * Verifies a one-time code, creates the account when requested and opens a
 * server-side session in an HttpOnly cookie.
 */
export async function POST(request: NextRequest) {
  let payload: VerifyCodePayload;
  try {
    payload = (await request.json()) as VerifyCodePayload;
  } catch {
    return errorResponse(400, "INVALID_JSON", "Не удалось прочитать запрос.");
  }

  const challengeId = String(payload.challengeId ?? "");
  const code = String(payload.code ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) {
    return errorResponse(
      400,
      "INVALID_CHALLENGE",
      "Запросите новый код подтверждения.",
    );
  }
  if (!/^\d{6}$/.test(code)) {
    return errorResponse(
      422,
      "INVALID_CODE_FORMAT",
      "Код должен состоять из 6 цифр.",
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
      "Сервер регистрации ещё не подключён.",
    );
  }

  const database = environment.DB;
  const securitySecret = environment.OTP_CODE_PEPPER;

  try {
    const challenge = await database
      .prepare(
        `SELECT id, email_hash, intent, code_hash, attempts, expires_at, consumed_at
         FROM otp_challenges
         WHERE id = ?`,
      )
      .bind(challengeId)
      .first<ChallengeRow>();

    if (!challenge || challenge.consumed_at) {
      return errorResponse(
        410,
        "CHALLENGE_NOT_AVAILABLE",
        "Этот код уже использован. Запросите новый.",
      );
    }
    if (Date.parse(challenge.expires_at) <= Date.now()) {
      return errorResponse(
        410,
        "CODE_EXPIRED",
        "Срок действия кода истёк. Запросите новый.",
      );
    }
    if (challenge.attempts >= MAXIMUM_CODE_ATTEMPTS) {
      return errorResponse(
        429,
        "ATTEMPTS_EXCEEDED",
        "Превышено число попыток. Запросите новый код.",
      );
    }

    const emailDigest = await createSecureDigest(
      securitySecret,
      `email:${email}`,
    );
    if (!constantTimeStringEquals(emailDigest, challenge.email_hash)) {
      return errorResponse(
        400,
        "CHALLENGE_EMAIL_MISMATCH",
        "Код был отправлен на другой адрес.",
      );
    }

    const submittedCodeDigest = await createSecureDigest(
      securitySecret,
      `${challengeId}:${email}:${code}`,
    );
    if (
      !constantTimeStringEquals(submittedCodeDigest, challenge.code_hash)
    ) {
      await database
        .prepare(
          "UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?",
        )
        .bind(challengeId)
        .run();
      const attemptsRemaining =
        MAXIMUM_CODE_ATTEMPTS - challenge.attempts - 1;
      return errorResponse(
        401,
        "CODE_INCORRECT",
        attemptsRemaining > 0
          ? `Неверный код. Осталось попыток: ${attemptsRemaining}.`
          : "Неверный код. Запросите новый.",
      );
    }

    const existingUser = await database
      .prepare(
        `SELECT id, email, name, role, status
         FROM users
         WHERE email = ?`,
      )
      .bind(email)
      .first<UserRow>();

    if (existingUser?.status === "blocked") {
      return errorResponse(
        403,
        "ACCOUNT_BLOCKED",
        "Аккаунт заблокирован. Обратитесь в поддержку.",
      );
    }

    if (challenge.intent === "login" && !existingUser) {
      await database
        .prepare("UPDATE otp_challenges SET consumed_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), challengeId)
        .run();
      return errorResponse(
        404,
        "ACCOUNT_NOT_FOUND",
        "Аккаунт с такой почтой не найден. Выберите регистрацию.",
      );
    }

    const normalizedName = String(payload.name ?? "").trim();
    if (
      challenge.intent === "register" &&
      (normalizedName.length < 2 || normalizedName.length > 80)
    ) {
      return errorResponse(
        422,
        "INVALID_NAME",
        "Имя должно содержать от 2 до 80 символов.",
      );
    }
    if (
      challenge.intent === "register" &&
      (payload.personalDataConsent !== true ||
        payload.termsAccepted !== true)
    ) {
      return errorResponse(
        422,
        "CONSENTS_REQUIRED",
        "Для регистрации нужны оба согласия.",
      );
    }

    const userId = existingUser?.id ?? crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const sessionToken = generateOpaqueToken();
    const sessionTokenDigest = await createSecureDigest(
      securitySecret,
      `session:${sessionToken}`,
    );
    const now = new Date().toISOString();
    const sessionExpiresAt = new Date(
      Date.now() + SESSION_LIFETIME_SECONDS * 1000,
    ).toISOString();

    const statements = [
      database
        .prepare("UPDATE otp_challenges SET consumed_at = ? WHERE id = ?")
        .bind(now, challengeId),
    ];

    if (!existingUser) {
      statements.push(
        database
          .prepare(
            `INSERT INTO users (
              id, email, name, phone, password_hash, role, status, created_at, updated_at
            ) VALUES (?, ?, ?, NULL, NULL, 'customer', 'active', ?, ?)`,
          )
          .bind(userId, email, normalizedName, now, now),
      );
    }

    if (challenge.intent === "register") {
      const requesterAddress = readRequesterAddress(request);
      const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
      statements.push(
        database
          .prepare(
            `INSERT INTO consents (
              id, user_id, purpose, document_slug, document_version,
              granted_at, revoked_at, ip_address, user_agent, source
            ) VALUES (?, ?, 'registration', 'personal-data-consent', ?, ?, NULL, ?, ?, 'email-otp')`,
          )
          .bind(
            crypto.randomUUID(),
            userId,
            LEGAL_DOCUMENT_VERSION,
            now,
            requesterAddress,
            userAgent,
          ),
        database
          .prepare(
            `INSERT INTO consents (
              id, user_id, purpose, document_slug, document_version,
              granted_at, revoked_at, ip_address, user_agent, source
            ) VALUES (?, ?, 'registration', 'terms', ?, ?, NULL, ?, ?, 'email-otp')`,
          )
          .bind(
            crypto.randomUUID(),
            userId,
            LEGAL_DOCUMENT_VERSION,
            now,
            requesterAddress,
            userAgent,
          ),
      );
    }

    statements.push(
      database
        .prepare(
          `INSERT INTO sessions (
            id, user_id, token_hash, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          sessionId,
          userId,
          sessionTokenDigest,
          sessionExpiresAt,
          now,
        ),
    );
    await database.batch(statements);

    const userName = existingUser?.name ?? normalizedName;
    const response = NextResponse.json(
      {
        ok: true,
        user: {
          id: userId,
          name: userName,
          email,
          role: existingUser?.role === "admin" ? "admin" : "customer",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(AUTHENTICATION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_LIFETIME_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Authentication code verification failed", error);
    return errorResponse(
      503,
      "AUTH_DATABASE_UNAVAILABLE",
      "База регистрации пока недоступна. Попробуйте позже.",
    );
  }
}

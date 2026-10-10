import type { Pool } from "pg";
import {
  deliverAuthenticationCode,
  type AuthenticationEmailEnvironment,
} from "../../lib/auth/delivery";
import {
  maskEmailAddress,
  normalizeEmailAddress,
  type AuthenticationIntent,
} from "../../lib/auth/identity";
import {
  constantTimeStringEquals,
  createSecureDigest,
  generateOpaqueToken,
  generateSixDigitCode,
} from "../../lib/auth/security";
import { SESSION_LIFETIME_SECONDS } from "../../lib/auth/session";
import type { UserProfile } from "../../lib/types";
import { withTransaction } from "../database/postgres-client";
import {
  AuthRepository,
  type AuthenticatedUserRow,
  type UserRole,
} from "../repositories/auth-repository";
import { ApplicationError } from "../utils/errors";
import type { DatabaseExecutor } from "../types/common";

const CODE_LIFETIME_MILLISECONDS = 10 * 60 * 1_000;
const RESEND_DELAY_MILLISECONDS = 60 * 1_000;
const RATE_LIMIT_WINDOW_MILLISECONDS = 10 * 60 * 1_000;
const MAXIMUM_DESTINATION_REQUESTS = 3;
const MAXIMUM_REQUESTER_REQUESTS = 10;
const MAXIMUM_CODE_ATTEMPTS = 5;
const DEFAULT_MAXIMUM_FAILED_ATTEMPTS_PER_DESTINATION = 15;
const DEFAULT_FAILED_ATTEMPTS_WINDOW_MILLISECONDS = 24 * 60 * 60 * 1_000;
const LEGAL_DOCUMENT_VERSION = "2026-07-31";

export interface AuthServiceDependencies {
  pool: Pool;
  repository: AuthRepository;
  securitySecret: string;
  emailEnvironment: AuthenticationEmailEnvironment;
  sendCode?: (
    environment: AuthenticationEmailEnvironment,
    email: string,
    code: string,
  ) => Promise<void>;
  /**
   * Failed code attempts allowed for one email across all of its challenges
   * within the rolling window; beyond it the address is locked until enough
   * old attempts leave the window.
   */
  maximumFailedAttemptsPerDestination?: number;
  failedAttemptsWindowMilliseconds?: number;
}

export interface VerifiedSession {
  token: string;
  expiresInSeconds: number;
  user: UserProfile;
}

function formatLockoutDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  return minutes < 60 ? `${minutes} мин.` : `${Math.ceil(minutes / 60)} ч.`;
}

function createDestinationLockedError(retryAfterMilliseconds: number): ApplicationError {
  // Same code and status as the other OTP limits so the existing UI shows the message.
  return new ApplicationError({
    code: "RATE_LIMIT_EXCEEDED",
    message:
      "Слишком много неверных кодов для этой почты. Вход временно заблокирован, " +
      `попробуйте через ${formatLockoutDuration(retryAfterMilliseconds)} или обратитесь в поддержку.`,
    statusCode: 429,
  });
}

function toUserProfile(user: AuthenticatedUserRow): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? undefined,
    role: user.role,
  };
}

export class AuthService {
  constructor(private readonly dependencies: AuthServiceDependencies) {}

  /**
   * Returns how long the destination stays locked (0 when it is not locked).
   * The lock lasts until enough of the oldest failed attempts leave the
   * rolling window for the total to drop below the limit.
   */
  private async getDestinationLockRemainingMilliseconds(
    database: DatabaseExecutor,
    destinationHash: string,
  ): Promise<number> {
    const maximumFailures =
      this.dependencies.maximumFailedAttemptsPerDestination ??
      DEFAULT_MAXIMUM_FAILED_ATTEMPTS_PER_DESTINATION;
    const windowMilliseconds =
      this.dependencies.failedAttemptsWindowMilliseconds ??
      DEFAULT_FAILED_ATTEMPTS_WINDOW_MILLISECONDS;
    const now = Date.now();
    const failures = await this.dependencies.repository.listFailedAttemptsSince(
      database,
      destinationHash,
      new Date(now - windowMilliseconds),
    );
    let remainingFailures = failures.reduce((sum, row) => sum + Number(row.attempts), 0);
    if (remainingFailures < maximumFailures) return 0;
    for (const row of failures) {
      remainingFailures -= Number(row.attempts);
      if (remainingFailures < maximumFailures) {
        return Math.max(1_000, new Date(row.created_at).getTime() + windowMilliseconds - now);
      }
    }
    return windowMilliseconds;
  }

  async requestEmailCode(input: {
    rawEmail: string;
    intent: AuthenticationIntent;
    requesterAddress: string;
  }): Promise<{
    challengeId: string;
    maskedEmail: string;
    expiresInSeconds: number;
    resendAfterSeconds: number;
  }> {
    const email = normalizeEmailAddress(input.rawEmail);
    const destinationHash = await createSecureDigest(
      this.dependencies.securitySecret,
      `email:${email}`,
    );
    const requesterHash = await createSecureDigest(
      this.dependencies.securitySecret,
      `requester:${input.requesterAddress}`,
    );
    const windowStartedAt = new Date(Date.now() - RATE_LIMIT_WINDOW_MILLISECONDS);
    const [lockRemainingMilliseconds, recentChallenge, destinationCount, requesterCount] = await Promise.all([
      this.getDestinationLockRemainingMilliseconds(
        this.dependencies.pool,
        destinationHash,
      ),
      this.dependencies.repository.findMostRecentChallenge(
        this.dependencies.pool,
        destinationHash,
      ),
      this.dependencies.repository.countChallengesSince(
        this.dependencies.pool,
        "destination_hash",
        destinationHash,
        windowStartedAt,
      ),
      this.dependencies.repository.countChallengesSince(
        this.dependencies.pool,
        "requester_hash",
        requesterHash,
        windowStartedAt,
      ),
    ]);

    if (lockRemainingMilliseconds > 0) {
      throw createDestinationLockedError(lockRemainingMilliseconds);
    }
    if (
      recentChallenge &&
      Date.now() - new Date(recentChallenge.created_at).getTime() <
        RESEND_DELAY_MILLISECONDS
    ) {
      throw new ApplicationError({
        code: "RESEND_TOO_EARLY",
        message: "Новый код можно запросить через минуту.",
        statusCode: 429,
      });
    }
    if (
      destinationCount >= MAXIMUM_DESTINATION_REQUESTS ||
      requesterCount >= MAXIMUM_REQUESTER_REQUESTS
    ) {
      throw new ApplicationError({
        code: "RATE_LIMIT_EXCEEDED",
        message: "Слишком много запросов. Попробуйте снова через 10 минут.",
        statusCode: 429,
      });
    }

    const challengeId = crypto.randomUUID();
    const code = generateSixDigitCode();
    const codeHash = await createSecureDigest(
      this.dependencies.securitySecret,
      `${challengeId}:${email}:${code}`,
    );
    await this.dependencies.repository.createChallenge(this.dependencies.pool, {
      id: challengeId,
      destinationHash,
      requesterHash,
      intent: input.intent,
      codeHash,
      expiresAt: new Date(Date.now() + CODE_LIFETIME_MILLISECONDS),
    });

    try {
      await (this.dependencies.sendCode ?? deliverAuthenticationCode)(
        this.dependencies.emailEnvironment,
        email,
        code,
      );
    } catch (error) {
      await this.dependencies.repository.deleteChallenge(
        this.dependencies.pool,
        challengeId,
      );
      throw error;
    }

    return {
      challengeId,
      maskedEmail: maskEmailAddress(email),
      expiresInSeconds: CODE_LIFETIME_MILLISECONDS / 1_000,
      resendAfterSeconds: RESEND_DELAY_MILLISECONDS / 1_000,
    };
  }

  async verifyEmailCode(input: {
    challengeId: string;
    rawEmail: string;
    code: string;
    name?: string;
    personalDataConsent: boolean;
    termsAccepted: boolean;
    requesterAddress: string | null;
    userAgent: string | null;
  }): Promise<VerifiedSession> {
    const email = normalizeEmailAddress(input.rawEmail);
    const verificationResult = await withTransaction<
      VerifiedSession | { error: ApplicationError }
    >(this.dependencies.pool, async (database) => {
      const challenge = await this.dependencies.repository.findChallengeForUpdate(
        database,
        input.challengeId,
      );
      if (!challenge || challenge.consumed_at) {
        throw new ApplicationError({
          code: "CHALLENGE_NOT_AVAILABLE",
          message: "Этот код уже использован. Запросите новый.",
          statusCode: 410,
        });
      }
      if (new Date(challenge.expires_at).getTime() <= Date.now()) {
        throw new ApplicationError({
          code: "CODE_EXPIRED",
          message: "Срок действия кода истёк. Запросите новый.",
          statusCode: 410,
        });
      }
      if (challenge.attempts >= MAXIMUM_CODE_ATTEMPTS) {
        throw new ApplicationError({
          code: "ATTEMPTS_EXCEEDED",
          message: "Превышено число попыток. Запросите новый код.",
          statusCode: 429,
        });
      }
      // Per-address limit across all challenges: checked before the code is
      // compared, so even a correct code is refused while the address is locked.
      await this.dependencies.repository.lockDestinationForVerification(
        database,
        challenge.destination_hash,
      );
      const lockRemainingMilliseconds = await this.getDestinationLockRemainingMilliseconds(
        database,
        challenge.destination_hash,
      );
      if (lockRemainingMilliseconds > 0) {
        throw createDestinationLockedError(lockRemainingMilliseconds);
      }

      const destinationHash = await createSecureDigest(
        this.dependencies.securitySecret,
        `email:${email}`,
      );
      if (!constantTimeStringEquals(destinationHash, challenge.destination_hash)) {
        throw new ApplicationError({
          code: "CHALLENGE_EMAIL_MISMATCH",
          message: "Код был отправлен на другой адрес.",
          statusCode: 400,
        });
      }
      const submittedCodeHash = await createSecureDigest(
        this.dependencies.securitySecret,
        `${input.challengeId}:${email}:${input.code}`,
      );
      if (!constantTimeStringEquals(submittedCodeHash, challenge.code_hash)) {
        await this.dependencies.repository.incrementChallengeAttempts(
          database,
          input.challengeId,
        );
        const attemptsRemaining = MAXIMUM_CODE_ATTEMPTS - challenge.attempts - 1;
        return {
          error: new ApplicationError({
            code: "CODE_INCORRECT",
            message:
              attemptsRemaining > 0
                ? `Неверный код. Осталось попыток: ${attemptsRemaining}.`
                : "Неверный код. Запросите новый.",
            statusCode: 401,
          }),
        };
      }

      let user = await this.dependencies.repository.findUserByEmail(database, email);
      if (user?.status === "blocked") {
        throw new ApplicationError({
          code: "ACCOUNT_BLOCKED",
          message: "Аккаунт заблокирован. Обратитесь в поддержку.",
          statusCode: 403,
        });
      }
      if (challenge.intent === "login" && !user) {
        await this.dependencies.repository.consumeChallenge(database, input.challengeId);
        return {
          error: new ApplicationError({
            code: "ACCOUNT_NOT_FOUND",
            message: "Аккаунт с такой почтой не найден. Выберите регистрацию.",
            statusCode: 404,
          }),
        };
      }

      const normalizedName = input.name?.trim() ?? "";
      if (
        challenge.intent === "register" &&
        (normalizedName.length < 2 || normalizedName.length > 80)
      ) {
        throw new ApplicationError({
          code: "INVALID_NAME",
          message: "Имя должно содержать от 2 до 80 символов.",
          statusCode: 422,
        });
      }
      if (
        challenge.intent === "register" &&
        (!input.personalDataConsent || !input.termsAccepted)
      ) {
        throw new ApplicationError({
          code: "CONSENTS_REQUIRED",
          message: "Для регистрации нужны оба согласия.",
          statusCode: 422,
        });
      }

      if (!user) {
        user = await this.dependencies.repository.createEmailUser(database, {
          id: crypto.randomUUID(),
          email,
          name: normalizedName,
        });
        await this.dependencies.repository.recordRegistrationConsents(database, {
          userId: user.id,
          documentVersion: LEGAL_DOCUMENT_VERSION,
          ipAddress: input.requesterAddress,
          userAgent: input.userAgent,
        });
      }

      const token = generateOpaqueToken();
      const tokenHash = await createSecureDigest(
        this.dependencies.securitySecret,
        `session:${token}`,
      );
      await this.dependencies.repository.consumeChallenge(database, input.challengeId);
      await this.dependencies.repository.createSession(database, {
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1_000),
      });

      return {
        token,
        expiresInSeconds: SESSION_LIFETIME_SECONDS,
        user: toUserProfile(user),
      };
    });
    if ("error" in verificationResult) throw verificationResult.error;
    return verificationResult;
  }

  async getUserBySessionToken(token: string): Promise<UserProfile | null> {
    const tokenHash = await createSecureDigest(
      this.dependencies.securitySecret,
      `session:${token}`,
    );
    const sessionUser = await this.dependencies.repository.findUserBySessionTokenHash(
      this.dependencies.pool,
      tokenHash,
    );
    if (
      !sessionUser ||
      sessionUser.status !== "active" ||
      new Date(sessionUser.expires_at).getTime() <= Date.now()
    ) {
      if (sessionUser) {
        await this.dependencies.repository.deleteSessionByTokenHash(
          this.dependencies.pool,
          tokenHash,
        );
      }
      return null;
    }
    return toUserProfile(sessionUser);
  }

  async revokeSession(token: string): Promise<void> {
    const tokenHash = await createSecureDigest(
      this.dependencies.securitySecret,
      `session:${token}`,
    );
    await this.dependencies.repository.deleteSessionByTokenHash(
      this.dependencies.pool,
      tokenHash,
    );
  }
}

export function roleHasAccess(
  role: UserRole,
  allowedRoles: readonly UserRole[],
): boolean {
  return allowedRoles.includes(role);
}

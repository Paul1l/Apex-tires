import type { Pool } from "pg";
import { createSecureDigest, generateOpaqueToken } from "../../lib/auth/security";
import { STAFF_SESSION_LIFETIME_SECONDS } from "../../lib/auth/session";
import type { UserProfile } from "../../lib/types";
import { withTransaction } from "../database/postgres-client";
import type { AuthRepository } from "../repositories/auth-repository";
import type { StaffLoginCandidateRow, StaffRepository } from "../repositories/staff-repository";
import { decryptStaffSecret } from "../security/staff-secret-box";
import { isStaffRole } from "../security/staff-roles";
import { generateTotpSecret, verifyTotp } from "../security/totp";
import { applicationLogger, type ApplicationLogger, type DatabaseExecutor } from "../types/common";
import { ApplicationError } from "../utils/errors";

/** Consecutive wrong codes before the account is locked. */
export const STAFF_LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const STAFF_LOGIN_LOCK_SECONDS = 15 * 60;

/**
 * The only answer to a refused sign-in: unknown email, wrong or reused code,
 * locked, blocked or non-staff account all look the same from outside.
 */
export const STAFF_LOGIN_FAILED_MESSAGE =
  "Неверный email или код из приложения. После 5 неудачных попыток вход " +
  "блокируется на 15 минут.";

export type StaffLoginRefusal =
  | "unknown_account"
  | "not_staff"
  | "blocked"
  | "locked"
  | "invalid_code"
  | "replayed_code"
  | "key_unreadable";

export interface StaffAuthServiceDependencies {
  pool: Pool;
  repository: StaffRepository;
  authRepository: Pick<AuthRepository, "createSession">;
  /** OTP_CODE_PEPPER: session tokens are stored as HMAC with it. */
  securitySecret: string;
  /** AES-256-GCM key for authenticator keys (deriveStaffSecretKey). */
  encryptionKey: Buffer;
  now?: () => number;
  logger?: ApplicationLogger;
}

export interface StaffSession {
  token: string;
  expiresInSeconds: number;
  user: UserProfile;
}

function createLoginFailedError(): ApplicationError {
  return new ApplicationError({
    code: "STAFF_LOGIN_FAILED",
    message: STAFF_LOGIN_FAILED_MESSAGE,
    statusCode: 401,
  });
}

function toUserProfile(row: StaffLoginCandidateRow): UserProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? undefined,
    role: row.role,
  };
}

function readStep(value: string | number | null): number | null {
  if (value === null) return null;
  const step = Number(value);
  return Number.isSafeInteger(step) ? step : null;
}

/** Staff sign-in at /admin: email + 6-digit code from an authenticator app. */
export class StaffAuthService {
  private readonly now: () => number;
  private readonly logger: ApplicationLogger;

  constructor(private readonly dependencies: StaffAuthServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.logger = dependencies.logger ?? applicationLogger;
  }

  /**
   * `email` must already be normalized (staffEmailSchema) and `code` be six
   * digits. Throws STAFF_LOGIN_FAILED (401) for every refusal; the reason is
   * logged without the email or the code.
   */
  async login(input: { email: string; code: string }): Promise<StaffSession> {
    const outcome = await withTransaction<
      StaffSession | { refusal: StaffLoginRefusal }
    >(this.dependencies.pool, async (database) => {
      const candidate = await this.dependencies.repository.findLoginCandidateForUpdate(
        database,
        input.email,
      );
      const refusal = this.findAccountRefusal(candidate);
      if (refusal || !candidate) {
        // Same amount of work as a real check, so timing does not tell
        // staff addresses from others.
        verifyTotp({ secret: generateTotpSecret(), code: input.code, timeMilliseconds: this.now() });
        return { refusal: refusal ?? "unknown_account" };
      }

      let secret: Buffer;
      try {
        secret = decryptStaffSecret(
          candidate.secret_ciphertext,
          this.dependencies.encryptionKey,
          candidate.id,
        );
      } catch {
        // OTP_CODE_PEPPER was changed or the row was altered: a new key is needed.
        this.logger.error(
          { reason: "key_unreadable" },
          "Staff authenticator key cannot be decrypted; issue a new key for this employee",
        );
        return { refusal: "key_unreadable" };
      }

      const verification = verifyTotp({
        secret,
        code: input.code,
        timeMilliseconds: this.now(),
        lastUsedStep: readStep(candidate.last_used_step),
      });
      secret.fill(0);
      if (!verification.valid) {
        await this.recordFailure(database, candidate.id);
        return { refusal: verification.reason === "replayed" ? "replayed_code" : "invalid_code" };
      }
      const accepted = await this.dependencies.repository.recordLoginSuccess(
        database,
        candidate.id,
        verification.step,
      );
      if (!accepted) {
        await this.recordFailure(database, candidate.id);
        return { refusal: "replayed_code" };
      }

      const token = generateOpaqueToken();
      const tokenHash = await createSecureDigest(
        this.dependencies.securitySecret,
        `session:${token}`,
      );
      await this.dependencies.authRepository.createSession(database, {
        id: crypto.randomUUID(),
        userId: candidate.id,
        tokenHash,
        expiresAt: new Date(this.now() + STAFF_SESSION_LIFETIME_SECONDS * 1_000),
        authMethod: "staff_totp",
      });
      await this.dependencies.repository.recordAudit(database, {
        actorUserId: candidate.id,
        action: "staff.login",
        entityId: candidate.id,
        details: { method: "totp", firstSignIn: candidate.confirmed_at === null },
      });
      return {
        token,
        expiresInSeconds: STAFF_SESSION_LIFETIME_SECONDS,
        user: toUserProfile(candidate),
      };
    });

    if ("refusal" in outcome) {
      this.logger.warn({ reason: outcome.refusal }, "Staff sign-in refused");
      throw createLoginFailedError();
    }
    return outcome;
  }

  private findAccountRefusal(candidate: StaffLoginCandidateRow | null): StaffLoginRefusal | null {
    if (!candidate) return "unknown_account";
    if (!isStaffRole(candidate.role)) return "not_staff";
    if (candidate.status !== "active") return "blocked";
    if (candidate.locked_until && new Date(candidate.locked_until).getTime() > this.now()) {
      // Even a correct code is refused while the lockout lasts.
      return "locked";
    }
    return null;
  }

  private async recordFailure(database: DatabaseExecutor, userId: string): Promise<void> {
    const result = await this.dependencies.repository.recordLoginFailure(database, userId, {
      maximumFailures: STAFF_LOGIN_MAX_FAILED_ATTEMPTS,
      lockSeconds: STAFF_LOGIN_LOCK_SECONDS,
    });
    if (result.locked) {
      await this.dependencies.repository.recordAudit(database, {
        actorUserId: null,
        action: "staff.login_locked",
        entityId: userId,
        details: { failedAttempts: result.failed_attempts, lockMinutes: STAFF_LOGIN_LOCK_SECONDS / 60 },
      });
    }
  }
}

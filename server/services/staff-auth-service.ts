import type { Pool } from "pg";
import { createSecureDigest, generateOpaqueToken } from "../../lib/auth/security";
import { STAFF_SESSION_LIFETIME_SECONDS } from "../../lib/auth/session";
import type { UserProfile } from "../../lib/types";
import { withTransaction } from "../database/postgres-client";
import type { AuthRepository } from "../repositories/auth-repository";
import type {
  StaffLoginCandidateRow,
  StaffRepository,
  StaffTrustedDeviceRow,
} from "../repositories/staff-repository";
import {
  MAXIMUM_DEVICE_TOKENS_PER_COOKIE,
  MAXIMUM_TRUSTED_DEVICES_PER_USER,
  STAFF_DEVICE_LIFETIME_SECONDS,
  STAFF_DEVICE_MAX_FAILED_ATTEMPTS,
  staffDeviceDigestInput,
} from "../security/staff-devices";
import { decryptStaffSecret } from "../security/staff-secret-box";
import { isStaffRole } from "../security/staff-roles";
import { generateTotpSecret, verifyTotp } from "../security/totp";
import { applicationLogger, type ApplicationLogger, type DatabaseExecutor } from "../types/common";
import { ApplicationError } from "../utils/errors";

/** Consecutive wrong codes before the account (attempts without a trusted device) is locked. */
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
  | "device_locked"
  | "invalid_code"
  | "replayed_code"
  | "key_unreadable";

export interface StaffAuthServiceDependencies {
  pool: Pool;
  repository: StaffRepository;
  authRepository: Pick<AuthRepository, "createSession">;
  /** OTP_CODE_PEPPER: session and device tokens are stored as HMAC with it. */
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
  /** New trusted-device token for the device cookie (rotated on every sign-in). */
  deviceToken: string;
  /** Cookie token of this account that `deviceToken` replaces, if one was used. */
  replacedDeviceToken?: string;
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

/**
 * Staff sign-in at /admin: email + 6-digit code from an authenticator app.
 *
 * Lockout follows OWASP "device cookies": an attempt that carries a valid
 * trusted-device token of this account counts failures on that device only
 * (5 wrong codes lock the device for 15 minutes); an attempt without one
 * counts on the account (5 wrong codes lock every device without a token
 * for 15 minutes). Replay protection is per account in both cases.
 */
export class StaffAuthService {
  private readonly now: () => number;
  private readonly logger: ApplicationLogger;

  constructor(private readonly dependencies: StaffAuthServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.logger = dependencies.logger ?? applicationLogger;
  }

  /** HMAC of each cookie token → the token (at most MAXIMUM_DEVICE_TOKENS_PER_COOKIE). */
  private async hashDeviceTokens(tokens: readonly string[] | undefined): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    for (const token of (tokens ?? []).slice(-MAXIMUM_DEVICE_TOKENS_PER_COOKIE)) {
      hashes.set(
        await createSecureDigest(this.dependencies.securitySecret, staffDeviceDigestInput(token)),
        token,
      );
    }
    return hashes;
  }

  /**
   * Id of a live trusted device of the account with this email among the
   * cookie tokens, or null. Picks the rate-limit key before the sign-in.
   */
  async findTrustedDeviceId(email: string, deviceTokens: readonly string[]): Promise<string | null> {
    const hashes = await this.hashDeviceTokens(deviceTokens);
    if (hashes.size === 0) return null;
    const device = await this.dependencies.repository.findTrustedDeviceByEmail(
      this.dependencies.pool,
      email,
      [...hashes.keys()],
    );
    return device?.id ?? null;
  }

  /**
   * `email` must already be normalized (staffEmailSchema) and `code` be six
   * digits. Throws STAFF_LOGIN_FAILED (401) for every refusal; the reason is
   * logged without the email, the code or any token.
   */
  async login(input: {
    email: string;
    code: string;
    deviceTokens?: readonly string[];
  }): Promise<StaffSession> {
    const deviceHashes = await this.hashDeviceTokens(input.deviceTokens);
    const outcome = await withTransaction<
      StaffSession | { refusal: StaffLoginRefusal; trustedDevice: boolean }
    >(this.dependencies.pool, async (database) => {
      const repository = this.dependencies.repository;
      const candidate = await repository.findLoginCandidateForUpdate(database, input.email);
      const accountRefusal = this.findAccountRefusal(candidate);
      if (accountRefusal || !candidate) {
        // Same amount of work as a real check, so timing does not tell
        // staff addresses from others.
        verifyTotp({ secret: generateTotpSecret(), code: input.code, timeMilliseconds: this.now() });
        return { refusal: accountRefusal ?? "unknown_account", trustedDevice: false };
      }

      const device = await repository.findTrustedDeviceForUpdate(database, candidate.id, [
        ...deviceHashes.keys(),
      ]);
      const trustedDevice = device !== null;
      // A trusted device ignores the account lockout (it guards devices
      // without a token) and has a lockout of its own. Even a correct code
      // is refused while the lockout lasts.
      const lockedUntil = device ? device.locked_until : candidate.locked_until;
      if (lockedUntil && new Date(lockedUntil).getTime() > this.now()) {
        verifyTotp({ secret: generateTotpSecret(), code: input.code, timeMilliseconds: this.now() });
        return { refusal: device ? "device_locked" : "locked", trustedDevice };
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
        return { refusal: "key_unreadable", trustedDevice };
      }

      const verification = verifyTotp({
        secret,
        code: input.code,
        timeMilliseconds: this.now(),
        lastUsedStep: readStep(candidate.last_used_step),
      });
      secret.fill(0);
      if (!verification.valid) {
        await this.recordFailure(database, candidate.id, device);
        return {
          refusal: verification.reason === "replayed" ? "replayed_code" : "invalid_code",
          trustedDevice,
        };
      }
      const accepted = await repository.recordLoginSuccess(database, candidate.id, verification.step, {
        resetAccountLockout: !trustedDevice,
      });
      if (!accepted) {
        await this.recordFailure(database, candidate.id, device);
        return { refusal: "replayed_code", trustedDevice };
      }

      // The device token is rotated on every sign-in (a copied old cookie stops working).
      const deviceToken = generateOpaqueToken(32);
      const deviceTokenHash = await createSecureDigest(
        this.dependencies.securitySecret,
        staffDeviceDigestInput(deviceToken),
      );
      if (device) {
        await repository.rotateTrustedDevice(
          database,
          device.id,
          deviceTokenHash,
          STAFF_DEVICE_LIFETIME_SECONDS,
        );
      } else {
        await repository.createTrustedDevice(database, {
          userId: candidate.id,
          tokenHash: deviceTokenHash,
          lifetimeSeconds: STAFF_DEVICE_LIFETIME_SECONDS,
          maximumDevices: MAXIMUM_TRUSTED_DEVICES_PER_USER,
        });
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
      await repository.recordAudit(database, {
        actorUserId: candidate.id,
        action: "staff.login",
        entityId: candidate.id,
        details: {
          method: "totp",
          firstSignIn: candidate.confirmed_at === null,
          trustedDevice,
        },
      });
      return {
        token,
        expiresInSeconds: STAFF_SESSION_LIFETIME_SECONDS,
        user: toUserProfile(candidate),
        deviceToken,
        replacedDeviceToken: device ? deviceHashes.get(device.token_hash) : undefined,
      };
    });

    if ("refusal" in outcome) {
      this.logger.warn(
        { reason: outcome.refusal, trustedDevice: outcome.trustedDevice },
        "Staff sign-in refused",
      );
      throw createLoginFailedError();
    }
    return outcome;
  }

  /** Unknown, non-staff and blocked accounts; lockouts are checked per device or account. */
  private findAccountRefusal(candidate: StaffLoginCandidateRow | null): StaffLoginRefusal | null {
    if (!candidate) return "unknown_account";
    if (!isStaffRole(candidate.role)) return "not_staff";
    if (candidate.status !== "active") return "blocked";
    return null;
  }

  private async recordFailure(
    database: DatabaseExecutor,
    userId: string,
    device: StaffTrustedDeviceRow | null,
  ): Promise<void> {
    const repository = this.dependencies.repository;
    if (device) {
      const result = await repository.recordDeviceFailure(database, device.id, {
        maximumFailures: STAFF_DEVICE_MAX_FAILED_ATTEMPTS,
        lockSeconds: STAFF_LOGIN_LOCK_SECONDS,
      });
      if (result.locked) {
        await repository.recordAudit(database, {
          actorUserId: null,
          action: "staff.device_locked",
          entityId: userId,
          details: {
            failedAttempts: result.failed_attempts,
            lockMinutes: STAFF_LOGIN_LOCK_SECONDS / 60,
          },
        });
      }
      return;
    }
    const result = await repository.recordLoginFailure(database, userId, {
      maximumFailures: STAFF_LOGIN_MAX_FAILED_ATTEMPTS,
      lockSeconds: STAFF_LOGIN_LOCK_SECONDS,
    });
    if (result.locked) {
      await repository.recordAudit(database, {
        actorUserId: null,
        action: "staff.login_locked",
        entityId: userId,
        details: {
          failedAttempts: result.failed_attempts,
          lockMinutes: STAFF_LOGIN_LOCK_SECONDS / 60,
        },
      });
    }
  }
}

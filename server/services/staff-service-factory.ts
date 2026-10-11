import type { Pool } from "pg";
import { businessConfig } from "../../config/business";
import {
  authenticationSessionsAreConfigured,
  createApplicationServices,
} from "../bootstrap/application-services";
import { AuthRepository } from "../repositories/auth-repository";
import { StaffRepository } from "../repositories/staff-repository";
import type { RateLimiter } from "../security/fixed-window-rate-limiter";
import { deriveStaffSecretKey } from "../security/staff-secret-box";
import { ApplicationError } from "../utils/errors";
import { StaffAuthService } from "./staff-auth-service";
import { StaffManagementService } from "./staff-management-service";

export interface StaffServices {
  auth: StaffAuthService;
  management: StaffManagementService;
  rateLimiter: RateLimiter;
}

let cachedKey: { pepper: string; key: Buffer } | null = null;

/** HKDF once per process (and again only if the pepper changes). */
function encryptionKeyFor(pepper: string): Buffer {
  if (cachedKey?.pepper !== pepper) cachedKey = { pepper, key: deriveStaffSecretKey(pepper) };
  return cachedKey.key;
}

/** Services for a given pool and pepper; used by the app and by the server command. */
export function createStaffServicesFor(input: {
  pool: Pool;
  pepper: string;
  issuer?: string;
}): Omit<StaffServices, "rateLimiter"> {
  const repository = new StaffRepository();
  const encryptionKey = encryptionKeyFor(input.pepper);
  return {
    auth: new StaffAuthService({
      pool: input.pool,
      repository,
      authRepository: new AuthRepository(),
      securitySecret: input.pepper,
      encryptionKey,
    }),
    management: new StaffManagementService({
      pool: input.pool,
      repository,
      encryptionKey,
      issuer: input.issuer ?? businessConfig.brandName,
    }),
  };
}

/**
 * Staff services on top of the shared application pool and limiter. Throws
 * 503 when PostgreSQL or OTP_CODE_PEPPER is not configured.
 */
export function getStaffServices(): StaffServices {
  const services = authenticationSessionsAreConfigured() ? createApplicationServices() : null;
  const pepper = services?.environment.OTP_CODE_PEPPER;
  if (!services || !pepper) {
    throw new ApplicationError({
      code: "AUTH_INFRASTRUCTURE_NOT_CONFIGURED",
      message: "Вход сотрудников пока не настроен: нужны PostgreSQL и OTP_CODE_PEPPER.",
      statusCode: 503,
    });
  }
  return {
    ...createStaffServicesFor({ pool: services.pool, pepper }),
    rateLimiter: services.rateLimiter,
  };
}

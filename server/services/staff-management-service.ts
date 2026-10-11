import type { Pool } from "pg";
import { withTransaction } from "../database/postgres-client";
import type { UserRole } from "../repositories/auth-repository";
import type {
  StaffMemberRow,
  StaffRepository,
  StaffUserRow,
  UserStatus,
} from "../repositories/staff-repository";
import { buildStaffEnrollment, type StaffEnrollment } from "../security/staff-enrollment";
import { encryptStaffSecret } from "../security/staff-secret-box";
import { isStaffRole, type StaffRole } from "../security/staff-roles";
import { generateTotpSecret } from "../security/totp";
import type { DatabaseExecutor } from "../types/common";
import { ApplicationError } from "../utils/errors";

/** Staff member as the admin section shows it (no key material). */
export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  status: UserStatus;
  /** A key was issued. */
  enrolled: boolean;
  /** The key was used for a sign-in at least once. */
  confirmed: boolean;
  confirmedAt: string | null;
  locked: boolean;
  lockedUntil: string | null;
  createdAt: string;
}

export interface StaffManagementServiceDependencies {
  pool: Pool;
  repository: StaffRepository;
  encryptionKey: Buffer;
  /** Name shown in the authenticator app (shop brand). */
  issuer: string;
  now?: () => number;
}

function toIsoString(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function notFound(): ApplicationError {
  return new ApplicationError({
    code: "STAFF_NOT_FOUND",
    message: "Сотрудник не найден. Обновите список.",
    statusCode: 404,
  });
}

function lastAdministratorError(): ApplicationError {
  return new ApplicationError({
    code: "LAST_ADMIN_REQUIRED",
    message:
      "Нельзя снять права или заблокировать последнего активного администратора. " +
      "Сначала назначьте другого администратора.",
    statusCode: 409,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "23505";
}

/**
 * Staff accounts: list, add or promote, role and status changes, new keys.
 * Rules: nobody changes their own role or status; the last active
 * administrator cannot lose the role or be blocked; a role change, a block
 * and a new key end all sessions of that person. Every change is audited.
 */
export class StaffManagementService {
  private readonly now: () => number;

  constructor(private readonly dependencies: StaffManagementServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  private toStaffMember(row: StaffMemberRow): StaffMember {
    const lockedUntil = toIsoString(row.locked_until);
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role === "admin" ? "admin" : "manager",
      status: row.status,
      enrolled: row.enrolled,
      confirmed: row.confirmed_at !== null,
      confirmedAt: toIsoString(row.confirmed_at),
      locked: lockedUntil !== null && new Date(lockedUntil).getTime() > this.now(),
      lockedUntil,
      createdAt: toIsoString(row.created_at) ?? new Date(this.now()).toISOString(),
    };
  }

  private async readStaffMember(database: DatabaseExecutor, userId: string): Promise<StaffMember> {
    const row = await this.dependencies.repository.findStaffMember(database, userId);
    if (!row || !isStaffRole(row.role)) throw notFound();
    return this.toStaffMember(row);
  }

  /** New key: stored encrypted, sessions ended, returned once for the QR code. */
  private async issueKey(database: DatabaseExecutor, user: StaffUserRow): Promise<StaffEnrollment> {
    const secret = generateTotpSecret();
    try {
      await this.dependencies.repository.replaceCredential(
        database,
        user.id,
        encryptStaffSecret(secret, this.dependencies.encryptionKey, user.id),
      );
      await this.dependencies.repository.deleteSessionsForUser(database, user.id);
      return buildStaffEnrollment({ secret, issuer: this.dependencies.issuer, email: user.email });
    } finally {
      secret.fill(0);
    }
  }

  private async assertAnotherActiveAdministrator(
    database: DatabaseExecutor,
    user: StaffUserRow,
    next: { role: UserRole; status: UserStatus },
  ): Promise<void> {
    const losesAdministrator =
      user.role === "admin" &&
      user.status === "active" &&
      (next.role !== "admin" || next.status !== "active");
    if (!losesAdministrator) return;
    const others = await this.dependencies.repository.countActiveAdministratorsExcept(database, user.id);
    if (others < 1) throw lastAdministratorError();
  }

  async listStaff(): Promise<StaffMember[]> {
    const rows = await this.dependencies.repository.listStaff(this.dependencies.pool);
    return rows.map((row) => this.toStaffMember(row));
  }

  /**
   * Adds a staff member: a new account, or an existing customer account with
   * this email gets the role. Returns the one-time key for the app.
   */
  async createStaff(
    actorUserId: string,
    input: { email: string; name: string; role: StaffRole },
  ): Promise<{ member: StaffMember; enrollment: StaffEnrollment; promoted: boolean }> {
    try {
      return await withTransaction(this.dependencies.pool, async (database) => {
        const repository = this.dependencies.repository;
        await repository.lockStaffChanges(database);
        const existing = await repository.findUserByEmailForUpdate(database, input.email);
        if (existing && isStaffRole(existing.role)) {
          throw new ApplicationError({
            code: "STAFF_ALREADY_EXISTS",
            message:
              "Сотрудник с таким email уже есть в списке. Чтобы выдать новый ключ, " +
              "используйте «Новый ключ».",
            statusCode: 409,
          });
        }
        const user = existing
          ? await repository.updateUser(database, existing.id, {
              name: input.name,
              role: input.role,
              status: existing.status,
            })
          : await repository.createUser(database, {
              id: crypto.randomUUID(),
              email: input.email,
              name: input.name,
              role: input.role,
            });
        const enrollment = await this.issueKey(database, user);
        await repository.recordAudit(database, {
          actorUserId,
          action: existing ? "staff.promoted" : "staff.created",
          entityId: user.id,
          details: existing
            ? { role: input.role, previousRole: existing.role, status: user.status }
            : { role: input.role },
        });
        return {
          member: await this.readStaffMember(database, user.id),
          enrollment,
          promoted: Boolean(existing),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApplicationError({
          code: "STAFF_ALREADY_EXISTS",
          message: "Учётная запись с таким email только что создана. Обновите список.",
          statusCode: 409,
        });
      }
      throw error;
    }
  }

  /**
   * Changes role (`customer` revokes staff rights and deletes the key) and/or
   * status. Returns the updated member, or null when staff rights were revoked.
   */
  async updateStaff(
    actorUserId: string,
    userId: string,
    changes: { role?: UserRole; status?: UserStatus },
  ): Promise<StaffMember | null> {
    if (userId === actorUserId) {
      throw new ApplicationError({
        code: "STAFF_SELF_CHANGE_FORBIDDEN",
        message: "Нельзя менять собственную роль или статус. Попросите другого администратора.",
        statusCode: 409,
      });
    }
    return withTransaction(this.dependencies.pool, async (database) => {
      const repository = this.dependencies.repository;
      await repository.lockStaffChanges(database);
      const user = await repository.findUserByIdForUpdate(database, userId);
      if (!user || !isStaffRole(user.role)) throw notFound();
      const next = { role: changes.role ?? user.role, status: changes.status ?? user.status };
      if (next.role === user.role && next.status === user.status) {
        return this.readStaffMember(database, user.id);
      }
      await this.assertAnotherActiveAdministrator(database, user, next);

      await repository.updateUser(database, user.id, next);
      const roleChanged = next.role !== user.role;
      if (next.role === "customer") await repository.deleteCredential(database, user.id);
      let sessionsEnded = 0;
      if (roleChanged || next.status === "blocked") {
        sessionsEnded = await repository.deleteSessionsForUser(database, user.id);
      }
      await repository.recordAudit(database, {
        actorUserId,
        action: next.role === "customer" ? "staff.revoked" : "staff.updated",
        entityId: user.id,
        details: {
          previousRole: user.role,
          role: next.role,
          previousStatus: user.status,
          status: next.status,
          sessionsEnded,
        },
      });
      return next.role === "customer" ? null : this.readStaffMember(database, user.id);
    });
  }

  /** New key for a staff member (lost or new phone); ends their sessions. */
  async reissueKey(
    actorUserId: string,
    userId: string,
  ): Promise<{ member: StaffMember; enrollment: StaffEnrollment }> {
    return withTransaction(this.dependencies.pool, async (database) => {
      const repository = this.dependencies.repository;
      await repository.lockStaffChanges(database);
      const user = await repository.findUserByIdForUpdate(database, userId);
      if (!user || !isStaffRole(user.role)) throw notFound();
      const enrollment = await this.issueKey(database, user);
      await repository.recordAudit(database, {
        actorUserId,
        action: "staff.key_reissued",
        entityId: user.id,
        details: { self: user.id === actorUserId },
      });
      return { member: await this.readStaffMember(database, user.id), enrollment };
    });
  }

  /**
   * Server command `pnpm admin:create`: creates or promotes the account,
   * makes it active (the way back in when no administrator can sign in) and
   * issues a new key. Audited without an actor.
   */
  async provisionFromCommandLine(input: {
    email: string;
    name?: string;
    role: StaffRole;
  }): Promise<{ member: StaffMember; enrollment: StaffEnrollment; created: boolean }> {
    try {
      return await withTransaction(this.dependencies.pool, async (database) => {
        const repository = this.dependencies.repository;
        await repository.lockStaffChanges(database);
        const existing = await repository.findUserByEmailForUpdate(database, input.email);
        if (!existing && !input.name) {
          throw new ApplicationError({
            code: "STAFF_NAME_REQUIRED",
            message: "Для нового сотрудника укажите имя: --name \"Имя Фамилия\".",
            statusCode: 422,
          });
        }
        if (existing) {
          await this.assertAnotherActiveAdministrator(database, existing, {
            role: input.role,
            status: "active",
          });
        }
        const user = existing
          ? await repository.updateUser(database, existing.id, {
              name: input.name,
              role: input.role,
              status: "active",
            })
          : await repository.createUser(database, {
              id: crypto.randomUUID(),
              email: input.email,
              name: input.name ?? "",
              role: input.role,
            });
        const enrollment = await this.issueKey(database, user);
        await repository.recordAudit(database, {
          actorUserId: null,
          action: "staff.provisioned_by_command",
          entityId: user.id,
          details: {
            role: input.role,
            previousRole: existing?.role ?? null,
            previousStatus: existing?.status ?? null,
          },
        });
        return {
          member: await this.readStaffMember(database, user.id),
          enrollment,
          created: !existing,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApplicationError({
          code: "STAFF_ALREADY_EXISTS",
          message: "Учётная запись с таким email только что создана. Повторите команду.",
          statusCode: 409,
        });
      }
      throw error;
    }
  }
}

import type { DatabaseExecutor, JsonValue } from "../types/common";
import type { UserRole } from "./auth-repository";

export type UserStatus = "active" | "blocked";

export interface StaffUserRow {
  id: string;
  email: string;
  phone: string | null;
  name: string;
  role: UserRole;
  status: UserStatus;
}

export interface StaffLoginCandidateRow extends StaffUserRow {
  secret_ciphertext: string;
  /** BIGINT: node-postgres returns it as a string. */
  last_used_step: string | number | null;
  failed_attempts: number;
  locked_until: Date | string | null;
  confirmed_at: Date | string | null;
}

export interface StaffMemberRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  created_at: Date | string;
  enrolled: boolean;
  confirmed_at: Date | string | null;
  locked_until: Date | string | null;
}

const STAFF_MEMBER_COLUMNS = `
  users.id, users.email, users.name, users.role, users.status, users.created_at,
  (credentials.user_id IS NOT NULL) AS enrolled,
  credentials.confirmed_at, credentials.locked_until`;

/** Staff accounts and their authenticator keys (migration 010). */
export class StaffRepository {
  /**
   * Account and key for a sign-in attempt. The key row stays locked until the
   * transaction ends, so parallel attempts cannot reuse one code or overshoot
   * the lockout counter.
   */
  async findLoginCandidateForUpdate(
    database: DatabaseExecutor,
    email: string,
  ): Promise<StaffLoginCandidateRow | null> {
    const result = await database.query<StaffLoginCandidateRow>(
      `SELECT users.id, users.email, users.phone, users.name, users.role, users.status,
              credentials.secret_ciphertext, credentials.last_used_step,
              credentials.failed_attempts, credentials.locked_until,
              credentials.confirmed_at
       FROM users
       INNER JOIN staff_totp_credentials AS credentials ON credentials.user_id = users.id
       WHERE users.email = $1
       FOR UPDATE OF credentials`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Counts a wrong code. From `maximumFailures` consecutive failures on, every
   * further failure locks the account for `lockSeconds` again.
   */
  async recordLoginFailure(
    database: DatabaseExecutor,
    userId: string,
    limits: { maximumFailures: number; lockSeconds: number },
  ): Promise<{ failed_attempts: number; locked: boolean }> {
    const result = await database.query<{ failed_attempts: number; locked: boolean }>(
      `UPDATE staff_totp_credentials
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE
             WHEN failed_attempts + 1 >= $2 THEN NOW() + make_interval(secs => $3::integer)
             ELSE locked_until
           END,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING failed_attempts, (failed_attempts >= $2) AS locked`,
      [userId, limits.maximumFailures, limits.lockSeconds],
    );
    return result.rows[0] ?? { failed_attempts: 0, locked: false };
  }

  /**
   * Accepts a code of `step`: resets the failure counter and the lockout,
   * stores the step against replay and marks the key as confirmed. Returns
   * false when a newer step was already used (the code is a replay).
   */
  async recordLoginSuccess(
    database: DatabaseExecutor,
    userId: string,
    step: number,
  ): Promise<boolean> {
    const result = await database.query(
      `UPDATE staff_totp_credentials
       SET failed_attempts = 0,
           locked_until = NULL,
           last_used_step = $2,
           confirmed_at = COALESCE(confirmed_at, NOW()),
           updated_at = NOW()
       WHERE user_id = $1 AND (last_used_step IS NULL OR last_used_step < $2)`,
      [userId, step],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async listStaff(database: DatabaseExecutor): Promise<StaffMemberRow[]> {
    const result = await database.query<StaffMemberRow>(
      `SELECT ${STAFF_MEMBER_COLUMNS}
       FROM users
       LEFT JOIN staff_totp_credentials AS credentials ON credentials.user_id = users.id
       WHERE users.role IN ('manager', 'admin')
       ORDER BY (users.role = 'admin') DESC, lower(users.name), users.email
       LIMIT 500`,
    );
    return result.rows;
  }

  async findStaffMember(
    database: DatabaseExecutor,
    userId: string,
  ): Promise<StaffMemberRow | null> {
    const result = await database.query<StaffMemberRow>(
      `SELECT ${STAFF_MEMBER_COLUMNS}
       FROM users
       LEFT JOIN staff_totp_credentials AS credentials ON credentials.user_id = users.id
       WHERE users.id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Serializes staff changes until the transaction ends, so two parallel
   * changes cannot both pass the "last active administrator" check.
   */
  async lockStaffChanges(database: DatabaseExecutor): Promise<void> {
    await database.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "apex-staff-changes",
    ]);
  }

  async findUserByEmailForUpdate(
    database: DatabaseExecutor,
    email: string,
  ): Promise<StaffUserRow | null> {
    const result = await database.query<StaffUserRow>(
      `SELECT id, email, phone, name, role, status
       FROM users
       WHERE email = $1
       FOR UPDATE`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async findUserByIdForUpdate(
    database: DatabaseExecutor,
    userId: string,
  ): Promise<StaffUserRow | null> {
    const result = await database.query<StaffUserRow>(
      `SELECT id, email, phone, name, role, status
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async createUser(
    database: DatabaseExecutor,
    user: { id: string; email: string; name: string; role: UserRole },
  ): Promise<StaffUserRow> {
    const result = await database.query<StaffUserRow>(
      `INSERT INTO users (id, email, name, role, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, email, phone, name, role, status`,
      [user.id, user.email, user.name, user.role],
    );
    return result.rows[0];
  }

  async updateUser(
    database: DatabaseExecutor,
    userId: string,
    changes: { name?: string; role: UserRole; status: UserStatus },
  ): Promise<StaffUserRow> {
    const result = await database.query<StaffUserRow>(
      `UPDATE users
       SET name = COALESCE($2, name), role = $3, status = $4, updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, phone, name, role, status`,
      [userId, changes.name ?? null, changes.role, changes.status],
    );
    return result.rows[0];
  }

  async countActiveAdministratorsExcept(
    database: DatabaseExecutor,
    userId: string,
  ): Promise<number> {
    const result = await database.query<{ count: string | number }>(
      `SELECT COUNT(*) AS count
       FROM users
       WHERE role = 'admin' AND status = 'active' AND id <> $1`,
      [userId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /** Stores a new key; the previous key, its lockout and replay state are gone. */
  async replaceCredential(
    database: DatabaseExecutor,
    userId: string,
    secretCiphertext: string,
  ): Promise<void> {
    await database.query(
      `INSERT INTO staff_totp_credentials (user_id, secret_ciphertext)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET secret_ciphertext = EXCLUDED.secret_ciphertext,
           confirmed_at = NULL,
           last_used_step = NULL,
           failed_attempts = 0,
           locked_until = NULL,
           created_at = NOW(),
           updated_at = NOW()`,
      [userId, secretCiphertext],
    );
  }

  async deleteCredential(database: DatabaseExecutor, userId: string): Promise<void> {
    await database.query("DELETE FROM staff_totp_credentials WHERE user_id = $1", [userId]);
  }

  /** Signs the user out everywhere (staff and customer sessions). */
  async deleteSessionsForUser(database: DatabaseExecutor, userId: string): Promise<number> {
    const result = await database.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    return result.rowCount ?? 0;
  }

  /**
   * Audit entry for staff changes and sign-ins. `actorUserId` is null for the
   * server command (pnpm admin:create). Details never hold keys or codes.
   */
  async recordAudit(
    database: DatabaseExecutor,
    event: {
      actorUserId: string | null;
      action: string;
      entityId: string;
      details: JsonValue;
    },
  ): Promise<void> {
    await database.query(
      `INSERT INTO admin_audit_log (actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'user', $3, $4::jsonb)`,
      [event.actorUserId, event.action, event.entityId, JSON.stringify(event.details)],
    );
  }
}

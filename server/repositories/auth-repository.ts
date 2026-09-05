import type { DatabaseExecutor } from "../types/common";

export type UserRole = "customer" | "manager" | "admin";

export interface AuthenticationChallengeRow {
  id: string;
  destination_hash: string;
  intent: "login" | "register";
  code_hash: string;
  attempts: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  created_at: Date | string;
}

export interface AuthenticatedUserRow {
  id: string;
  email: string;
  phone: string | null;
  name: string;
  role: UserRole;
  status: "active" | "blocked";
}

export interface SessionUserRow extends AuthenticatedUserRow {
  session_id: string;
  expires_at: Date | string;
}

export class AuthRepository {
  async findMostRecentChallenge(
    database: DatabaseExecutor,
    destinationHash: string,
  ): Promise<AuthenticationChallengeRow | null> {
    const result = await database.query<AuthenticationChallengeRow>(
      `SELECT id, destination_hash, intent, code_hash, attempts,
              expires_at, consumed_at, created_at
       FROM otp_challenges
       WHERE channel = 'email' AND destination_hash = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [destinationHash],
    );
    return result.rows[0] ?? null;
  }

  async countChallengesSince(
    database: DatabaseExecutor,
    field: "destination_hash" | "requester_hash",
    digest: string,
    startedAt: Date,
  ): Promise<number> {
    const result = await database.query<{ count: string | number }>(
      `SELECT COUNT(*) AS count
       FROM otp_challenges
       WHERE ${field} = $1 AND created_at >= $2`,
      [digest, startedAt],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async createChallenge(
    database: DatabaseExecutor,
    challenge: {
      id: string;
      destinationHash: string;
      requesterHash: string;
      intent: "login" | "register";
      codeHash: string;
      expiresAt: Date;
    },
  ): Promise<void> {
    await database.query(
      `INSERT INTO otp_challenges (
         id, channel, destination_hash, requester_hash, intent, code_hash,
         expires_at
       ) VALUES ($1, 'email', $2, $3, $4, $5, $6)`,
      [
        challenge.id,
        challenge.destinationHash,
        challenge.requesterHash,
        challenge.intent,
        challenge.codeHash,
        challenge.expiresAt,
      ],
    );
  }

  async deleteChallenge(
    database: DatabaseExecutor,
    challengeId: string,
  ): Promise<void> {
    await database.query("DELETE FROM otp_challenges WHERE id = $1", [challengeId]);
  }

  async findChallengeForUpdate(
    database: DatabaseExecutor,
    challengeId: string,
  ): Promise<AuthenticationChallengeRow | null> {
    const result = await database.query<AuthenticationChallengeRow>(
      `SELECT id, destination_hash, intent, code_hash, attempts,
              expires_at, consumed_at, created_at
       FROM otp_challenges
       WHERE id = $1
       FOR UPDATE`,
      [challengeId],
    );
    return result.rows[0] ?? null;
  }

  async incrementChallengeAttempts(
    database: DatabaseExecutor,
    challengeId: string,
  ): Promise<void> {
    await database.query(
      "UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1",
      [challengeId],
    );
  }

  async consumeChallenge(
    database: DatabaseExecutor,
    challengeId: string,
  ): Promise<void> {
    await database.query(
      "UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1",
      [challengeId],
    );
  }

  async findUserByEmail(
    database: DatabaseExecutor,
    email: string,
  ): Promise<AuthenticatedUserRow | null> {
    const result = await database.query<AuthenticatedUserRow>(
      `SELECT id, email, phone, name, role, status
       FROM users
       WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async createEmailUser(
    database: DatabaseExecutor,
    user: { id: string; email: string; name: string },
  ): Promise<AuthenticatedUserRow> {
    const result = await database.query<AuthenticatedUserRow>(
      `INSERT INTO users (id, email, name, role, status)
       VALUES ($1, $2, $3, 'customer', 'active')
       RETURNING id, email, phone, name, role, status`,
      [user.id, user.email, user.name],
    );
    return result.rows[0];
  }

  async recordRegistrationConsents(
    database: DatabaseExecutor,
    input: {
      userId: string;
      documentVersion: string;
      ipAddress: string | null;
      userAgent: string | null;
    },
  ): Promise<void> {
    for (const documentSlug of ["personal-data-consent", "terms"]) {
      await database.query(
        `INSERT INTO consents (
           user_id, purpose, document_slug, document_version,
           ip_address, user_agent, source
         ) VALUES ($1, 'registration', $2, $3, $4, $5, 'email-otp')`,
        [
          input.userId,
          documentSlug,
          input.documentVersion,
          input.ipAddress,
          input.userAgent,
        ],
      );
    }
  }

  async createSession(
    database: DatabaseExecutor,
    session: {
      id: string;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
    },
  ): Promise<void> {
    await database.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [session.id, session.userId, session.tokenHash, session.expiresAt],
    );
  }

  async findUserBySessionTokenHash(
    database: DatabaseExecutor,
    tokenHash: string,
  ): Promise<SessionUserRow | null> {
    const result = await database.query<SessionUserRow>(
      `SELECT sessions.id AS session_id, sessions.expires_at,
              users.id, users.email, users.phone, users.name,
              users.role, users.status
       FROM sessions
       INNER JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async deleteSessionByTokenHash(
    database: DatabaseExecutor,
    tokenHash: string,
  ): Promise<void> {
    await database.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }
}

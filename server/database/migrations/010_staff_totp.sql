-- Staff sign-in with an authenticator app (TOTP, RFC 6238), task T21a.
-- Only adds objects; safe to apply on top of 001-009 and idempotent if
-- re-run manually. The application role receives rights on the new table
-- through the default privileges of deploy/postgres/init/10-app-role.sql.

-- One authenticator key per staff member. The key is stored only encrypted
-- (AES-256-GCM, key derived from OTP_CODE_PEPPER, format "v1.<iv>.<data>.<tag>").
-- last_used_step: the last accepted 30-second step; a code of this or an
-- earlier step is refused (replay protection).
-- failed_attempts / locked_until: consecutive wrong codes and the account
-- lockout they cause; reset by a successful sign-in or a new key.
CREATE TABLE IF NOT EXISTS staff_totp_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL
    CHECK (char_length(secret_ciphertext) BETWEEN 1 AND 512),
  confirmed_at TIMESTAMPTZ,
  last_used_step BIGINT CHECK (last_used_step >= 0),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- How the session was opened. Existing sessions are customer sessions: after
-- this migration staff sign in again at /admin with the authenticator code.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'customer_otp';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_auth_method_check'
      AND conrelid = 'sessions'::regclass
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_auth_method_check
      CHECK (auth_method IN ('customer_otp', 'staff_totp'));
  END IF;
END
$migration$;

-- Staff list in the admin section.
CREATE INDEX IF NOT EXISTS users_staff_role_idx
  ON users(role, status)
  WHERE role IN ('manager', 'admin');

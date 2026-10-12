-- Trusted staff devices (OWASP "device cookies"), task T24a / QA-28.
-- Only adds objects; safe to apply on top of 001-012 and idempotent if
-- re-run manually. The application role receives rights on the new table
-- through the default privileges of deploy/postgres/init/10-app-role.sql.
--
-- After a successful staff sign-in the browser receives a random device
-- token in an HttpOnly cookie limited to /api/auth/staff/login; only its HMAC
-- (OTP_CODE_PEPPER) is stored here. Attempts that carry a valid device token
-- count failures and lock out on this row only, so a stranger who knows the
-- email cannot lock the employee out of the browsers they already used.
CREATE TABLE IF NOT EXISTS staff_trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE
    CHECK (char_length(token_hash) BETWEEN 1 AND 128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS staff_trusted_devices_user_idx
  ON staff_trusted_devices(user_id, last_used_at DESC);

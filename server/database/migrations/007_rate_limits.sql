-- Persistent rate limiting shared by all application processes and
-- indexes for abuse checks at checkout. Only adds objects; safe to apply on
-- top of 001-006 and idempotent if re-run manually.

-- Fixed-window counters. bucket_key is an HMAC of "<scope>:<subject>", so IP
-- addresses, phones and emails are never stored in clear text.
-- fillfactor leaves room for HOT updates of the hits counter.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT NOT NULL CHECK (char_length(bucket_key) BETWEEN 1 AND 128),
  window_seconds INTEGER NOT NULL CHECK (window_seconds BETWEEN 1 AND 604800),
  window_started_at TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL CHECK (hits >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bucket_key, window_seconds, window_started_at)
) WITH (fillfactor = 80);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx
  ON rate_limit_buckets(expires_at);

-- Active reservations per contact are counted inside every checkout.
CREATE INDEX IF NOT EXISTS orders_customer_phone_created_idx
  ON orders(customer_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_email_ci_idx
  ON orders(LOWER(customer_email))
  WHERE customer_email IS NOT NULL;

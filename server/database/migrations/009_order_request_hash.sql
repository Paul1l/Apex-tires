-- SHA-256 of the normalized checkout request (items, contacts, delivery,
-- tire service, comment), stored with checkout_idempotency_key. A repeated
-- key with a different request is rejected (409 IDEMPOTENCY_KEY_REUSED)
-- instead of returning the existing order. Orders created before this
-- migration have NULL and keep the previous behaviour.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_request_hash TEXT;

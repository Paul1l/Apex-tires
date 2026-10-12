import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { getDefaultSiteSettings, SITE_SETTINGS_KEY, type SiteSettings } from "../../lib/site-settings.js";
import { FitmentRequestRepository } from "../repositories/fitment-request-repository.js";
import { NotificationOutboxRepository } from "../repositories/notification-outbox-repository.js";
import { OrderRepository } from "../repositories/order-repository.js";
import {
  SITE_SETTINGS_DESCRIPTION,
  SITE_SETTINGS_VERSION_PATTERN,
} from "../repositories/site-settings-repository.js";
import { FitmentRequestService } from "../services/fitment-request-service.js";
import { OrderService } from "../services/order-service.js";
import {
  changedSiteSettingsGroups,
  readSiteSettings,
  SiteSettingsService,
} from "../services/site-settings-service.js";
import { ApplicationError } from "../utils/errors.js";
import { createOrderSchema } from "../validators/order-schemas.js";

// Runs when TEST_DATABASE_URL points to a disposable database with all
// migrations; skipped otherwise. Works under the application role (no DDL).
// The site_settings row present before the test is restored at the end.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function isConflict(error: unknown) {
  return error instanceof ApplicationError && error.code === "SITE_SETTINGS_VERSION_CONFLICT" && error.statusCode === 409;
}

test("PostgreSQL: settings save, version conflict, audit without contacts, checkout and fitment requests use saved settings", {
  skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not set",
}, async () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
  pool.on("error", () => {});
  const suffix = randomBytes(4).toString("hex");
  const privatePhone = "+7 (3852) 31-41-59";
  const privateEmail = `t23a-${suffix}@example.invalid`;
  const service = new SiteSettingsService({ pool });
  const previous = await pool.query<{ value: unknown; description: string; updated_at: Date }>(
    "SELECT value, description, updated_at FROM store_settings WHERE key = $1",
    [SITE_SETTINGS_KEY],
  );
  let actorId: string | undefined;
  let fitmentRequestId: string | undefined;
  try {
    await pool.query("DELETE FROM store_settings WHERE key = $1", [SITE_SETTINGS_KEY]);
    const actor = await pool.query<{ id: string }>(
      "INSERT INTO users (email, name, role) VALUES ($1, 'T23a admin', 'admin') RETURNING id",
      [`t23a-admin-${suffix}@example.invalid`],
    );
    actorId = actor.rows[0].id;

    // Nothing stored: defaults, no version.
    const initial = await service.getState();
    assert.deepEqual(initial, { settings: getDefaultSiteSettings(), updatedAt: null, defaults: true, storedInvalid: false });

    // First save.
    const first: SiteSettings = structuredClone(getDefaultSiteSettings());
    first.contacts.phone = privatePhone;
    first.contacts.supportEmail = privateEmail;
    first.delivery.pickup = { enabled: true, rules: "Самовывоз — в день заказа." };
    first.delivery.cityDelivery = { enabled: true, rules: null };
    first.services.tireService = false;
    const saved = await service.save(actorId, first, null);
    assert.equal(saved.changed, true);
    assert.match(saved.updatedAt ?? "", SITE_SETTINGS_VERSION_PATTERN);
    const row = await pool.query<{ value: SiteSettings; description: string; version: string }>(
      `SELECT value, description,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
       FROM store_settings WHERE key = $1`,
      [SITE_SETTINGS_KEY],
    );
    assert.deepEqual(row.rows[0].value, first);
    assert.equal(row.rows[0].description, SITE_SETTINGS_DESCRIPTION);
    assert.equal(row.rows[0].version, saved.updatedAt);
    assert.deepEqual(await service.getState(), { settings: first, updatedAt: saved.updatedAt, defaults: false, storedInvalid: false });
    assert.deepEqual(await readSiteSettings(pool), first, "the shared read contract sees the saved row");

    // Stale versions are refused; nothing changes.
    await assert.rejects(service.save(actorId, getDefaultSiteSettings(), null), isConflict);
    await assert.rejects(service.save(actorId, getDefaultSiteSettings(), "2000-01-01T00:00:00.000000Z"), isConflict);

    // Two saves racing on the same version: exactly one wins.
    const second = structuredClone(first);
    second.workingHours = "Ежедневно 9:00–20:00";
    const third = structuredClone(first);
    third.services.other = ["Правка дисков"];
    const race = await Promise.allSettled([
      service.save(actorId, second, saved.updatedAt),
      service.save(actorId, third, saved.updatedAt),
    ]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    const lost = race.find((result) => result.status === "rejected");
    assert.ok(lost && isConflict(lost.reason));
    const winner = race.find((result) => result.status === "fulfilled");
    assert.ok(winner && winner.status === "fulfilled");
    assert.ok((winner.value.updatedAt ?? "") > (saved.updatedAt ?? ""), "the version moves forward");

    // Same values again: no write, version kept.
    const current = await service.getState();
    const unchanged = await service.save(actorId, current.settings, current.updatedAt);
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.updatedAt, current.updatedAt);

    // Audit: one entry per real change, group names only.
    const audits = await pool.query<{ action: string; entity_type: string; details: { changedFields: string[]; previousSource: string }; text: string }>(
      `SELECT action, entity_type, details, details::text AS text
       FROM admin_audit_log WHERE actor_user_id = $1 ORDER BY created_at, id`,
      [actorId],
    );
    assert.equal(audits.rows.length, 2);
    assert.ok(audits.rows.every((audit) => audit.action === "settings.site_updated" && audit.entity_type === "store_settings"));
    assert.deepEqual(audits.rows[0].details.changedFields, changedSiteSettingsGroups(getDefaultSiteSettings(), first));
    assert.ok(audits.rows[0].details.changedFields.includes("contacts"));
    assert.equal(audits.rows[0].details.previousSource, "defaults");
    for (const audit of audits.rows) {
      assert.ok(!audit.text.includes(privatePhone) && !audit.text.includes(privateEmail), audit.text);
    }

    // Checkout reads the saved settings with its own pool (production default).
    const disabled = structuredClone(current.settings);
    disabled.delivery.pickup.enabled = false;
    await service.save(actorId, disabled, current.updatedAt);
    const orders = new OrderService({ pool, orderRepository: new OrderRepository() });
    const orderInput = createOrderSchema.parse({
      idempotencyKey: `t23a-db-${suffix}-0000000`,
      customer: { name: "Проверка", phone: "+79990000000" },
      items: [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
      delivery: { method: "pickup" },
      requiresTireService: false,
      offerAccepted: true,
      personalDataConsent: true,
    });
    await assert.rejects(
      orders.createOrder(orderInput),
      (error: unknown) => error instanceof ApplicationError && error.code === "DELIVERY_METHOD_UNAVAILABLE" && error.statusCode === 422,
    );
    await assert.rejects(
      orders.createOrder({ ...orderInput, delivery: { method: "courier", address: "Барнаул, ул. Попова, 1" }, requiresTireService: true }),
      (error: unknown) => error instanceof ApplicationError && error.code === "TIRE_SERVICE_UNAVAILABLE",
    );

    // Fitment request: the manager email from the saved settings.
    const fitment = new FitmentRequestService(pool, new FitmentRequestRepository(), new NotificationOutboxRepository());
    const created = await fitment.create({
      make: "Lada", model: "Vesta", customerName: "Проверка T23a", customerPhone: "+79990000000", personalDataConsent: true,
    });
    fitmentRequestId = created.id;
    const notifications = await pool.query<{ recipient: string; template: string }>(
      "SELECT recipient, template FROM notification_outbox WHERE payload->>'requestId' = $1",
      [created.id],
    );
    assert.deepEqual(notifications.rows, [{ recipient: privateEmail, template: "manager-fitment-request-created" }]);
  } finally {
    if (fitmentRequestId) {
      await pool.query("DELETE FROM notification_outbox WHERE payload->>'requestId' = $1", [fitmentRequestId]);
      await pool.query("DELETE FROM vehicle_fitment_requests WHERE id = $1", [fitmentRequestId]);
    }
    await pool.query("DELETE FROM store_settings WHERE key = $1", [SITE_SETTINGS_KEY]);
    const before = previous.rows[0];
    if (before) {
      await pool.query(
        "INSERT INTO store_settings (key, value, description, updated_at) VALUES ($1, $2::jsonb, $3, $4)",
        [SITE_SETTINGS_KEY, JSON.stringify(before.value), before.description, before.updated_at],
      );
    }
    if (actorId) {
      await pool.query("DELETE FROM admin_audit_log WHERE actor_user_id = $1", [actorId]);
      await pool.query("DELETE FROM users WHERE id = $1", [actorId]);
    }
    await pool.end();
  }
});

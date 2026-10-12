import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { getDefaultSiteSettings, SITE_SETTINGS_KEY, type SiteSettings } from "../../lib/site-settings.js";
import { revalidateWholeSite } from "../cache/storefront-revalidation.js";
import {
  SITE_SETTINGS_DESCRIPTION,
  type StoredSiteSettingsRow,
} from "../repositories/site-settings-repository.js";
import {
  changedSiteSettingsGroups,
  SiteSettingsService,
  type SiteSettingsServiceDependencies,
} from "../services/site-settings-service.js";
import { ApplicationError } from "../utils/errors.js";

const environment = process.env as Record<string, string | undefined>;
const ORIGIN = "https://store.example";
const SETTINGS_URL = `${ORIGIN}/api/admin/settings`;
const VERSION_1 = "2026-10-12T08:00:00.000001Z";
const VERSION_2 = "2026-10-12T08:05:00.000002Z";
const ADMIN_ID = "0a1b2c3d-0000-4000-8000-000000000001";

type Session = { role: "customer" | "manager" | "admin"; authMethod: "staff_totp" | "customer_otp" } | null;

/** Contacts that must never reach the audit log. */
const PRIVATE_PHONE = "+7 (3852) 55-44-33";
const PRIVATE_EMAIL = "owner-private@apex-test.ru";

function editedSettings(): SiteSettings {
  const settings = structuredClone(getDefaultSiteSettings());
  settings.contacts.phone = PRIVATE_PHONE;
  settings.contacts.supportEmail = PRIVATE_EMAIL;
  settings.delivery.pickup = { enabled: true, rules: "Самовывоз в день заказа." };
  return settings;
}

/**
 * In-memory PostgreSQL stand-in for the route: answers the session lookup
 * with `session`, keeps the store_settings row and records every statement.
 */
function fakeDatabase() {
  const state = {
    session: null as Session,
    stored: null as { value: unknown; updatedAt: string } | null,
    statements: [] as Array<{ text: string; values?: unknown[] }>,
    audits: [] as unknown[][],
    nextVersion: VERSION_2,
  };
  async function query(text: string, values?: unknown[]) {
    state.statements.push({ text, values });
    if (text.includes("FROM sessions")) {
      if (!state.session) return { rows: [] };
      return { rows: [{
        session_id: "s", expires_at: new Date(Date.now() + 60_000), auth_method: state.session.authMethod,
        id: ADMIN_ID, email: "staff@example.com", phone: null, name: "Сотрудник", role: state.session.role, status: "active",
      }] };
    }
    if (text.includes("FROM store_settings")) {
      return { rows: state.stored ? [{ value: state.stored.value, updated_at: state.stored.updatedAt }] : [] };
    }
    if (text.startsWith("INSERT INTO store_settings")) {
      if (state.stored) return { rows: [] };
      state.stored = { value: JSON.parse(String(values?.[1])), updatedAt: state.nextVersion };
      return { rows: [{ updated_at: state.nextVersion }] };
    }
    if (text.startsWith("UPDATE store_settings")) {
      state.stored = { value: JSON.parse(String(values?.[1])), updatedAt: state.nextVersion };
      return { rows: [{ updated_at: state.nextVersion }] };
    }
    if (text.includes("INSERT INTO admin_audit_log")) {
      state.audits.push(values ?? []);
      return { rows: [] };
    }
    return { rows: [] };
  }
  const client = { query, release() {}, on() {}, removeListener() {} };
  const pool = { query, async connect() { return client; } } as unknown as Pool;
  return { state, pool };
}

async function withQuietConsole(run: () => Promise<void>) {
  const { error, warn, info } = console;
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
  try {
    await run();
  } finally {
    console.error = error;
    console.warn = warn;
    console.info = info;
  }
}

async function withRouteDatabase(run: (database: ReturnType<typeof fakeDatabase>) => Promise<void>) {
  const keys = ["DATABASE_URL", "DATABASE_SSL_MODE", "OTP_CODE_PEPPER"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, environment[key]]));
  const previousPool = globalThis.apexPostgresPool;
  const database = fakeDatabase();
  Object.assign(environment, {
    DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
    DATABASE_SSL_MODE: "disable",
    OTP_CODE_PEPPER: "t23a-settings-route-pepper-0123456789abcdef",
  });
  globalThis.apexPostgresPool = database.pool;
  try {
    await withQuietConsole(() => run(database));
  } finally {
    globalThis.apexPostgresPool = previousPool;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  }
}

async function routes() {
  return import("../../app/api/admin/settings/route.js");
}

function getRequest(headers: Record<string, string> = { cookie: "apex_session=token" }) {
  return new Request(SETTINGS_URL, { headers });
}

function putRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(SETTINGS_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, cookie: "apex_session=token", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function writes(database: ReturnType<typeof fakeDatabase>) {
  return database.state.statements.filter(({ text }) =>
    /^(INSERT|UPDATE|DELETE)/.test(text.trim()) && !text.includes("FROM sessions"),
  );
}

test("settings API: 503 without PostgreSQL, never cached", async () => {
  const previous = environment.DATABASE_URL;
  delete environment.DATABASE_URL;
  try {
    await withQuietConsole(async () => {
      const { GET, PUT } = await routes();
      for (const response of [await GET(getRequest()), await PUT(putRequest({}))]) {
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "SITE_SETTINGS_STORAGE_NOT_CONFIGURED");
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
    });
  } finally {
    if (previous !== undefined) environment.DATABASE_URL = previous;
  }
});

test("settings API: sign-in required; saving refuses cross-site requests before the session", async () => {
  await withRouteDatabase(async (database) => {
    const { GET, PUT } = await routes();
    assert.equal((await GET(getRequest({}))).status, 401);
    assert.equal((await PUT(putRequest({ settings: {}, expectedUpdatedAt: null }, { cookie: "" }))).status, 401);

    database.state.session = { role: "admin", authMethod: "staff_totp" };
    const refused: Array<Record<string, string>> = [
      { Origin: "https://evil.example" },
      { Origin: "", "Sec-Fetch-Site": "cross-site" },
      { Origin: "" },
    ];
    for (const headers of refused) {
      const response = await PUT(putRequest({ settings: editedSettings(), expectedUpdatedAt: null }, headers));
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.equal((await response.json()).code, "UNTRUSTED_ORIGIN");
    }
    assert.deepEqual(writes(database), []);
  });
});

test("settings API: manager reads (read-only), administrator reads and may save", async () => {
  await withRouteDatabase(async (database) => {
    const { GET } = await routes();
    database.state.session = { role: "manager", authMethod: "staff_totp" };
    const asManager = await GET(getRequest());
    assert.equal(asManager.status, 200);
    assert.equal(asManager.headers.get("cache-control"), "no-store");
    const managerBody = await asManager.json();
    assert.equal(managerBody.canEdit, false);
    assert.equal(managerBody.defaults, true);
    assert.equal(managerBody.updatedAt, null);
    assert.deepEqual(managerBody.settings, getDefaultSiteSettings());

    database.state.stored = { value: editedSettings(), updatedAt: VERSION_1 };
    database.state.session = { role: "admin", authMethod: "staff_totp" };
    const adminBody = await (await GET(getRequest())).json();
    assert.equal(adminBody.canEdit, true);
    assert.equal(adminBody.defaults, false);
    assert.equal(adminBody.updatedAt, VERSION_1);
    assert.equal(adminBody.settings.contacts.phone, PRIVATE_PHONE);
  });
});

test("settings API: customers and staff on a customer session are refused; a manager cannot save", async () => {
  await withRouteDatabase(async (database) => {
    const { GET, PUT } = await routes();
    for (const session of [
      { role: "customer", authMethod: "customer_otp" },
      // A staff member signed in with the email code acts as a customer (D17).
      { role: "admin", authMethod: "customer_otp" },
    ] as const) {
      database.state.session = session;
      const read = await GET(getRequest());
      assert.equal(read.status, 403, JSON.stringify(session));
      assert.equal((await read.json()).code, "ACCESS_DENIED");
    }

    database.state.session = { role: "manager", authMethod: "staff_totp" };
    const save = await PUT(putRequest({ settings: editedSettings(), expectedUpdatedAt: null }));
    assert.equal(save.status, 403);
    assert.equal((await save.json()).code, "ACCESS_DENIED");
    assert.deepEqual(writes(database), []);
  });
});

test("settings API: JSON only, bounded body", async () => {
  await withRouteDatabase(async (database) => {
    const { PUT } = await routes();
    database.state.session = { role: "admin", authMethod: "staff_totp" };
    const wrongType = await PUT(putRequest("settings=1", { "Content-Type": "application/x-www-form-urlencoded" }));
    assert.equal(wrongType.status, 415);
    const huge = await PUT(putRequest({ settings: editedSettings(), expectedUpdatedAt: null, padding: "x".repeat(70_000) }));
    assert.equal(huge.status, 413);
    assert.deepEqual(writes(database), []);
  });
});

test("settings API: invalid fields → 422 with the path of each field, nothing written", async () => {
  await withRouteDatabase(async (database) => {
    const { PUT } = await routes();
    database.state.session = { role: "admin", authMethod: "staff_totp" };
    const settings = editedSettings() as unknown as Record<string, Record<string, unknown>>;
    settings.contacts.email = "not-an-email";
    settings.contacts.additionalPhones = ["+7 (3852) 00-00-01", "звонить вечером"];
    settings.location.twoGisUrl = "http://2gis.ru/barnaul";
    (settings.delivery.cityDelivery as Record<string, unknown>).rules = "д".repeat(1_001);
    const response = await PUT(putRequest({ settings, expectedUpdatedAt: null }));
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
    const fields = body.details.map((issue: { field: string }) => issue.field);
    assert.deepEqual(
      new Set(fields),
      new Set(["contacts.email", "contacts.additionalPhones.1", "location.twoGisUrl", "delivery.cityDelivery.rules"]),
    );
    for (const issue of body.details) assert.match(issue.message, /[а-яё]/i, issue.field);

    const withoutVersion = await PUT(putRequest({ settings: editedSettings() }));
    assert.equal(withoutVersion.status, 422);
    assert.deepEqual(
      (await withoutVersion.json()).details.map((issue: { field: string }) => issue.field),
      ["expectedUpdatedAt"],
    );
    assert.deepEqual(writes(database), []);
  });
});

test("settings API: first save stores the row, writes the audit entry without contact values, survives a failed cache reset", async () => {
  await withRouteDatabase(async (database) => {
    const { PUT } = await routes();
    database.state.session = { role: "admin", authMethod: "staff_totp" };
    const response = await PUT(putRequest({ settings: editedSettings(), expectedUpdatedAt: null }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.changed, true);
    assert.equal(body.updatedAt, VERSION_2);
    assert.equal(body.defaults, false);
    assert.deepEqual(body.changedFields, ["contacts", "delivery"]);
    // Outside a Next.js request revalidatePath throws: logged, the save stands.
    assert.equal(body.cacheReset, false);

    assert.deepEqual(database.state.stored?.value, editedSettings());
    const texts = database.state.statements.map(({ text }) => text.trim().split(/\s+/).slice(0, 3).join(" "));
    const begin = texts.indexOf("BEGIN");
    const commit = texts.indexOf("COMMIT");
    const insert = texts.findIndex((text) => text.startsWith("INSERT INTO store_settings"));
    const audit = texts.findIndex((text) => text.startsWith("INSERT INTO admin_audit_log"));
    assert.ok(begin >= 0 && begin < insert && insert < audit && audit < commit, texts.join(" | "));
    const insertValues = database.state.statements[insert].values ?? [];
    assert.equal(insertValues[0], SITE_SETTINGS_KEY);
    assert.equal(insertValues[2], SITE_SETTINGS_DESCRIPTION);

    assert.equal(database.state.audits.length, 1);
    const [actor, action, entityType, entityId, details] = database.state.audits[0];
    assert.equal(actor, ADMIN_ID);
    assert.equal(action, "settings.site_updated");
    assert.equal(entityType, "store_settings");
    assert.equal(entityId, null);
    assert.deepEqual(JSON.parse(String(details)), {
      key: SITE_SETTINGS_KEY,
      changedFields: ["contacts", "delivery"],
      previousSource: "defaults",
    });
    assert.ok(!String(details).includes(PRIVATE_PHONE) && !String(details).includes(PRIVATE_EMAIL));
  });
});

test("settings API: a save against an older version → 409 SITE_SETTINGS_VERSION_CONFLICT, rolled back", async () => {
  await withRouteDatabase(async (database) => {
    const { PUT } = await routes();
    database.state.session = { role: "admin", authMethod: "staff_totp" };
    database.state.stored = { value: getDefaultSiteSettings(), updatedAt: VERSION_1 };
    for (const expectedUpdatedAt of [null, "2026-10-12T07:59:59.999999Z"]) {
      const response = await PUT(putRequest({ settings: editedSettings(), expectedUpdatedAt }));
      assert.equal(response.status, 409, String(expectedUpdatedAt));
      const body = await response.json();
      assert.equal(body.code, "SITE_SETTINGS_VERSION_CONFLICT");
      assert.match(body.message, /Загрузите актуальные данные/);
    }
    assert.ok(database.state.statements.some(({ text }) => text === "ROLLBACK"));
    assert.ok(database.state.statements.some(({ text }) => /FOR UPDATE/.test(text)), "the row is locked");
    assert.deepEqual(writes(database), []);
    assert.equal(database.state.stored?.updatedAt, VERSION_1);

    const current = await PUT(putRequest({ settings: editedSettings(), expectedUpdatedAt: VERSION_1 }));
    assert.equal(current.status, 200);
    assert.equal((await current.json()).updatedAt, VERSION_2);
  });
});

// --- SiteSettingsService without HTTP --------------------------------------

function serviceHarness(stored: StoredSiteSettingsRow | null, insertResult: string | null = VERSION_2) {
  const calls: string[] = [];
  const audits: Array<{ action: string; details: unknown }> = [];
  const client = {
    async query(text: string) { calls.push(text); return { rows: [] }; },
    release() {}, on() {}, removeListener() {},
  };
  const dependencies: SiteSettingsServiceDependencies = {
    pool: { async connect() { return client; } } as unknown as Pool,
    repository: {
      async find(_database, options) { calls.push(`find:${options?.lock ? "lock" : "read"}`); return stored; },
      async insert() { calls.push("insert"); return insertResult; },
      async update() { calls.push("update"); return VERSION_2; },
    },
    audit: { async record(_database, event) { calls.push("audit"); audits.push({ action: event.action, details: event.details }); } },
  };
  return { service: new SiteSettingsService(dependencies), calls, audits };
}

test("service: unchanged settings are not written and not audited", async () => {
  const stored = { value: editedSettings(), updatedAt: VERSION_1 };
  const { service, calls } = serviceHarness(stored);
  const result = await service.save(ADMIN_ID, editedSettings(), VERSION_1);
  assert.equal(result.changed, false);
  assert.equal(result.updatedAt, VERSION_1);
  assert.deepEqual(calls.filter((call) => !/^(BEGIN|COMMIT)$/.test(call)), ["find:lock"]);
});

test("service: two administrators saving the first version — the second gets a conflict", async () => {
  const { service, calls } = serviceHarness(null, null);
  await assert.rejects(
    service.save(ADMIN_ID, editedSettings(), null),
    (error: unknown) => error instanceof ApplicationError && error.code === "SITE_SETTINGS_VERSION_CONFLICT" && error.statusCode === 409,
  );
  assert.ok(calls.includes("ROLLBACK"));
  assert.ok(!calls.includes("audit"));
});

test("service: an invalid stored row is replaced on save even without visible changes", async () => {
  const { service, audits } = serviceHarness({ value: { contacts: "broken" }, updatedAt: VERSION_1 });
  let result: Awaited<ReturnType<typeof service.save>> | undefined;
  await withQuietConsole(async () => {
    result = await service.save(ADMIN_ID, getDefaultSiteSettings(), VERSION_1);
  });
  assert.equal(result?.changed, true);
  assert.deepEqual(result?.changedFields, ["contacts", "location", "workingHours", "delivery", "services"]);
  assert.deepEqual(audits[0].details, {
    key: SITE_SETTINGS_KEY,
    changedFields: ["contacts", "location", "workingHours", "delivery", "services"],
    previousSource: "invalid",
  });
});

test("service: state reports defaults, stored values and an invalid row", async () => {
  assert.deepEqual(await serviceHarness(null).service.getState(), {
    settings: getDefaultSiteSettings(), updatedAt: null, defaults: true, storedInvalid: false,
  });
  const saved = await serviceHarness({ value: editedSettings(), updatedAt: VERSION_1 }).service.getState();
  assert.deepEqual(saved, { settings: editedSettings(), updatedAt: VERSION_1, defaults: false, storedInvalid: false });
  let invalid: unknown;
  await withQuietConsole(async () => {
    invalid = await serviceHarness({ value: { contacts: "broken" }, updatedAt: VERSION_1 }).service.getState();
  });
  assert.deepEqual(invalid, { settings: getDefaultSiteSettings(), updatedAt: VERSION_1, defaults: true, storedInvalid: true });
});

test("changed groups compare values, not key order", () => {
  const first = editedSettings();
  const reordered = JSON.parse(JSON.stringify({ ...first, contacts: { ...first.contacts } })) as SiteSettings;
  const { phone, ...rest } = reordered.contacts;
  reordered.contacts = { ...rest, phone } as SiteSettings["contacts"];
  assert.deepEqual(changedSiteSettingsGroups(first, reordered), []);
  reordered.services.other = ["Правка дисков"];
  reordered.workingHours = "Ежедневно 9:00–20:00";
  assert.deepEqual(changedSiteSettingsGroups(first, reordered), ["workingHours", "services"]);
});

test("whole-site cache reset: the root layout; a failure is reported, not thrown", async () => {
  const calls: Array<[string, string]> = [];
  assert.equal(revalidateWholeSite("test", (path, type) => calls.push([path, type])), true);
  assert.deepEqual(calls, [["/", "layout"]]);
  await withQuietConsole(async () => {
    assert.equal(revalidateWholeSite("test", () => { throw new Error("cache unavailable"); }), false);
    // Outside a Next.js request (CLI, tests) revalidatePath itself throws.
    assert.equal(revalidateWholeSite("cli"), false);
  });
});

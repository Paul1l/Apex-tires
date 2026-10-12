import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultSiteSettings } from "../../lib/site-settings";
import { parseStoredSiteSettings } from "../services/site-settings-service";
import { siteSettingsSchema } from "../validators/site-settings-schema";

test("build-time defaults pass the settings schema unchanged", () => {
  const defaults = getDefaultSiteSettings();
  assert.deepEqual(siteSettingsSchema.parse(defaults), defaults);
});

test("empty strings become null and links must be https", () => {
  const input = structuredClone(getDefaultSiteSettings()) as unknown as Record<string, Record<string, unknown>>;
  input.contacts.phone = "";
  input.contacts.email = "";
  input.contacts.telegram = "http://t.me/shop";
  const result = siteSettingsSchema.safeParse(input);
  assert.equal(result.success, false);
  input.contacts.telegram = "https://t.me/shop";
  const parsed = siteSettingsSchema.parse(input);
  assert.equal(parsed.contacts.phone, null);
  assert.equal(parsed.contacts.email, null);
  assert.equal(parsed.contacts.telegram, "https://t.me/shop");
});

test("javascript: and data: links are refused", () => {
  for (const link of ["javascript:alert(1)", "data:text/html,x"]) {
    const input = structuredClone(getDefaultSiteSettings()) as unknown as Record<string, Record<string, unknown>>;
    input.contacts.whatsapp = link;
    assert.equal(siteSettingsSchema.safeParse(input).success, false, link);
  }
});

test("a missing or invalid stored row falls back to the defaults", () => {
  const defaults = getDefaultSiteSettings();
  assert.deepEqual(parseStoredSiteSettings(undefined, defaults), defaults);
  assert.deepEqual(parseStoredSiteSettings({ contacts: "broken" }, defaults), defaults);
});

test("saved contacts count as filled in the launch checklist", async () => {
  const { businessConfig } = await import("../../config/business");
  const { validateBusinessConfig } = await import("../../config/business-validation");
  const { applySiteSettingsToConfig } = await import("../../lib/site-settings");
  const settings = getDefaultSiteSettings();
  settings.contacts.phone = "+7 (3852) 55-44-33";
  settings.contacts.email = "shop@example.test";
  settings.location.address = "Барнаул, ул. Попова, 1";
  const fields = validateBusinessConfig(applySiteSettingsToConfig(businessConfig, settings)).map((issue) => issue.field);
  for (const field of ["contacts.phone", "contacts.email", "location.address"]) {
    assert.equal(fields.includes(field), false, field);
  }
  assert.equal(applySiteSettingsToConfig(businessConfig, null), businessConfig);
});

test("control characters in texts are rejected, line breaks are allowed (QA-37)", () => {
  const paths: string[] = [];
  for (const mutate of [
    (input: ReturnType<typeof getDefaultSiteSettings>) => { input.workingHours = "10\u000020"; },
    (input: ReturnType<typeof getDefaultSiteSettings>) => { input.delivery.pickup.rules = "a\u0007b"; },
    (input: ReturnType<typeof getDefaultSiteSettings>) => { input.services.other = ["x\u0000"]; },
    (input: ReturnType<typeof getDefaultSiteSettings>) => { input.location.address = "ул.\u001bПопова"; },
  ]) {
    const input = structuredClone(getDefaultSiteSettings());
    mutate(input);
    const result = siteSettingsSchema.safeParse(input);
    assert.equal(result.success, false);
    if (!result.success) paths.push(result.error.issues[0].path.join("."));
  }
  assert.deepEqual(paths, ["workingHours", "delivery.pickup.rules", "services.other.0", "location.address"]);
  const multiline = structuredClone(getDefaultSiteSettings());
  multiline.delivery.pickup.rules = "Строка 1\nСтрока 2\tс табуляцией";
  assert.equal(siteSettingsSchema.safeParse(multiline).success, true);
});

test("coordinates are saved in pairs only (QA-39)", () => {
  const input = structuredClone(getDefaultSiteSettings());
  input.location.latitude = 53.3;
  input.location.longitude = null;
  const result = siteSettingsSchema.safeParse(input);
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues[0].path.join("."), "location.longitude");
  input.location.longitude = 83.7;
  assert.equal(siteSettingsSchema.safeParse(input).success, true);
  input.location.latitude = null;
  input.location.longitude = null;
  assert.equal(siteSettingsSchema.safeParse(input).success, true);
});

test("the build never reads settings from the database (QA-38)", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = { phase: environment.NEXT_PHASE, url: environment.DATABASE_URL };
  environment.NEXT_PHASE = "phase-production-build";
  environment.DATABASE_URL = "postgres://unused:unused@127.0.0.1:1/unused";
  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => { warnings.push(values[0]); };
  try {
    const { getSiteSettings } = await import("../services/site-settings-service");
    assert.deepEqual(await getSiteSettings(), getDefaultSiteSettings());
    // A database attempt would fail on port 1 and log the fallback warning.
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = originalWarn;
    environment.NEXT_PHASE = previous.phase;
    environment.DATABASE_URL = previous.url;
    if (previous.phase === undefined) delete environment.NEXT_PHASE;
    if (previous.url === undefined) delete environment.DATABASE_URL;
  }
});

test("phones and single-line fields reject tabs, line breaks, VT and FF (QA-41)", () => {
  const cases: Array<[string, (input: ReturnType<typeof getDefaultSiteSettings>) => void]> = [
    ["contacts.phone", (input) => { input.contacts.phone = "+7 (3852) 55\u000b66-78"; }],
    ["contacts.phone", (input) => { input.contacts.phone = "+7 (3852) 55\u000c66-78"; }],
    ["contacts.additionalPhones.0", (input) => { input.contacts.additionalPhones = ["+7 3852\t556678"]; }],
    ["location.address", (input) => { input.location.address = "Барнаул,\nул. Попова, 1"; }],
    ["workingHours", (input) => { input.workingHours = "Пн–Пт\t9–19"; }],
    ["contacts.telegram", (input) => { input.contacts.telegram = "https://t.me/sh\nop"; }],
    ["services.other.0", (input) => { input.services.other = ["Правка\r\nдисков"]; }],
  ];
  for (const [path, mutate] of cases) {
    const input = structuredClone(getDefaultSiteSettings());
    mutate(input);
    const result = siteSettingsSchema.safeParse(input);
    assert.equal(result.success, false, path);
    if (!result.success) assert.equal(result.error.issues[0].path.join("."), path);
  }
  const valid = structuredClone(getDefaultSiteSettings());
  valid.contacts.phone = "+7 (3852) 55-66-78";
  valid.contacts.additionalPhones = ["8 913 123 45 67"];
  assert.equal(siteSettingsSchema.safeParse(valid).success, true);
});

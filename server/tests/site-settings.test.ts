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

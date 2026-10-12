import { cache } from "react";
import {
  getDefaultSiteSettings,
  SITE_SETTINGS_KEY,
  type SiteSettings,
} from "../../lib/site-settings";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "../bootstrap/application-services";
import { applicationLogger, type DatabaseExecutor } from "../types/common";
import { siteSettingsSchema } from "../validators/site-settings-schema";

/**
 * Stored settings, validated. Anything missing or invalid falls back to the
 * build-time defaults as a whole, so a broken row never breaks the site.
 */
export function parseStoredSiteSettings(
  value: unknown,
  defaults: SiteSettings = getDefaultSiteSettings(),
): SiteSettings {
  if (value === null || value === undefined) return defaults;
  const parsed = siteSettingsSchema.safeParse(value);
  if (!parsed.success) {
    applicationLogger.warn(
      { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
      "Stored site settings are invalid; using defaults",
    );
    return defaults;
  }
  return parsed.data;
}

export async function readSiteSettings(database: DatabaseExecutor): Promise<SiteSettings> {
  const result = await database.query<{ value: unknown }>(
    "SELECT value FROM store_settings WHERE key = $1",
    [SITE_SETTINGS_KEY],
  );
  return parseStoredSiteSettings(result.rows[0]?.value);
}

/**
 * Current store settings for pages and route handlers. One query per request
 * (React cache); without a database (preview, Cloudflare demo) or when the
 * database is unavailable, the build-time defaults. ISR pages keep the value
 * until they are revalidated (saving settings revalidates the whole site).
 */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  if (!databaseIsConfigured()) return getDefaultSiteSettings();
  try {
    return await readSiteSettings(createApplicationServices().pool);
  } catch (error) {
    applicationLogger.warn({ error }, "Site settings could not be read; using defaults");
    return getDefaultSiteSettings();
  }
});

import {
  getDefaultSiteSettings,
  SITE_SETTINGS_KEY,
  type SiteSettings,
} from "../../lib/site-settings";
import { applicationLogger, type DatabaseExecutor } from "../types/common";
import { siteSettingsSchema } from "../validators/site-settings-schema";

/** Reads the current settings with a given connection (pool or transaction client). */
export type SiteSettingsReader = (database: DatabaseExecutor) => Promise<SiteSettings>;

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

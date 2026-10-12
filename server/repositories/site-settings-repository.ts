import { SITE_SETTINGS_KEY, type SiteSettings } from "../../lib/site-settings";
import type { DatabaseExecutor } from "../types/common";

/**
 * Row of store_settings with the store data edited in the admin
 * (key SITE_SETTINGS_KEY, value = the whole SiteSettings object).
 *
 * `updatedAt` is the version used for optimistic concurrency: an ISO-8601
 * UTC string with microseconds, formatted by PostgreSQL so that the value the
 * admin form received compares exactly with the stored one (a JavaScript Date
 * would lose the microseconds).
 */
export interface StoredSiteSettingsRow {
  value: unknown;
  updatedAt: string;
}

export const SITE_SETTINGS_DESCRIPTION =
  "Данные магазина из раздела «Настройки» админки: контакты, адрес и карта, часы работы, доставка, услуги";

const UPDATED_AT_SQL = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Version strings produced by UPDATED_AT_SQL (what the API accepts back). */
export const SITE_SETTINGS_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export class SiteSettingsRepository {
  /** The stored row; `lock` takes a row lock until the transaction ends. */
  async find(
    database: DatabaseExecutor,
    options: { lock?: boolean } = {},
  ): Promise<StoredSiteSettingsRow | null> {
    const result = await database.query<{ value: unknown; updated_at: string }>(
      `SELECT value, ${UPDATED_AT_SQL} AS updated_at
       FROM store_settings
       WHERE key = $1
       ${options.lock ? "FOR UPDATE" : ""}`,
      [SITE_SETTINGS_KEY],
    );
    const row = result.rows[0];
    return row ? { value: row.value, updatedAt: row.updated_at } : null;
  }

  /**
   * First save. Returns null when another request inserted the row first
   * (the caller reports a version conflict).
   */
  async insert(database: DatabaseExecutor, settings: SiteSettings): Promise<string | null> {
    const result = await database.query<{ updated_at: string }>(
      `INSERT INTO store_settings (key, value, description)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO NOTHING
       RETURNING ${UPDATED_AT_SQL} AS updated_at`,
      [SITE_SETTINGS_KEY, JSON.stringify(settings), SITE_SETTINGS_DESCRIPTION],
    );
    return result.rows[0]?.updated_at ?? null;
  }

  /**
   * Replaces the stored value (row locked by find({ lock: true })). The
   * version always moves forward, even within one transaction timestamp.
   */
  async update(database: DatabaseExecutor, settings: SiteSettings): Promise<string> {
    const result = await database.query<{ updated_at: string }>(
      `UPDATE store_settings
       SET value = $2::jsonb,
           description = $3,
           updated_at = GREATEST(NOW(), updated_at + INTERVAL '1 microsecond')
       WHERE key = $1
       RETURNING ${UPDATED_AT_SQL} AS updated_at`,
      [SITE_SETTINGS_KEY, JSON.stringify(settings), SITE_SETTINGS_DESCRIPTION],
    );
    const updatedAt = result.rows[0]?.updated_at;
    if (!updatedAt) throw new Error("SITE_SETTINGS_ROW_MISSING");
    return updatedAt;
  }
}

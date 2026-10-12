import type { Pool } from "pg";
import { cache } from "react";
import { z } from "zod";
import {
  getDefaultSiteSettings,
  SITE_SETTINGS_KEY,
  type SiteSettings,
} from "../../lib/site-settings";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "../bootstrap/application-services";
import { withTransaction } from "../database/postgres-client";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import {
  SITE_SETTINGS_VERSION_PATTERN,
  SiteSettingsRepository,
  type StoredSiteSettingsRow,
} from "../repositories/site-settings-repository";
import { applicationLogger } from "../types/common";
import { ApplicationError } from "../utils/errors";
import { siteSettingsSchema } from "../validators/site-settings-schema";
import { parseStoredSiteSettings, readSiteSettings } from "./site-settings-store";

// Reading is in site-settings-store.ts (no bootstrap import, so order and
// fitment services can use it without a module cycle); re-exported here.
export { parseStoredSiteSettings, readSiteSettings, type SiteSettingsReader } from "./site-settings-store";

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

// ---------------------------------------------------------------------------
// Admin: editing (wave T23a). The read functions above are the shared
// contract; everything below is used by /api/admin/settings and by the
// services that check orders and fitment requests against saved settings.
// ---------------------------------------------------------------------------

/** Top-level groups of SiteSettings, as named in the audit log. */
export type SiteSettingsGroup = keyof SiteSettings;

export const SITE_SETTINGS_GROUPS: readonly SiteSettingsGroup[] = [
  "contacts",
  "location",
  "workingHours",
  "delivery",
  "services",
];

/** JSON body of PUT /api/admin/settings: a full form fits with room to spare. */
export const SITE_SETTINGS_JSON_LIMIT_BYTES = 64_000;

/** What the admin form shows and the version it saves against. */
export interface SiteSettingsState {
  settings: SiteSettings;
  /** Version for the next save (store_settings.updated_at); null while nothing is stored. */
  updatedAt: string | null;
  /** The values are the build-time defaults: nothing stored yet or the stored row is invalid. */
  defaults: boolean;
  /** A stored row exists but fails validation; the site uses the defaults until it is saved again. */
  storedInvalid: boolean;
}

export interface SaveSiteSettingsResult extends SiteSettingsState {
  changed: boolean;
  changedFields: SiteSettingsGroup[];
}

/** Body of PUT /api/admin/settings. `settings` is validated by siteSettingsSchema in save(). */
export const siteSettingsSaveRequestSchema = z.object(
  {
    settings: z.unknown(),
    expectedUpdatedAt: z.union(
      [z.null(), z.string().regex(SITE_SETTINGS_VERSION_PATTERN)],
      { error: "Обновите страницу: не передана версия настроек (expectedUpdatedAt)." },
    ),
  },
  { error: "Тело запроса: ожидается объект { settings, expectedUpdatedAt }." },
);

const russianErrorMap = z.locales.ru().localeError;

export function siteSettingsVersionConflict(): ApplicationError {
  return new ApplicationError({
    code: "SITE_SETTINGS_VERSION_CONFLICT",
    message:
      "Настройки изменил другой сотрудник после того, как вы открыли форму. Загрузите актуальные данные и внесите правки снова.",
    statusCode: 409,
  });
}

/** 422 with the path of every invalid field (contacts.email, delivery.pickup.rules, …). */
export function validateSiteSettingsInput(input: unknown): SiteSettings {
  if (input === undefined) {
    throw new ApplicationError({
      code: "VALIDATION_ERROR",
      message: "Не переданы настройки (settings).",
      statusCode: 422,
      details: [{ field: "settings", message: "Не переданы настройки." }],
    });
  }
  const parsed = siteSettingsSchema.safeParse(input, { error: russianErrorMap });
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
  throw new ApplicationError({
    code: "VALIDATION_ERROR",
    message: details[0]?.message
      ? `Проверьте отмеченные поля. ${details[0].message}`
      : "Проверьте отмеченные поля.",
    statusCode: 422,
    details,
  });
}

function isSameValue(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((item, index) => isSameValue(item, second[index]))
    );
  }
  if (first && second && typeof first === "object" && typeof second === "object") {
    const firstKeys = Object.keys(first);
    const secondKeys = Object.keys(second);
    return (
      firstKeys.length === secondKeys.length &&
      firstKeys.every((key) =>
        isSameValue(Reflect.get(first, key), Reflect.get(second, key)),
      )
    );
  }
  return false;
}

/** Groups whose values differ (names only — never the values: they hold phones and emails). */
export function changedSiteSettingsGroups(
  previous: SiteSettings,
  next: SiteSettings,
): SiteSettingsGroup[] {
  return SITE_SETTINGS_GROUPS.filter((group) => !isSameValue(previous[group], next[group]));
}

function stateFromRow(
  row: StoredSiteSettingsRow | null,
  defaults: SiteSettings = getDefaultSiteSettings(),
): SiteSettingsState {
  if (!row) return { settings: defaults, updatedAt: null, defaults: true, storedInvalid: false };
  const parsed = siteSettingsSchema.safeParse(row.value);
  if (parsed.success) {
    return { settings: parsed.data, updatedAt: row.updatedAt, defaults: false, storedInvalid: false };
  }
  return {
    // Logs the invalid paths once and returns the defaults (same rule as the site).
    settings: parseStoredSiteSettings(row.value, defaults),
    updatedAt: row.updatedAt,
    defaults: true,
    storedInvalid: true,
  };
}

export interface SiteSettingsServiceDependencies {
  pool: Pool;
  repository?: Pick<SiteSettingsRepository, "find" | "insert" | "update">;
  audit?: Pick<AdminAuditRepository, "record">;
  defaults?: () => SiteSettings;
}

export class SiteSettingsService {
  private readonly pool: Pool;
  private readonly repository: Pick<SiteSettingsRepository, "find" | "insert" | "update">;
  private readonly audit: Pick<AdminAuditRepository, "record">;
  private readonly defaults: () => SiteSettings;

  constructor({
    pool,
    repository = new SiteSettingsRepository(),
    audit = new AdminAuditRepository(),
    defaults = getDefaultSiteSettings,
  }: SiteSettingsServiceDependencies) {
    this.pool = pool;
    this.repository = repository;
    this.audit = audit;
    this.defaults = defaults;
  }

  /** Settings for the admin form with their version. */
  async getState(): Promise<SiteSettingsState> {
    return stateFromRow(await this.repository.find(this.pool), this.defaults());
  }

  /**
   * Validates and stores the whole settings object in one transaction with
   * an audit entry. `expectedUpdatedAt` is the version the form was opened
   * with: null — nothing was stored; undefined — no check (tools only). A
   * different stored version → 409 SITE_SETTINGS_VERSION_CONFLICT. Without
   * changes nothing is written.
   */
  async save(
    actorUserId: string,
    input: unknown,
    expectedUpdatedAt?: string | null,
  ): Promise<SaveSiteSettingsResult> {
    const settings = validateSiteSettingsInput(input);
    return withTransaction(this.pool, async (database) => {
      const row = await this.repository.find(database, { lock: true });
      if (expectedUpdatedAt !== undefined && (row?.updatedAt ?? null) !== expectedUpdatedAt) {
        throw siteSettingsVersionConflict();
      }
      const previous = stateFromRow(row, this.defaults());
      const changedFields = previous.storedInvalid
        ? [...SITE_SETTINGS_GROUPS]
        : changedSiteSettingsGroups(previous.settings, settings);
      if (changedFields.length === 0) {
        return { ...previous, changed: false, changedFields };
      }

      const updatedAt = row
        ? await this.repository.update(database, settings)
        : await this.repository.insert(database, settings);
      // Another administrator stored the first version in the meantime.
      if (!updatedAt) throw siteSettingsVersionConflict();

      await this.audit.record(database, {
        actorUserId,
        action: "settings.site_updated",
        entityType: "store_settings",
        details: {
          key: SITE_SETTINGS_KEY,
          changedFields,
          previousSource: previous.storedInvalid ? "invalid" : previous.defaults ? "defaults" : "database",
        },
      });
      return {
        settings,
        updatedAt,
        defaults: false,
        storedInvalid: false,
        changed: true,
        changedFields,
      };
    });
  }
}

export function createSiteSettingsService(): SiteSettingsService {
  return new SiteSettingsService({ pool: createApplicationServices().pool });
}

/** Settings and version for the admin form (application pool). */
export function readSiteSettingsState(): Promise<SiteSettingsState> {
  return createSiteSettingsService().getState();
}

/** Admin save (application pool); see SiteSettingsService.save. */
export function saveSiteSettings(
  actorUserId: string,
  input: unknown,
  expectedUpdatedAt?: string | null,
): Promise<SaveSiteSettingsResult> {
  return createSiteSettingsService().save(actorUserId, input, expectedUpdatedAt);
}

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { databaseIsConfigured } from "@/server/bootstrap/application-services";
import { revalidateWholeSite } from "@/server/cache/storefront-revalidation";
import { requireUserRole } from "@/server/security/request-auth";
import {
  readSiteSettingsState,
  saveSiteSettings,
  SITE_SETTINGS_JSON_LIMIT_BYTES,
  siteSettingsSaveRequestSchema,
} from "@/server/services/site-settings-service";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function requireSettingsStorage(): void {
  if (!databaseIsConfigured()) {
    throw new ApplicationError({
      code: "SITE_SETTINGS_STORAGE_NOT_CONFIGURED",
      message: "PostgreSQL не подключён: настройки магазина берутся из переменных окружения.",
      statusCode: 503,
    });
  }
}

/** Expected errors (access, validation, conflicts) are not logged; others without personal data. */
function errorResponse(error: unknown, operation: string): NextResponse {
  if (!(error instanceof ApplicationError) && !(error instanceof ZodError)) {
    applicationLogger.error({ error, operation }, "Admin settings request failed");
  }
  const safe = toSafeError(error);
  return NextResponse.json(safe.body, { status: safe.statusCode, headers: NO_STORE });
}

/**
 * Store settings for the admin form (manager and admin): values, version
 * for the next save, whether they are the build-time defaults, and whether
 * this user may save them.
 */
export async function GET(request: Request) {
  try {
    requireSettingsStorage();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const state = await readSiteSettingsState();
    return NextResponse.json(
      { ok: true, ...state, canEdit: actor.role === "admin" },
      { headers: NO_STORE },
    );
  } catch (error) {
    return errorResponse(error, "settings.get");
  }
}

/**
 * Saves the whole settings object (administrators only). Body:
 * `{ settings: SiteSettings, expectedUpdatedAt: string | null }` — the
 * version from GET; another save in between → 409
 * SITE_SETTINGS_VERSION_CONFLICT. Invalid fields → 422 with their paths.
 * After a change every cached page is reset; a failed reset does not fail
 * the save (`cacheReset: false`).
 */
export async function PUT(request: Request) {
  try {
    requireSettingsStorage();
    const actor = await requireUserRole(request, ["admin"]);
    const body = siteSettingsSaveRequestSchema.parse(
      await readJsonRequest(request, SITE_SETTINGS_JSON_LIMIT_BYTES),
    );
    const result = await saveSiteSettings(actor.id, body.settings, body.expectedUpdatedAt);
    const cacheReset = result.changed ? revalidateWholeSite("admin-site-settings-updated") : true;
    return NextResponse.json(
      { ok: true, ...result, cacheReset, canEdit: true },
      { headers: NO_STORE },
    );
  } catch (error) {
    return errorResponse(error, "settings.update");
  }
}

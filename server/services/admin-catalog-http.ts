import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { databaseIsConfigured } from "../bootstrap/application-services";
import { applicationLogger } from "../types/common";
import { ApplicationError, toSafeError } from "../utils/errors";

/** Shared helpers of the /api/admin catalog routes (products, brands, categories, warehouses). */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Staff answers carry stock and 1C data: never cached by browsers or proxies. */
export const ADMIN_NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/** JSON bodies of the catalog editor: a full card with a long description fits. */
export const ADMIN_CATALOG_JSON_LIMIT_BYTES = 200_000;

export function requireCatalogDatabase(): void {
  if (!databaseIsConfigured()) {
    throw new ApplicationError({
      code: "CATALOG_STORAGE_NOT_CONFIGURED",
      message: "PostgreSQL-каталог пока не подключён.",
      statusCode: 503,
    });
  }
}

/** UUID from a route segment (lower case), or 422 with a clear message. */
export function parseRouteId(value: string, code: string, message: string): string {
  if (!UUID_PATTERN.test(value)) throw new ApplicationError({ code, message, statusCode: 422 });
  return value.toLowerCase();
}

export function adminJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: ADMIN_NO_STORE_HEADERS });
}

/**
 * Safe error answer. Expected errors (validation, conflicts, access) are not
 * logged; unexpected ones are logged without personal data.
 */
export function adminErrorResponse(error: unknown, operation: string): NextResponse {
  if (!(error instanceof ApplicationError) && !(error instanceof ZodError)) {
    applicationLogger.error({ error, operation }, "Admin catalog request failed");
  }
  const safe = toSafeError(error);
  return NextResponse.json(safe.body, { status: safe.statusCode, headers: ADMIN_NO_STORE_HEADERS });
}

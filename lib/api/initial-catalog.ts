import { businessConfig } from "@/config/business";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { parseCatalogQuery } from "@/server/validators/catalog-query-schema";
import type { ProductKind } from "@/lib/types";
import {
  buildCatalogSearchParams,
  createDefaultCatalogFilters,
  type InitialCatalog,
} from "@/lib/api/catalog-query";

/**
 * Server-only: loads the first catalog page for a storefront route so that
 * products, facets and links to product pages are present in the HTML.
 *
 * Uses the same query contract and service call as `GET /api/v1/products`.
 * Returns null in preview mode or without a database; the storefront then
 * loads the catalog in the browser. A database error never breaks the page:
 * while building (or in development) the page is rendered without products,
 * and when a cached page is regenerated in production the previous version
 * stays in use (see the catch block).
 */
export async function loadInitialCatalog(
  kind: "all" | ProductKind,
): Promise<InitialCatalog | null> {
  if (businessConfig.catalog.dataMode !== "database" || !databaseIsConfigured()) {
    return null;
  }
  const parameters = buildCatalogSearchParams(createDefaultCatalogFilters(kind), 1);
  try {
    const result = await createApplicationServices().catalogService.getCatalogPage(
      parseCatalogQuery(parameters),
    );
    return {
      queryKey: parameters.toString(),
      items: result.items,
      total: result.pagination.total,
      totalPages: result.pagination.totalPages,
      facets: result.facets,
    };
  } catch (error) {
    applicationLogger.error(
      { error },
      "Server-side catalog rendering failed; the storefront falls back to loading it in the browser",
    );
    // Background regeneration of a cached page (production runtime): failing
    // it keeps the last successfully rendered page, products included, and
    // Next.js retries on a later request. The build and development rendering
    // fall back to the browser-loaded catalog instead.
    if (
      process.env.NODE_ENV === "production" &&
      process.env.NEXT_PHASE !== "phase-production-build"
    ) {
      throw error;
    }
    return null;
  }
}

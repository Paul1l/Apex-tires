import { businessConfig } from "@/config/business";
import type { CatalogFilters, Product, ProductKind } from "@/lib/types";

/**
 * Catalog request contract shared by the storefront (browser fetch of
 * `/api/v1/products`) and the server-rendered first page (`app/page.tsx`,
 * `app/shiny/page.tsx`, `app/diski/page.tsx`). Both sides build the query
 * with the same function, so the browser can recognise the page the server
 * already rendered and skip the duplicate request.
 *
 * No server imports here: this module is bundled into the client.
 */

export const CATALOG_PAGE_SIZE = 24;
export const CATALOG_MAX_PRICE_FILTER = 60000;

export interface CatalogFacets {
  brands: string[];
  widths: number[];
  profiles: number[];
  diameters: number[];
}

export const EMPTY_CATALOG_FACETS: CatalogFacets = {
  brands: [],
  widths: [],
  profiles: [],
  diameters: [],
};

/** First catalog page rendered on the server and handed to the storefront. */
export interface InitialCatalog {
  /** Query string the page was loaded with (see buildCatalogSearchParams). */
  queryKey: string;
  items: Product[];
  total: number;
  totalPages: number;
  facets: CatalogFacets;
}

export function createDefaultCatalogFilters(
  kind: "all" | ProductKind = "all",
): CatalogFilters {
  return {
    kind,
    seasons: [],
    brands: [],
    width: "",
    profile: "",
    diameter: "",
    minPrice: 0,
    maxPrice: CATALOG_MAX_PRICE_FILTER,
    inStock: businessConfig.catalog.dataMode === "database",
    studded: false,
    runflat: false,
    carMake: "",
    carModel: "",
    carYear: "",
    carGeneration: "",
    query: "",
    sort: "popular",
  };
}

/** Maps storefront filters to the public `/api/v1/products` query string. */
export function buildCatalogSearchParams(
  filters: CatalogFilters,
  page: number,
): URLSearchParams {
  const parameters = new URLSearchParams({
    type: filters.kind,
    sort:
      filters.sort === "price-asc"
        ? "price_asc"
        : filters.sort === "price-desc"
          ? "price_desc"
          : "newest",
    page: String(page),
    pageSize: String(CATALOG_PAGE_SIZE),
  });
  if (filters.brands.length) parameters.set("brand", filters.brands.join(","));
  if (filters.seasons.length) parameters.set("season", filters.seasons.join(","));
  if (filters.width) parameters.set("width", filters.width);
  if (filters.profile) parameters.set("profile", filters.profile);
  if (filters.diameter) parameters.set("diameter", filters.diameter);
  if (filters.minPrice > 0) parameters.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice < CATALOG_MAX_PRICE_FILTER) {
    parameters.set("maxPrice", String(filters.maxPrice));
  }
  if (filters.inStock) parameters.set("inStock", "true");
  if (filters.studded) parameters.set("studded", "true");
  if (filters.runflat) parameters.set("runflat", "true");
  if (filters.query.trim()) parameters.set("search", filters.query.trim());
  if (filters.carMake && filters.carModel && filters.carGeneration) {
    parameters.set("vehicleMake", filters.carMake);
    parameters.set("vehicleModel", filters.carModel);
    parameters.set("vehicleGeneration", filters.carGeneration);
    if (filters.carModification) {
      parameters.set("vehicleModification", filters.carModification);
    }
  }
  return parameters;
}

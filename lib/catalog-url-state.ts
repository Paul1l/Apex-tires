import type { CatalogFilters, ProductKind, Season } from "@/lib/types";

/**
 * Storefront catalog state <-> address bar query string (UX-04).
 *
 * Only values that differ from the page defaults are written, so the base
 * page keeps a clean URL (`/shiny`, `/`), and every value read from a URL is
 * validated against the same limits as `GET /api/v1/products`: a hand-edited
 * or outdated link falls back to the default for that filter instead of
 * breaking the catalog.
 *
 * Pure functions, no browser APIs: shared by the storefront hook
 * (components/use-catalog-url-state.ts) and the tests.
 */

/** Price slider bounds in the filter panel (the upper bound is the default maxPrice). */
export const PRICE_SLIDER_MIN = 10_000;
export const PRICE_SLIDER_STEP = 1_000;

/** Query parameters owned by the catalog; any other parameter (utm_*, …) is kept as is. */
export const CATALOG_URL_KEYS = [
  "type",
  "q",
  "season",
  "brand",
  "width",
  "profile",
  "diameter",
  "price",
  "stock",
  "studded",
  "runflat",
  "make",
  "model",
  "year",
  "gen",
  "mod",
  "sort",
  "page",
] as const;

/** One-time instructions that must not stay in the address bar or in shared links. */
const ONE_TIME_URL_KEYS = ["cart"] as const;

export interface CatalogUrlState {
  filters: CatalogFilters;
  /** Catalog page (database mode) or number of "Показать ещё" pages (preview). */
  page: number;
}

export interface CatalogUrlOptions {
  /** The "По рейтингу" sort is offered only when ratings are enabled. */
  ratingSortEnabled?: boolean;
}

const KINDS: ReadonlyArray<CatalogFilters["kind"]> = ["all", "tire", "wheel"];
const SEASONS: ReadonlyArray<Season> = ["summer", "winter", "all-season"];
const SORTS: ReadonlyArray<CatalogFilters["sort"]> = ["popular", "price-asc", "price-desc", "rating"];
const MAX_PAGE = 10_000;
const MAX_SEARCH_LENGTH = 120;
const MAX_BRANDS_LENGTH = 500;
const MAX_BRAND_LENGTH = 80;

/** Removes control characters and surrounding spaces; empty when longer than `maxLength`. */
function cleanText(value: string | null, maxLength: number): string {
  if (value === null) return "";
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text.length <= maxLength ? text : "";
}

/** Numeric size value as shown in the filter selects ("205", "17.5"), within [min, max]. */
function cleanDimension(value: string | null, min: number, max: number, integer: boolean): string {
  if (value === null) return "";
  const pattern = integer ? /^\d{1,3}$/ : /^\d{1,3}(?:\.\d{1,2})?$/;
  if (!pattern.test(value)) return "";
  const number = Number(value);
  return number >= min && number <= max ? String(number) : "";
}

function flag(value: string | null): boolean | null {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

function listValues(value: string | null): string[] {
  return value === null ? [] : value.split(",").map((item) => item.trim()).filter(Boolean);
}

/** True when the query string carries at least one catalog parameter. */
export function hasCatalogUrlState(search: string | URLSearchParams): boolean {
  const parameters = typeof search === "string" ? new URLSearchParams(search) : search;
  return CATALOG_URL_KEYS.some((key) => parameters.has(key));
}

/**
 * Reads the catalog state from a query string. Missing or invalid values keep
 * the page defaults (`defaults`, e.g. kind "tire" on /shiny).
 */
export function parseCatalogUrlState(
  search: string | URLSearchParams,
  defaults: CatalogFilters,
  options: CatalogUrlOptions = {},
): CatalogUrlState {
  const parameters = typeof search === "string" ? new URLSearchParams(search) : search;
  const filters: CatalogFilters = {
    ...defaults,
    seasons: [...defaults.seasons],
    brands: [...defaults.brands],
  };

  const kind = parameters.get("type");
  if (kind !== null && (KINDS as readonly string[]).includes(kind)) {
    filters.kind = kind as "all" | ProductKind;
  }

  const query = cleanText(parameters.get("q"), MAX_SEARCH_LENGTH);
  if (query) filters.query = query;

  const seasons = listValues(parameters.get("season")).filter(
    (season): season is Season => (SEASONS as readonly string[]).includes(season),
  );
  if (seasons.length) filters.seasons = [...new Set(seasons)];

  const brands: string[] = [];
  for (const brand of listValues(parameters.get("brand"))) {
    const cleanBrand = cleanText(brand, MAX_BRAND_LENGTH);
    if (!cleanBrand || brands.includes(cleanBrand)) continue;
    if ([...brands, cleanBrand].join(",").length > MAX_BRANDS_LENGTH) break;
    brands.push(cleanBrand);
  }
  if (brands.length) filters.brands = brands;

  // Same bounds as server/validators/catalog-query-schema.ts.
  const width = cleanDimension(parameters.get("width"), 3, 500, false);
  if (width) filters.width = width;
  const profile = cleanDimension(parameters.get("profile"), 20, 100, true);
  if (profile) filters.profile = profile;
  const diameter = cleanDimension(parameters.get("diameter"), 8, 40, false);
  if (diameter) filters.diameter = diameter;

  const price = parameters.get("price");
  if (price !== null && /^\d{1,9}$/.test(price)) {
    // Snapped to the slider so the thumb and the label show the same value.
    const snapped = Math.round(Number(price) / PRICE_SLIDER_STEP) * PRICE_SLIDER_STEP;
    filters.maxPrice = Math.min(defaults.maxPrice, Math.max(PRICE_SLIDER_MIN, snapped));
  }

  const inStock = flag(parameters.get("stock"));
  if (inStock !== null) filters.inStock = inStock;
  if (flag(parameters.get("studded")) === true) filters.studded = true;
  if (flag(parameters.get("runflat")) === true) filters.runflat = true;

  const make = cleanText(parameters.get("make"), 100);
  const model = cleanText(parameters.get("model"), 100);
  if (make && model) {
    filters.carMake = make;
    filters.carModel = model;
    const year = parameters.get("year");
    if (year !== null && /^\d{4}$/.test(year) && Number(year) >= 1950 && Number(year) <= 2100) {
      filters.carYear = year;
    }
    const generation = cleanText(parameters.get("gen"), 120);
    if (generation) {
      filters.carGeneration = generation;
      const modification = cleanText(parameters.get("mod"), 160);
      if (modification) filters.carModification = modification;
    }
  }

  const sort = parameters.get("sort");
  if (
    sort !== null &&
    (SORTS as readonly string[]).includes(sort) &&
    (sort !== "rating" || options.ratingSortEnabled)
  ) {
    filters.sort = sort as CatalogFilters["sort"];
  }

  // Wheels have no season, tire size or tire options (same as the category switch).
  if (filters.kind === "wheel") {
    filters.seasons = [];
    filters.width = "";
    filters.profile = "";
    filters.studded = false;
    filters.runflat = false;
  }

  const pageValue = parameters.get("page");
  const page =
    pageValue !== null && /^\d{1,5}$/.test(pageValue)
      ? Math.min(MAX_PAGE, Math.max(1, Number(pageValue)))
      : 1;

  return { filters, page };
}

/** Catalog parameters for a state: only the values that differ from `defaults`, in a fixed order. */
export function serializeCatalogUrlState(
  { filters, page }: CatalogUrlState,
  defaults: CatalogFilters,
): URLSearchParams {
  const parameters = new URLSearchParams();
  if (filters.kind !== defaults.kind) parameters.set("type", filters.kind);
  const query = filters.query.trim();
  if (query) parameters.set("q", query);
  if (filters.seasons.length) parameters.set("season", filters.seasons.join(","));
  if (filters.brands.length) parameters.set("brand", filters.brands.join(","));
  if (filters.width) parameters.set("width", filters.width);
  if (filters.profile) parameters.set("profile", filters.profile);
  if (filters.diameter) parameters.set("diameter", filters.diameter);
  if (filters.maxPrice < defaults.maxPrice) parameters.set("price", String(filters.maxPrice));
  if (filters.inStock !== defaults.inStock) parameters.set("stock", filters.inStock ? "1" : "0");
  if (filters.studded) parameters.set("studded", "1");
  if (filters.runflat) parameters.set("runflat", "1");
  if (filters.carMake && filters.carModel) {
    parameters.set("make", filters.carMake);
    parameters.set("model", filters.carModel);
    if (filters.carYear) parameters.set("year", filters.carYear);
    if (filters.carGeneration) {
      parameters.set("gen", filters.carGeneration);
      if (filters.carModification) parameters.set("mod", filters.carModification);
    }
  }
  if (filters.sort !== defaults.sort) parameters.set("sort", filters.sort);
  if (page > 1) parameters.set("page", String(page));
  return parameters;
}

/** Query string with readable commas in lists (`brand=Michelin,Pirelli`). */
function toQueryString(parameters: URLSearchParams): string {
  return Array.from(
    parameters,
    ([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%2C/gi, ",")}`,
  ).join("&");
}

/**
 * Address for the current page with the given catalog parameters: other
 * parameters (utm_* and the like) and the hash are kept, catalog parameters
 * are replaced and one-time instructions (`cart=open`) are dropped.
 */
export function buildCatalogHref(
  location: { pathname: string; search: string; hash: string },
  catalogParameters: URLSearchParams,
): string {
  const otherParameters = new URLSearchParams(location.search);
  for (const key of [...CATALOG_URL_KEYS, ...ONE_TIME_URL_KEYS]) otherParameters.delete(key);
  const query = [toQueryString(catalogParameters), toQueryString(otherParameters)]
    .filter(Boolean)
    .join("&");
  return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

/** The current address without one-time instructions such as `cart=open`. */
export function withoutOneTimeParameters(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const parameters = new URLSearchParams(location.search);
  for (const key of ONE_TIME_URL_KEYS) parameters.delete(key);
  const query = toQueryString(parameters);
  return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

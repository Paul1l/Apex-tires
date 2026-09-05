import type { CatalogQuery } from "../validators/catalog-query-schema";

/** Only complete tire sizes are interpreted; ambiguous wheel requests remain text. */
export function normalizeCatalogSearch(query: CatalogQuery): CatalogQuery {
  const search = query.search?.trim().replace(/\s+/g, " ");
  const size = search?.match(/^(\d{3})[\s/]+(\d{2})[\s/]+[rр]?(\d{2})$/i);
  if (size && query.type !== "wheel") {
    const [, width, profile, diameter] = size.map(Number);
    if (width >= 80 && width <= 500 && profile >= 20 && profile <= 100 && diameter >= 8 && diameter <= 40) {
      return { ...query, type: "tire", width: query.width ?? width, profile: query.profile ?? profile,
        diameter: query.diameter ?? diameter, search: undefined };
    }
  }
  return { ...query, search: search || undefined };
}

import { SITEMAP_PAGE_SIZE } from "../../server/services/sitemap-service";

/**
 * "products-<n>.xml" → n. Only the canonical spelling is accepted (no leading
 * zeros), so every sitemap page has exactly one URL; anything else is 404.
 */
export function parseProductSitemapPage(fileName: string): number | null {
  const match = /^products-(0|[1-9]\d{0,4})\.xml$/.exec(fileName);
  return match ? Number(match[1]) : null;
}

/** Number of product sitemap pages listed in /sitemap.xml. */
export function productSitemapPageCount(productCount: number): number {
  return Math.ceil(Math.max(0, productCount) / SITEMAP_PAGE_SIZE);
}

/** A page outside the sitemap index (e.g. products-1.xml for 46 products) is 404. */
export function productSitemapPageExists(page: number, productCount: number): boolean {
  return Number.isInteger(page) && page >= 0 && page < productSitemapPageCount(productCount);
}

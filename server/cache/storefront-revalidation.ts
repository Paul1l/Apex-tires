import { revalidatePath } from "next/cache";
import { applicationLogger } from "../types/common";

/**
 * Storefront pages cached with ISR (`revalidate = 300`) that embed the first
 * catalog page. Product pages are rendered on every request and need no reset.
 */
export const STOREFRONT_CATALOG_PATHS = ["/", "/shiny", "/diski"] as const;

/**
 * Marks the cached catalog pages as stale after products, prices or stock
 * change, so the next visitor gets a page built from current data instead of
 * waiting for the 5-minute ISR interval.
 *
 * Works only inside a Next.js request (route handler); a CLI process outside
 * Next.js cannot reset the cache (see docs/CSV_IMPORTS.md). A failure is
 * logged and never fails the change that triggered it: the pages then update
 * on the regular interval.
 */
export function revalidateStorefrontCatalog(
  reason: string,
  revalidate: (path: string) => void = revalidatePath,
): boolean {
  let revalidated = true;
  for (const path of STOREFRONT_CATALOG_PATHS) {
    try {
      revalidate(path);
    } catch (error) {
      revalidated = false;
      applicationLogger.warn({ error, path, reason }, "Storefront catalog cache reset failed");
    }
  }
  return revalidated;
}

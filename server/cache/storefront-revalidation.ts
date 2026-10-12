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

/**
 * Storefront page of one product, as linked from the catalog cards:
 * `/tires/<slug>` or `/wheels/<slug>` with the slug percent-encoded.
 */
export function storefrontProductPath(product: { kind: "tire" | "wheel"; slug: string }): string {
  return `/${product.kind === "tire" ? "tires" : "wheels"}/${encodeURIComponent(product.slug)}`;
}

/**
 * Resets the catalog pages and the page of one changed product (admin
 * editor). Product pages are rendered on every request today; resetting them
 * too keeps the editor correct if they get a cache later. Failures are
 * logged, never thrown (see revalidateStorefrontCatalog).
 */
export function revalidateStorefrontProduct(
  reason: string,
  product: { kind: "tire" | "wheel"; slug: string } | null,
  revalidate: (path: string) => void = revalidatePath,
): boolean {
  let revalidated = revalidateStorefrontCatalog(reason, revalidate);
  if (!product) return revalidated;
  const path = storefrontProductPath(product);
  try {
    revalidate(path);
  } catch (error) {
    revalidated = false;
    applicationLogger.warn({ error, path, reason }, "Storefront product cache reset failed");
  }
  return revalidated;
}

/**
 * Marks every cached page of the site as stale (`revalidatePath("/",
 * "layout")`): store settings (contacts, address, hours, delivery, services)
 * appear in the layout, the catalog, the contacts page, legal documents and
 * structured data. Same rules as above: only inside a Next.js request; a
 * failure is logged, never thrown — the pages then update on their regular
 * interval.
 */
export function revalidateWholeSite(
  reason: string,
  revalidate: (path: string, type: "layout") => void = revalidatePath,
): boolean {
  try {
    revalidate("/", "layout");
    return true;
  } catch (error) {
    applicationLogger.warn({ error, reason }, "Whole site cache reset failed");
    return false;
  }
}

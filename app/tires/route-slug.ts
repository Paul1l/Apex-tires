/**
 * Product slug from a route parameter (/tires/[slug], /wheels/[slug]).
 *
 * Next.js passes the parameter percent-encoded ("шина-…" → "%D1%88…"), while
 * slugs are stored decoded (createProductSlug keeps Cyrillic letters). Returns
 * null — the page answers 404 — for values that cannot be a stored slug:
 * malformed percent-encoding, control or other non-printable characters
 * (NUL is rejected by PostgreSQL with a 500), path separators, or an
 * unreasonable length. Stored slugs are at most ~215 characters.
 */
export const MAX_PRODUCT_SLUG_LENGTH = 256;
const MAX_ENCODED_SLUG_LENGTH = MAX_PRODUCT_SLUG_LENGTH * 9;

export function decodeProductRouteSlug(raw: string): string | null {
  if (!raw || raw.length > MAX_ENCODED_SLUG_LENGTH) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!slug || slug.length > MAX_PRODUCT_SLUG_LENGTH) return null;
  // \p{C}: control (incl. NUL), format, surrogate, private-use, unassigned.
  if (/[\p{C}\s/\\]/u.test(slug)) return null;
  return slug;
}

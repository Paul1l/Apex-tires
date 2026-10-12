import {
  tireIllustrationAlt,
  tireIllustrationDataUri,
  type TireIllustrationInput,
} from "@/lib/tire-illustration";

/**
 * Generated tire illustration for products without a photo.
 *
 * No hooks and no "use client": the component renders the same markup as a
 * server component (product page) and inside client components (storefront).
 * The SVG is passed as a data URI to <img>, so gradient/clip ids inside the
 * SVG never collide between cards on the same page.
 */

const CACHE_LIMIT = 256;
const illustrationCache = new Map<string, { src: string; alt: string }>();

function cacheKey(product: TireIllustrationInput): string {
  return JSON.stringify([
    String(product.brand ?? "").slice(0, 200),
    String(product.model ?? "").slice(0, 200),
    product.season,
    product.studded,
    product.runflat,
    product.width,
    product.profile,
    product.diameter,
    product.xl ?? null,
    (product.tags ?? []).slice(0, 24).map((tag) => String(tag).slice(0, 60)),
  ]);
}

function illustrationFor(product: TireIllustrationInput) {
  const key = cacheKey(product);
  const cached = illustrationCache.get(key);
  if (cached) return cached;
  const entry = { src: tireIllustrationDataUri(product), alt: tireIllustrationAlt(product) };
  if (illustrationCache.size >= CACHE_LIMIT) {
    const oldest = illustrationCache.keys().next().value;
    if (oldest !== undefined) illustrationCache.delete(oldest);
  }
  illustrationCache.set(key, entry);
  return entry;
}

export function TireIllustration({
  product,
  decorative = false,
  className = "tire-illustration-image",
}: {
  product: TireIllustrationInput;
  /** Empty alt when the product name is already announced next to the image. */
  decorative?: boolean;
  className?: string;
}) {
  const { src, alt } = illustrationFor(product);
  return (
    // Generated data URI; next/image adds nothing for an inline SVG.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt={decorative ? "" : alt}
      loading="lazy"
      decoding="async"
      width={400}
      height={400}
    />
  );
}

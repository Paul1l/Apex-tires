import type { Metadata } from "next";
import { businessConfig, getSellerDisplayName, type AvailabilityDisplayMode, type BusinessConfig } from "../config/business";
import { validateBusinessConfig } from "../config/business-validation";
import { getAvailabilityPresentation } from "./product-presentation";
import type { ProductDetails, ProductKind } from "./types";

/**
 * SEO helpers: JSON-LD builders (schema.org) and shared page metadata.
 *
 * Every builder is a pure function of its arguments, so the rules below are
 * covered by server/tests/structured-data.test.ts:
 * - commercial markup (Product/Offer) only when the catalog reads real data
 *   (`catalog.dataMode === "database"`) — preview prices are demonstrations;
 * - business markup only on the production stage and only with values that
 *   pass the same checks that gate a production build (no placeholders);
 * - absolute URLs only (they need `siteUrl`); nothing is emitted otherwise;
 * - no ratings or reviews: the catalog has no verified review data.
 */

const SCHEMA_CONTEXT = "https://schema.org";

type JsonLd = Record<string, unknown>;

/**
 * Serializes JSON-LD for `<script type="application/ld+json">`. `<` is
 * escaped so a value such as `</script>` cannot close the element; `>` and
 * `&` are escaped as well (HTML comment / entity edge cases). The output is
 * still valid JSON and parses back to the same data.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Resolves a site path (or an absolute http(s) URL) against `siteUrl`.
 * Returns null without a valid site URL or for non-http(s) values such as
 * `data:` images.
 */
export function toAbsoluteUrl(siteUrl: string | null, pathOrUrl: string): string | null {
  if (!siteUrl) return null;
  let base: URL;
  try {
    base = new URL(siteUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;

  let resolved: URL;
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(pathOrUrl)) {
      resolved = new URL(pathOrUrl);
    } else {
      if (pathOrUrl.startsWith("//")) return null;
      const basePath = base.pathname.replace(/\/+$/, "");
      const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
      resolved = new URL(`${basePath}${path}`, base.origin);
    }
  } catch {
    return null;
  }
  return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.href : null;
}

export function getProductPath(kind: ProductKind, slug: string): string {
  return `/${kind === "tire" ? "tires" : "wheels"}/${encodeURIComponent(slug)}`;
}

export function getCatalogPath(kind: ProductKind): "/shiny" | "/diski" {
  return kind === "tire" ? "/shiny" : "/diski";
}

export function getCatalogLabel(kind: ProductKind): "Шины" | "Диски" {
  return kind === "tire" ? "Шины" : "Диски";
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export function getProductBreadcrumbs(
  product: Pick<ProductDetails, "kind" | "name">,
  slug: string,
): BreadcrumbItem[] {
  return [
    { name: "Главная", path: "/" },
    { name: getCatalogLabel(product.kind), path: getCatalogPath(product.kind) },
    { name: product.name, path: getProductPath(product.kind, slug) },
  ];
}

export function createBreadcrumbListJsonLd(
  items: BreadcrumbItem[],
  siteUrl: string | null,
): JsonLd | null {
  const elements = items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: toAbsoluteUrl(siteUrl, item.path),
  }));
  if (elements.length === 0 || elements.some((element) => !element.item)) return null;
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: elements,
  };
}

export const SCHEMA_AVAILABILITY = {
  inStock: "https://schema.org/InStock",
  limited: "https://schema.org/LimitedAvailability",
  backOrder: "https://schema.org/BackOrder",
  outOfStock: "https://schema.org/OutOfStock",
} as const;

/**
 * Maps the storefront availability label (same helper and display mode as the
 * catalog cards) to schema.org, so the markup never claims more than the page
 * shows: "Под заказ" → BackOrder, "Мало" → LimitedAvailability.
 */
export function getSchemaAvailability(
  product: Pick<ProductDetails, "stock" | "reserved">,
  displayMode: AvailabilityDisplayMode,
): string {
  const presentation = getAvailabilityPresentation(product, displayMode, false);
  if (!presentation.available) return SCHEMA_AVAILABILITY.outOfStock;
  if (displayMode === "on_request") return SCHEMA_AVAILABILITY.backOrder;
  if (displayMode === "limited" && presentation.label === "Мало") return SCHEMA_AVAILABILITY.limited;
  return SCHEMA_AVAILABILITY.inStock;
}

type ProductJsonLdConfig = Pick<BusinessConfig, "siteUrl"> & {
  catalog: Pick<BusinessConfig["catalog"], "dataMode" | "availabilityDisplayMode">;
};

/**
 * Product + Offer for a product page. Returns null in the preview catalog
 * (demonstration prices), without `siteUrl`, or without a positive price.
 * `image` is set only for a real product photo; generated illustrations are
 * not product photos and are left out.
 */
export function createProductJsonLd(
  product: ProductDetails,
  slug: string,
  config: ProductJsonLdConfig,
): JsonLd | null {
  if (config.catalog.dataMode !== "database") return null;
  const url = toAbsoluteUrl(config.siteUrl, getProductPath(product.kind, slug));
  if (!url) return null;
  if (!Number.isFinite(product.price) || product.price <= 0) return null;

  const image = product.image ? toAbsoluteUrl(config.siteUrl, product.image) : null;
  const description = product.description?.trim();

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    sku: product.sku,
    brand: { "@type": "Brand", name: product.brand },
    model: product.model || undefined,
    category: getCatalogLabel(product.kind),
    description: description || undefined,
    image: image ? [image] : undefined,
    countryOfOrigin: product.country ? { "@type": "Country", name: product.country } : undefined,
    url,
    offers: {
      "@type": "Offer",
      url,
      price: Math.round(product.price * 100) / 100,
      priceCurrency: "RUB",
      availability: getSchemaAvailability(product, config.catalog.availabilityDisplayMode),
      itemCondition:
        product.condition === "used"
          ? "https://schema.org/UsedCondition"
          : "https://schema.org/NewCondition",
    },
  };
}

const DAY_CODES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
const DAY_LIST = `${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*`;
const OPENING_SEGMENT = new RegExp(`(${DAY_LIST})\\s+(\\d{2}:\\d{2})-(\\d{2}:\\d{2})`, "g");

export interface OpeningHoursSpecification {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: string[];
  opens: string;
  closes: string;
}

function validTime(value: string, allowEndOfDay: boolean): boolean {
  const [hours, minutes] = value.split(":").map(Number);
  if (allowEndOfDay && hours === 24 && minutes === 0) return true;
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function expandDays(list: string): string[] {
  const days = new Set<string>();
  for (const part of list.split(",")) {
    const [from, to = from] = part.split("-");
    const start = DAY_CODES.indexOf(from as (typeof DAY_CODES)[number]);
    const end = DAY_CODES.indexOf(to as (typeof DAY_CODES)[number]);
    for (let step = 0; step < 7; step += 1) {
      const index = (start + step) % 7;
      days.add(DAY_NAMES[index]);
      if (index === end) break;
    }
  }
  return DAY_NAMES.filter((day) => days.has(day));
}

/**
 * Parses working hours written in the schema.org `openingHours` format, e.g.
 * "Mo-Fr 09:00-19:00; Sa 10:00-16:00". Free text ("Пн–Пт 9–19") returns null:
 * it cannot be converted without guessing, so it is not marked up.
 */
export function parseSchemaOpeningHours(value: string | null): OpeningHoursSpecification[] | null {
  const normalized = value?.replace(/[\u2013\u2014]/g, "-").trim();
  if (!normalized) return null;

  const specifications: OpeningHoursSpecification[] = [];
  for (const match of normalized.matchAll(OPENING_SEGMENT)) {
    const [, days, opens, closes] = match;
    if (!validTime(opens, false) || !validTime(closes, true)) return null;
    specifications.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: expandDays(days),
      opens,
      closes,
    });
  }
  const leftover = normalized.replace(OPENING_SEGMENT, "");
  if (specifications.length === 0 || /[^\s;,]/.test(leftover)) return null;
  return specifications;
}

const DAY_LABELS_RU: Record<string, string> = {
  Monday: "Пн",
  Tuesday: "Вт",
  Wednesday: "Ср",
  Thursday: "Чт",
  Friday: "Пт",
  Saturday: "Сб",
  Sunday: "Вс",
};

function describeDays(days: string[]): string {
  const indexes = days.map((day) => DAY_NAMES.indexOf(day as (typeof DAY_NAMES)[number]));
  const groups: number[][] = [];
  for (const index of indexes) {
    const last = groups.at(-1);
    if (last && index === last[last.length - 1] + 1) last.push(index);
    else groups.push([index]);
  }
  return groups
    .map((group) =>
      group.length >= 3
        ? `${DAY_LABELS_RU[DAY_NAMES[group[0]]]}\u2013${DAY_LABELS_RU[DAY_NAMES[group[group.length - 1]]]}`
        : group.map((index) => DAY_LABELS_RU[DAY_NAMES[index]]).join(", "),
    )
    .join(", ");
}

/**
 * Human-readable working hours for the page. Values in the schema.org format
 * ("Mo-Fr 09:00-19:00; Sa 10:00-16:00") are shown in Russian
 * ("Пн–Пт 09:00–19:00, Сб 10:00–16:00"); any other text is shown as is.
 */
export function formatWorkingHours(value: string | null): string | null {
  const specifications = parseSchemaOpeningHours(value);
  if (!specifications) return value?.trim() || null;
  return specifications
    .map(({ dayOfWeek, opens, closes }) => {
      const hours = opens === "00:00" && closes === "24:00" ? "круглосуточно" : `${opens}\u2013${closes}`;
      return `${describeDays(dayOfWeek)} ${hours}`;
    })
    .join(", ");
}

function httpUrls(values: Array<string | null>): string[] {
  return values.filter((value): value is string => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  });
}

/**
 * Site-wide JSON-LD (`@graph` with the organization and the WebSite).
 *
 * Only on the production stage: preview contacts are not confirmed (the only
 * confirmation gate is `assertProductionBusinessConfig`). A value is used only
 * if it passes `validateBusinessConfig` (no placeholders or test data). The
 * organization becomes a `TireShop` (schema.org LocalBusiness) only with a
 * confirmed address and phone; opening hours only in the schema.org format.
 */
export function createSiteJsonLd(config: BusinessConfig = businessConfig): JsonLd | null {
  if (config.deploymentStage !== "production") return null;
  const siteUrl = toAbsoluteUrl(config.siteUrl, "/");
  if (!siteUrl) return null;

  const invalidFields = new Set(validateBusinessConfig(config).map((issue) => issue.field));
  const confirmed = (field: string) => !invalidFields.has(field);
  if (!confirmed("siteUrl")) return null;

  const organizationId = `${siteUrl}#organization`;
  const logoSource = config.branding.logoSource ?? config.branding.faviconSource;
  const logo = logoSource ? toAbsoluteUrl(siteUrl, logoSource) : null;
  const sellerName = confirmed("seller") ? getSellerDisplayName(config) : null;
  const businessName = confirmed("businessName") ? config.businessName : null;
  const sameAs = httpUrls([config.social.vk, config.social.telegram, config.social.twoGis]);

  const organization: JsonLd = {
    "@type": "Organization",
    "@id": organizationId,
    name: config.brandName,
    alternateName: businessName && businessName !== config.brandName ? businessName : undefined,
    legalName: sellerName ?? undefined,
    url: siteUrl,
    logo: logo ?? undefined,
    sameAs: sameAs.length > 0 ? sameAs : undefined,
  };

  const { address, latitude, longitude } = config.location;
  const phone = confirmed("contacts.phone") ? config.contacts.phone : null;
  const email = confirmed("contacts.email") ? config.contacts.email : null;
  if (address && phone && confirmed("location.address")) {
    const openingHours = parseSchemaOpeningHours(config.workingHours);
    Object.assign(organization, {
      "@type": "TireShop",
      image: logo ?? undefined,
      telephone: phone,
      email: email ?? undefined,
      address: {
        "@type": "PostalAddress",
        streetAddress: address,
        addressLocality: config.location.city,
        addressCountry: "RU",
      },
      geo:
        latitude !== null && longitude !== null
          ? { "@type": "GeoCoordinates", latitude, longitude }
          : undefined,
      openingHoursSpecification: openingHours ?? undefined,
    });
  }

  const website: JsonLd = {
    "@type": "WebSite",
    "@id": `${siteUrl}#website`,
    url: siteUrl,
    name: config.brandName,
    inLanguage: "ru-RU",
    publisher: { "@id": organizationId },
  };

  return { "@context": SCHEMA_CONTEXT, "@graph": [organization, website] };
}

type OpenGraphConfig = Pick<BusinessConfig, "brandName"> & {
  branding: Pick<BusinessConfig["branding"], "openGraphImageSource">;
};

/**
 * Site-wide Open Graph image: app/opengraph-image.jpg, which Next.js serves at
 * this path. It is referenced here instead of relying on the file convention:
 * Next.js applies a file-based image only to the segment that has it, and the
 * `openGraph` of every page (createPageSeoMetadata) would replace it. The alt
 * text repeats the text on the image.
 */
export const DEFAULT_OPEN_GRAPH_IMAGE = {
  url: "/opengraph-image.jpg",
  width: 1200,
  height: 630,
  type: "image/jpeg",
  alt: "APEX WHEELS — шины и диски в Барнауле",
} as const;

/**
 * Open Graph defaults shared by the root layout and pages. The image is the
 * configured one (NEXT_PUBLIC_OPEN_GRAPH_IMAGE_SOURCE) or the site default.
 */
export function createBaseOpenGraph(config: OpenGraphConfig = businessConfig) {
  const image = config.branding.openGraphImageSource;
  return {
    type: "website" as const,
    siteName: config.brandName,
    locale: "ru_RU",
    images: [image ?? { ...DEFAULT_OPEN_GRAPH_IMAGE }],
  };
}

/**
 * Canonical URL and Open Graph for one page. Next.js replaces (does not merge)
 * a parent `openGraph`, so pages pass through this helper to keep site name,
 * locale and the default image. Paths are relative: `metadataBase` (siteUrl)
 * makes them absolute. og:title/og:description fall back to the page title
 * and description.
 */
export function createPageSeoMetadata(
  path: string,
  options: { image?: string | null; config?: OpenGraphConfig } = {},
): Pick<Metadata, "alternates" | "openGraph"> {
  const openGraph = createBaseOpenGraph(options.config);
  return {
    alternates: { canonical: path },
    openGraph: {
      ...openGraph,
      url: path,
      ...(options.image ? { images: [options.image] } : {}),
    },
  };
}

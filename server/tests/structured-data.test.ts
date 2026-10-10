import assert from "node:assert/strict";
import test from "node:test";
import { businessConfig, type BusinessConfig } from "../../config/business.js";
import type { ProductDetails } from "../../lib/types.js";
import {
  SCHEMA_AVAILABILITY,
  createBreadcrumbListJsonLd,
  createPageSeoMetadata,
  createProductJsonLd,
  createSiteJsonLd,
  formatWorkingHours,
  getProductBreadcrumbs,
  getSchemaAvailability,
  parseSchemaOpeningHours,
  serializeJsonLd,
  toAbsoluteUrl,
} from "../../lib/structured-data.js";

const SITE_URL = "https://shop.example-tires.ru";

/** Structural view for reading nested JSON-LD values in assertions. */
type JsonView = { readonly [key: string]: JsonView };

function catalogConfig(
  dataMode: "database" | "preview",
  availabilityDisplayMode: BusinessConfig["catalog"]["availabilityDisplayMode"] = "available",
  siteUrl: string | null = SITE_URL,
) {
  return { siteUrl, catalog: { dataMode, availabilityDisplayMode } };
}

function tire(overrides: Partial<ProductDetails> = {}): ProductDetails {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    sku: "T-MI-PS5-2254518",
    slug: "michelin-pilot-sport-5",
    kind: "tire",
    condition: "new",
    brand: "Michelin",
    model: "Pilot Sport 5",
    name: "Michelin Pilot Sport 5 225/45 R18 95Y",
    description: "Летняя шина для спортивных седанов.",
    subtitle: "225/45 R18",
    width: 225,
    profile: 45,
    diameter: 18,
    season: "summer",
    studded: false,
    runflat: false,
    xl: true,
    price: 18490,
    priceUpdatedAt: "2026-09-01T00:00:00.000Z",
    stock: 12,
    reserved: 2,
    warehouse: "Основной склад",
    tags: [],
    country: "Франция",
    compatibleCars: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function productConfig(dataMode: "database" | "preview" = "database") {
  return catalogConfig(dataMode, "available");
}

const productSlug = "michelin-pilot-sport-5";

test("serializeJsonLd escapes </script> and stays valid JSON", () => {
  const data = { name: "Шина </script><script>alert(1)</script> & <!-- x -->" };
  const serialized = serializeJsonLd(data);

  assert.ok(!serialized.includes("<"), "no raw < in the script body");
  assert.ok(!serialized.toLowerCase().includes("</script"));
  assert.ok(serialized.includes("\\u003c/script\\u003e"));
  assert.deepEqual(JSON.parse(serialized), data);
});

test("product names with </script> cannot break out of the JSON-LD element", () => {
  const product = tire({ name: "Evil </script><img src=x onerror=alert(1)>" });
  const jsonLd = createProductJsonLd(product, productSlug, productConfig());
  const serialized = serializeJsonLd(jsonLd);

  assert.ok(!serialized.includes("<"));
  assert.equal((JSON.parse(serialized) as { name: string }).name, product.name);
});

test("Product + Offer are built for the database catalog", () => {
  const jsonLd = createProductJsonLd(tire(), productSlug, productConfig()) as unknown as JsonView;
  const url = `${SITE_URL}/tires/${productSlug}`;

  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "Product");
  assert.equal(jsonLd.name, "Michelin Pilot Sport 5 225/45 R18 95Y");
  assert.equal(jsonLd.sku, "T-MI-PS5-2254518");
  assert.deepEqual(jsonLd.brand, { "@type": "Brand", name: "Michelin" });
  assert.equal(jsonLd.url, url);
  assert.equal(jsonLd.offers["@type"], "Offer");
  assert.equal(jsonLd.offers.price, 18490);
  assert.equal(jsonLd.offers.priceCurrency, "RUB");
  assert.equal(jsonLd.offers.availability, SCHEMA_AVAILABILITY.inStock);
  assert.equal(jsonLd.offers.itemCondition, "https://schema.org/NewCondition");
  assert.equal(jsonLd.offers.url, url);
  assert.equal(jsonLd.image, undefined, "illustrations are not product photos");
  assert.equal(jsonLd.aggregateRating, undefined);
  assert.equal(jsonLd.review, undefined);
  // undefined fields disappear from the serialized markup
  assert.ok(!serializeJsonLd(jsonLd).includes("image"));
});

test("product photo becomes an absolute image URL; data: and http-less values are dropped", () => {
  const relative = createProductJsonLd(tire({ image: "/assets/products/ps5.jpg" }), productSlug, productConfig()) as unknown as JsonView;
  assert.deepEqual(relative.image, [`${SITE_URL}/assets/products/ps5.jpg`]);

  const cdn = createProductJsonLd(tire({ image: "https://cdn.example-tires.ru/ps5.webp" }), productSlug, productConfig()) as unknown as JsonView;
  assert.deepEqual(cdn.image, ["https://cdn.example-tires.ru/ps5.webp"]);

  const dataUri = createProductJsonLd(tire({ image: "data:image/svg+xml;base64,AAAA" }), productSlug, productConfig()) as unknown as JsonView;
  assert.equal(dataUri.image, undefined);
});

test("used products are marked with UsedCondition, wheels with their catalog path", () => {
  const used = createProductJsonLd(tire({ condition: "used" }), productSlug, productConfig()) as unknown as JsonView;
  assert.equal(used.offers.itemCondition, "https://schema.org/UsedCondition");

  const wheel = createProductJsonLd(tire({ kind: "wheel", name: "BBS XR R18" }), "bbs-xr", productConfig()) as unknown as JsonView;
  assert.equal(wheel.url, `${SITE_URL}/wheels/bbs-xr`);
  assert.equal(wheel.category, "Диски");
});

test("preview catalog never emits price markup", () => {
  assert.equal(createProductJsonLd(tire(), productSlug, productConfig("preview")), null);
  assert.equal(
    createProductJsonLd(tire(), productSlug, { ...businessConfig, catalog: { ...businessConfig.catalog, dataMode: "preview" } }),
    null,
  );
});

test("no Product markup without siteUrl or without a positive price", () => {
  assert.equal(createProductJsonLd(tire(), productSlug, catalogConfig("database", "available", null)), null);
  assert.equal(createProductJsonLd(tire({ price: 0 }), productSlug, productConfig()), null);
  assert.equal(createProductJsonLd(tire({ price: Number.NaN }), productSlug, productConfig()), null);
});

test("Offer availability follows the storefront display mode", () => {
  const inStock = { stock: 10, reserved: 1 };
  const few = { stock: 3, reserved: 0 };
  const none = { stock: 2, reserved: 2 };

  assert.equal(getSchemaAvailability(inStock, "on_request"), SCHEMA_AVAILABILITY.backOrder);
  assert.equal(getSchemaAvailability(none, "on_request"), SCHEMA_AVAILABILITY.backOrder);
  assert.equal(getSchemaAvailability(inStock, "exact"), SCHEMA_AVAILABILITY.inStock);
  assert.equal(getSchemaAvailability(inStock, "available"), SCHEMA_AVAILABILITY.inStock);
  assert.equal(getSchemaAvailability(few, "limited"), SCHEMA_AVAILABILITY.limited);
  assert.equal(getSchemaAvailability(inStock, "limited"), SCHEMA_AVAILABILITY.inStock);
  assert.equal(getSchemaAvailability(none, "exact"), SCHEMA_AVAILABILITY.outOfStock);
  assert.equal(getSchemaAvailability(inStock, "out_of_stock"), SCHEMA_AVAILABILITY.outOfStock);

  const offer = (createProductJsonLd(tire(), productSlug, catalogConfig("database", "on_request")) as unknown as JsonView).offers;
  assert.equal(offer.availability, SCHEMA_AVAILABILITY.backOrder);
});

test("BreadcrumbList: Главная → category → product with absolute URLs", () => {
  const items = getProductBreadcrumbs(tire(), productSlug);
  const jsonLd = createBreadcrumbListJsonLd(items, SITE_URL) as unknown as JsonView;

  assert.equal(jsonLd["@type"], "BreadcrumbList");
  assert.deepEqual(
    (jsonLd.itemListElement as unknown as JsonView[]).map((item) => [item.position, item.name, item.item]),
    [
      [1, "Главная", `${SITE_URL}/`],
      [2, "Шины", `${SITE_URL}/shiny`],
      [3, "Michelin Pilot Sport 5 225/45 R18 95Y", `${SITE_URL}/tires/${productSlug}`],
    ],
  );
  assert.equal(getProductBreadcrumbs(tire({ kind: "wheel" }), "x")[1].path, "/diski");
  assert.equal(createBreadcrumbListJsonLd(items, null), null);
});

test("non-ASCII slugs are percent-encoded in canonical and JSON-LD URLs", () => {
  const slug = "шина-пример-sku-1";
  const jsonLd = createProductJsonLd(tire(), slug, productConfig()) as unknown as JsonView;
  assert.equal(jsonLd.url, `${SITE_URL}/tires/${encodeURIComponent(slug)}`);
});

test("toAbsoluteUrl keeps only http(s) URLs", () => {
  assert.equal(toAbsoluteUrl(SITE_URL, "/"), `${SITE_URL}/`);
  assert.equal(toAbsoluteUrl(`${SITE_URL}/`, "/legal"), `${SITE_URL}/legal`);
  assert.equal(toAbsoluteUrl(SITE_URL, "javascript:alert(1)"), null);
  assert.equal(toAbsoluteUrl(SITE_URL, "//evil.example/x"), null);
  assert.equal(toAbsoluteUrl(null, "/"), null);
  assert.equal(toAbsoluteUrl("not a url", "/"), null);
});

function productionConfig(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    ...businessConfig,
    deploymentStage: "production",
    siteUrl: SITE_URL,
    businessName: "Шинный центр APEX",
    seller: {
      ...businessConfig.seller,
      lastName: "Петров",
      firstName: "Сергей",
      patronymic: "Олегович",
      inn: "222100000000",
      ogrnip: "322220000000000",
    },
    contacts: { ...businessConfig.contacts, phone: "+7 (3852) 00-00-01", email: "shop@apex-barnaul.ru" },
    location: { ...businessConfig.location, address: "ул. Попова, 1", latitude: 53.37, longitude: 83.75 },
    workingHours: "Mo-Fr 09:00-19:00; Sa 10:00-16:00",
    catalog: { ...businessConfig.catalog, dataMode: "database" },
    ...overrides,
  } as BusinessConfig;
}

test("site JSON-LD is not emitted on the preview stage", () => {
  assert.equal(createSiteJsonLd(businessConfig), null);
  assert.equal(createSiteJsonLd({ ...productionConfig(), deploymentStage: "preview" }), null);
});

test("production: Organization (TireShop) + WebSite with confirmed contacts", () => {
  const jsonLd = createSiteJsonLd(productionConfig()) as unknown as JsonView;
  const organization = jsonLd["@graph"][0];
  const website = jsonLd["@graph"][1];

  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(organization["@type"], "TireShop");
  assert.equal(organization.name, businessConfig.brandName);
  assert.equal(organization.url, `${SITE_URL}/`);
  assert.equal(organization.logo, `${SITE_URL}/icon.svg`);
  assert.equal(organization.telephone, "+7 (3852) 00-00-01");
  assert.equal(organization.address.streetAddress, "ул. Попова, 1");
  assert.equal(organization.address.addressLocality, "Барнаул");
  assert.deepEqual(organization.openingHoursSpecification, [
    { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "09:00", closes: "19:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday"], opens: "10:00", closes: "16:00" },
  ]);
  assert.equal(organization.aggregateRating, undefined);
  assert.equal(website["@type"], "WebSite");
  assert.equal(website.url, `${SITE_URL}/`);
  assert.deepEqual(website.publisher, { "@id": organization["@id"] });
});

test("unconfirmed or placeholder contacts are never marked up", () => {
  const config = productionConfig({
    contacts: { ...businessConfig.contacts, phone: "+7 999 999-99-99", email: null },
  });
  const organization = (createSiteJsonLd(config) as unknown as JsonView)["@graph"][0];

  assert.equal(organization["@type"], "Organization");
  assert.equal(organization.telephone, undefined);
  assert.equal(organization.address, undefined);
  assert.equal(organization.email, undefined);
});

test("free-text working hours are not marked up", () => {
  const config = productionConfig({ workingHours: "Пн–Пт 9:00–19:00, без выходных" });
  const organization = (createSiteJsonLd(config) as unknown as JsonView)["@graph"][0];
  assert.equal(organization.openingHoursSpecification, undefined);
});

test("parseSchemaOpeningHours accepts only the schema.org format", () => {
  assert.deepEqual(parseSchemaOpeningHours("Mo-Su 00:00-24:00")?.[0].dayOfWeek.length, 7);
  assert.deepEqual(parseSchemaOpeningHours("Mo,We,Fr 10:00-18:00")?.[0].dayOfWeek, ["Monday", "Wednesday", "Friday"]);
  assert.equal(parseSchemaOpeningHours("Mo-Fr 09:00-19:00, Sa 10:00-15:00")?.length, 2);
  assert.equal(parseSchemaOpeningHours("Mo-Fr 9:00-19:00"), null);
  assert.equal(parseSchemaOpeningHours("Mo-Fr 09:00-25:00"), null);
  assert.equal(parseSchemaOpeningHours("Mo-Fr 09:00-19:00 и по записи"), null);
  assert.equal(parseSchemaOpeningHours(""), null);
  assert.equal(parseSchemaOpeningHours(null), null);
});

test("page metadata: self-canonical and og:url keep site-wide Open Graph defaults", () => {
  const metadata = createPageSeoMetadata("/contacts", {
    config: { brandName: "APEX WHEELS", branding: { openGraphImageSource: "/og.png" } },
  });
  assert.deepEqual(metadata.alternates, { canonical: "/contacts" });
  assert.deepEqual(metadata.openGraph, {
    type: "website",
    siteName: "APEX WHEELS",
    locale: "ru_RU",
    images: ["/og.png"],
    url: "/contacts",
  });

  const product = createPageSeoMetadata("/tires/x", { image: "/assets/x.jpg" });
  assert.deepEqual((product.openGraph as { images: string[] }).images, ["/assets/x.jpg"]);
});

test("formatWorkingHours shows schema.org hours in Russian and keeps free text", () => {
  assert.equal(formatWorkingHours("Mo-Fr 09:00-19:00; Sa 10:00-16:00"), "Пн\u2013Пт 09:00\u201319:00, Сб 10:00\u201316:00");
  assert.equal(formatWorkingHours("Mo,We,Fr 10:00-18:00"), "Пн, Ср, Пт 10:00\u201318:00");
  assert.equal(formatWorkingHours("Mo-Su 00:00-24:00"), "Пн\u2013Вс круглосуточно");
  assert.equal(formatWorkingHours("Пн–Пт 9–19"), "Пн–Пт 9–19");
  assert.equal(formatWorkingHours(null), null);
});

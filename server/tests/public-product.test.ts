import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { businessConfig, type AvailabilityDisplayMode } from "../../config/business.js";
import { getCartLineLimit } from "../../components/store-provider.js";
import { getAvailabilityPresentation } from "../../lib/product-presentation.js";
import { getSchemaAvailability } from "../../lib/structured-data.js";
import type { Product } from "../../lib/types.js";
import type { CatalogProductRow, ProductRepository } from "../repositories/product-repository.js";
import { CatalogService } from "../services/catalog-service.js";
import { toPublicProduct, toPublicStock } from "../services/public-product.js";

const DISPLAY_MODES: AvailabilityDisplayMode[] = [
  "exact",
  "limited",
  "available",
  "on_request",
  "out_of_stock",
];

/** Stored stock/reserve pairs: every split up to 12 units plus large stocks. */
const STOCK_CASES: Array<{ stock: number; reserved: number }> = [];
for (let stock = 0; stock <= 12; stock += 1) {
  for (let reserved = 0; reserved <= stock; reserved += 1) STOCK_CASES.push({ stock, reserved });
}
STOCK_CASES.push(
  { stock: 37, reserved: 0 },
  { stock: 37, reserved: 33 },
  { stock: 250, reserved: 17 },
  { stock: 1_000, reserved: 1_000 },
  // A reserve above the stock (inconsistent external data) is "nothing free".
  { stock: 2, reserved: 5 },
);

const catalogConfig = businessConfig.catalog as {
  dataMode: "database" | "preview";
  availabilityDisplayMode: AvailabilityDisplayMode;
};

function withCatalogConfig<Result>(
  dataMode: "database" | "preview",
  displayMode: AvailabilityDisplayMode,
  run: () => Result,
): Result {
  const previous = { ...catalogConfig };
  catalogConfig.dataMode = dataMode;
  catalogConfig.availabilityDisplayMode = displayMode;
  try {
    return run();
  } finally {
    Object.assign(catalogConfig, previous);
  }
}

/** Everything the storefront derives from stock: card/page label, button, cart limit, JSON-LD. */
function storefrontView(
  values: { stock: number; reserved: number },
  displayMode: AvailabilityDisplayMode,
  catalogIsPreview: boolean,
) {
  const presentation = getAvailabilityPresentation(values, displayMode, catalogIsPreview);
  return {
    label: presentation.label,
    available: presentation.available,
    // components/product-details-page.tsx: availability.available && availableQuantity > 0
    productPageCanAddToCart: presentation.available && presentation.availableQuantity > 0,
    cartLineLimit: withCatalogConfig(
      catalogIsPreview ? "preview" : "database",
      displayMode,
      () => getCartLineLimit(values),
    ),
    schemaAvailability: getSchemaAvailability(values, displayMode),
  };
}

for (const displayMode of DISPLAY_MODES) {
  test(`${displayMode}: the storefront shows the same availability with public stock values`, () => {
    for (const catalogIsPreview of [false, true]) {
      for (const stored of STOCK_CASES) {
        const published = toPublicStock(stored.stock, stored.reserved, displayMode);
        assert.deepEqual(
          storefrontView(published, displayMode, catalogIsPreview),
          storefrontView(stored, displayMode, catalogIsPreview),
          `${displayMode}, preview=${catalogIsPreview}, stock=${stored.stock}, reserved=${stored.reserved}`,
        );
      }
    }
  });
}

test("exact mode publishes stored stock and reserve (the storefront shows the free quantity)", () => {
  for (const stored of STOCK_CASES) {
    assert.deepEqual(toPublicStock(stored.stock, stored.reserved, "exact"), stored);
  }
});

for (const displayMode of DISPLAY_MODES.filter((mode) => mode !== "exact")) {
  test(`${displayMode}: public values do not reveal the free quantity or the reserve`, () => {
    const freeQuantityByPublishedStock = new Map<number, Set<number>>();
    for (const stored of STOCK_CASES) {
      const published = toPublicStock(stored.stock, stored.reserved, displayMode);
      assert.equal(published.reserved, 0);
      const freeQuantity = Math.max(0, stored.stock - stored.reserved);
      const quantities = freeQuantityByPublishedStock.get(published.stock) ?? new Set<number>();
      quantities.add(freeQuantity);
      freeQuantityByPublishedStock.set(published.stock, quantities);
    }
    const publishedValues = [...freeQuantityByPublishedStock.keys()].sort((a, b) => a - b);
    assert.deepEqual(publishedValues, displayMode === "limited" ? [0, 1, 5] : [0, 1]);
    // Each non-zero published value stands for several real quantities.
    for (const value of publishedValues.filter((published) => published > 0)) {
      assert.ok(freeQuantityByPublishedStock.get(value)!.size >= 4, `${displayMode}: ${value}`);
    }
    // Zero always means "nothing free".
    assert.deepEqual([...freeQuantityByPublishedStock.get(0)!], [0]);
  });
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "8a1d8f0c-8a2b-4c1f-9a51-3f7c4b5d6e7f",
    sku: "SKU-1",
    externalId: "1c-guid-000123",
    slug: "test-tire",
    kind: "tire",
    condition: "new",
    brand: "Brand",
    model: "Model",
    subtitle: "205/55 R16",
    width: 205,
    profile: 55,
    diameter: 16,
    season: "summer",
    studded: false,
    runflat: false,
    price: 5_000,
    priceUpdatedAt: "2026-10-01T00:00:00.000Z",
    stock: 23,
    reserved: 4,
    warehouse: "Основной склад",
    tags: [],
    country: "Россия",
    compatibleCars: [],
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

test("public product leaves out the 1C identifier and keeps the warehouse", () => {
  for (const displayMode of DISPLAY_MODES) {
    const published = toPublicProduct(product(), displayMode);
    assert.equal("externalId" in published, false);
    assert.equal(JSON.stringify(published).includes("1c-guid-000123"), false);
    assert.equal(published.warehouse, "Основной склад");
    assert.equal(typeof published.stock, "number");
    assert.equal(typeof published.reserved, "number");
  }
  // The source object is not modified.
  const source = product();
  toPublicProduct(source, "limited");
  assert.equal(source.externalId, "1c-guid-000123");
  assert.equal(source.stock, 23);
});

function catalogRow(overrides: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    id: "8a1d8f0c-8a2b-4c1f-9a51-3f7c4b5d6e7f",
    sku: "SKU-1",
    external_id: "1c-guid-000123",
    slug: "test-tire",
    kind: "tire",
    condition: "new",
    brand: "Brand",
    model: "Model",
    name: "Brand Model 205/55 R16",
    description: "Описание",
    width: 205,
    profile: 55,
    diameter: 16,
    season: "summer",
    studded: false,
    runflat: false,
    xl: false,
    wheel_type: null,
    pcd: null,
    offset: null,
    center_bore: null,
    color: null,
    country: "Россия",
    amount_kopecks: 500_000,
    old_amount_kopecks: null,
    discount_percent: null,
    price_updated_at: "2026-10-01T00:00:00.000Z",
    stock: 23,
    reserved: 4,
    warehouse: "Основной склад",
    image: null,
    compatible_cars: [],
    updated_at: "2026-10-01T00:00:00.000Z",
    total_count: 1,
    ...overrides,
  };
}

function catalogService(displayMode: AvailabilityDisplayMode): CatalogService {
  const repository = {
    searchCatalog: async () => [catalogRow()],
    getCatalogFacets: async () => ({ brands: ["Brand"], widths: [205], profiles: [55], diameters: [16] }),
    findPublicBySlug: async () => catalogRow(),
    findPublicByIds: async () => [catalogRow()],
  } as unknown as ProductRepository;
  return new CatalogService({} as Pool, repository, displayMode);
}

const QUERY = { type: "all", sort: "newest", page: 1, pageSize: 24 } as const;

test("catalog service: buyers get public products, staff get stored values", async () => {
  const service = catalogService("limited");
  const page = await service.getCatalogPage({ ...QUERY });
  const details = await service.getProductBySlug("test-tire");
  const cartProducts = await service.getProductsByIds(["8a1d8f0c-8a2b-4c1f-9a51-3f7c4b5d6e7f"]);
  for (const published of [page.items[0], details!, cartProducts[0]]) {
    assert.equal("externalId" in published, false);
    assert.deepEqual([published.stock, published.reserved], [5, 0]);
    assert.equal(published.warehouse, "Основной склад");
  }
  assert.equal(details!.name, "Brand Model 205/55 R16");
  assert.equal(page.pagination.total, 1);

  const adminPage = await service.getAdminCatalogPage({ ...QUERY });
  assert.equal(adminPage.items[0].externalId, "1c-guid-000123");
  assert.deepEqual([adminPage.items[0].stock, adminPage.items[0].reserved], [23, 4]);
});

test("catalog service: exact mode keeps quantities but still hides the 1C identifier", async () => {
  const page = await catalogService("exact").getCatalogPage({ ...QUERY });
  assert.deepEqual([page.items[0].stock, page.items[0].reserved], [23, 4]);
  assert.equal("externalId" in page.items[0], false);
});

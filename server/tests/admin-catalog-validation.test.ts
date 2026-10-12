import assert from "node:assert/strict";
import test from "node:test";
import type { AdminProductCard, AdminProductStockRow } from "../../lib/admin/product-types.js";
import {
  changedCardValues,
  emptyProductForm,
  formatKopecksForInput,
  parseRublesToKopecks,
  productCardFromForm,
  productPriceFromForm,
  productStockFromForm,
} from "../../lib/admin/product-form.js";
import { missingRequiredFields } from "../../lib/admin/product-rules.js";
import {
  ONE_C_OWNED_CARD_FIELDS,
  parseCreateProductInput,
  assertSourceAllowsChanges,
  changedCardFields,
  formatWheelPcd,
  isImageLocked,
  lockedFieldsForSource,
  normalizeCardForKind,
  planStockChanges,
  priceChanged,
  validateCompleteCard,
} from "../services/admin-catalog-rules.js";
import { wheelFitmentIssue } from "../services/admin-catalog-fitment-service.js";
import { brandSlug } from "../services/admin-catalog-reference-service.js";
import {
  addFitmentSchema,
  addImageUrlSchema,
  adminProductListQuerySchema,
  createProductSchema,
  productPriceSchema,
  productStockSchema,
  updateImagesSchema,
  updateProductSchema,
} from "../validators/admin-product-schema.js";

const BRAND_ID = "4b0c7f6e-1d1a-4c55-9d43-6f0f3a2b8c11";
const WAREHOUSE_ID = "8f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";

function tireCard(overrides: Partial<AdminProductCard> = {}): AdminProductCard {
  return {
    kind: "tire", sku: "T21B-TIRE-1", article: null, name: "Шина Nordman 8 205/55 R16", brandId: BRAND_ID,
    model: "Nordman 8", categoryId: null, description: "", country: "Россия", isActive: true, diameter: 16,
    width: 205, profile: 55, season: "winter", studded: true, runflat: false, xl: false, loadIndex: "94",
    speedIndex: "T", wheelWidth: null, boltCount: null, pcd: null, offset: null, centerBore: null,
    wheelType: null, color: null, ...overrides,
  };
}

function wheelCard(overrides: Partial<AdminProductCard> = {}): AdminProductCard {
  return normalizeCardForKind({
    ...tireCard(), kind: "wheel", sku: "T21B-WHEEL-1", name: "Диск", diameter: 18, wheelWidth: 8,
    boltCount: 5, pcd: 112, offset: 35, centerBore: 66.6, wheelType: "alloy", color: "серебристый", ...overrides,
  });
}

test("create schema accepts a complete tire card and refuses unknown or malformed fields", () => {
  const parsed = createProductSchema.parse({ card: tireCard({ article: "  ", country: "" }), price: null });
  assert.equal(parsed.card.article, null, "an empty optional text is stored as NULL");
  assert.equal(parsed.card.country, null);
  assert.throws(() => createProductSchema.parse({ card: { ...tireCard(), extra: 1 } }));
  assert.throws(() => createProductSchema.parse({ card: tireCard({ sku: "   " }) }));
  assert.throws(() => createProductSchema.parse({ card: tireCard({ name: "Шина\u0000" }) }), "control characters are refused");
  assert.throws(() => createProductSchema.parse({ card: tireCard({ width: 205.5 }) }));
  assert.throws(() => createProductSchema.parse({ card: tireCard({ diameter: 41 }) }));
  assert.throws(() => createProductSchema.parse({ card: tireCard({ brandId: "not-a-uuid" }) }));
  assert.doesNotThrow(() => createProductSchema.parse({ card: tireCard({ description: "Строка 1\nСтрока 2\tтаб" }) }));
});

test("the product kind cannot be changed after creation and version is required", () => {
  assert.throws(() => updateProductSchema.parse({ version: "1", card: { kind: "wheel" } }));
  assert.throws(() => updateProductSchema.parse({ card: { name: "Новое" } }));
  assert.throws(() => updateProductSchema.parse({ version: "abc", card: { name: "Новое" } }));
  const patch = updateProductSchema.parse({ version: "1728000000000000", card: { name: "Новое" } });
  assert.deepEqual(Object.keys(patch.card ?? {}), ["name"], "absent fields stay absent (unchanged)");
});

test("price rules: kopecks, greater than zero, old price above the current price", () => {
  assert.deepEqual(productPriceSchema.parse({ amountKopecks: 1_299_000, oldAmountKopecks: 1_499_000 }), {
    amountKopecks: 1_299_000, oldAmountKopecks: 1_499_000,
  });
  assert.throws(() => productPriceSchema.parse({ amountKopecks: 0, oldAmountKopecks: null }), /больше нуля/);
  assert.throws(() => productPriceSchema.parse({ amountKopecks: 100.5, oldAmountKopecks: null }));
  assert.throws(() => productPriceSchema.parse({ amountKopecks: 1000, oldAmountKopecks: 1000 }), /больше текущей/);
  assert.throws(() => productPriceSchema.parse({ amountKopecks: 1000, oldAmountKopecks: 900 }), /больше текущей/);
  assert.throws(() => productPriceSchema.parse({ amountKopecks: 10_000_000_001, oldAmountKopecks: null }));
});

test("stock input: non-negative integers, each warehouse once", () => {
  assert.doesNotThrow(() => productStockSchema.parse([{ warehouseId: WAREHOUSE_ID, quantity: 0 }]));
  assert.throws(() => productStockSchema.parse([{ warehouseId: WAREHOUSE_ID, quantity: -1 }]));
  assert.throws(() => productStockSchema.parse([{ warehouseId: WAREHOUSE_ID, quantity: 1.5 }]));
  assert.throws(() => productStockSchema.parse([
    { warehouseId: WAREHOUSE_ID, quantity: 1 }, { warehouseId: WAREHOUSE_ID, quantity: 2 },
  ]));
});

test("stock below the reserve is refused with a clear Russian message", () => {
  const rows: AdminProductStockRow[] = [
    { warehouseId: WAREHOUSE_ID, warehouseCode: "MAIN", warehouseName: "Основной", quantity: 10, reserved: 4 },
  ];
  assert.deepEqual(planStockChanges(rows, [{ warehouseId: WAREHOUSE_ID, quantity: 4 }]), [
    { warehouseId: WAREHOUSE_ID, warehouseName: "Основной", from: 10, to: 4, reserved: 4 },
  ]);
  assert.deepEqual(planStockChanges(rows, [{ warehouseId: WAREHOUSE_ID, quantity: 10 }]), [], "unchanged rows are skipped");
  assert.throws(
    () => planStockChanges(rows, [{ warehouseId: WAREHOUSE_ID, quantity: 3 }]),
    (error: Error & { code?: string; statusCode?: number }) =>
      error.code === "STOCK_BELOW_RESERVED" && error.statusCode === 422 && /Основной.*резерва \(4 шт\.\)/.test(error.message),
  );
  assert.throws(
    () => planStockChanges(rows, [{ warehouseId: "0f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f", quantity: 3 }]),
    /Склад не найден/,
  );
});

test("kind-specific required fields are checked after merging a change", () => {
  assert.deepEqual(validateCompleteCard(tireCard()), []);
  assert.deepEqual(
    validateCompleteCard(tireCard({ width: null, season: null, brandId: null })).map((issue) => issue.field),
    ["card.brandId", "card.width", "card.season"],
  );
  assert.deepEqual(validateCompleteCard(wheelCard()), []);
  assert.deepEqual(
    validateCompleteCard(wheelCard({ boltCount: null, pcd: null })).map((issue) => issue.field),
    ["card.boltCount", "card.pcd"],
  );
});

test("normalizing a card clears the fields of the other kind", () => {
  const wheel = wheelCard();
  assert.equal(wheel.width, null);
  assert.equal(wheel.season, null);
  assert.equal(wheel.studded, false);
  const tire = normalizeCardForKind(tireCard({ pcd: 112, color: "чёрный" }));
  assert.equal(tire.pcd, null);
  assert.equal(tire.color, null);
  assert.equal(formatWheelPcd(5, 114.3), "5x114.3");
  assert.equal(formatWheelPcd(4, 100), "4x100");
});

test("1C lock: owned fields, price and stock are refused server-side; unchanged saves pass", () => {
  const current = tireCard();
  const renamed = tireCard({ name: "Другое название" });
  assert.deepEqual(changedCardFields(current, renamed), ["name"]);
  assert.throws(
    () => assertSourceAllowsChanges("1c", { cardFields: ["name"], price: false, stock: false }),
    (error: Error & { code?: string; statusCode?: number }) =>
      error.code === "PRODUCT_SOURCE_CONFLICT" && error.statusCode === 409 && /1С/.test(error.message),
  );
  assert.throws(() => assertSourceAllowsChanges("1c", { cardFields: [], price: true, stock: false }), { code: "PRODUCT_SOURCE_CONFLICT" });
  assert.throws(() => assertSourceAllowsChanges("1c", { cardFields: [], price: false, stock: true }), { code: "PRODUCT_SOURCE_CONFLICT" });
  assert.doesNotThrow(() => assertSourceAllowsChanges("1c", { cardFields: [], price: false, stock: false }));
  for (const source of ["manual", "csv"]) {
    assert.doesNotThrow(() => assertSourceAllowsChanges(source, { cardFields: ["name", "isActive"], price: true, stock: true }));
  }
  assert.deepEqual(lockedFieldsForSource("manual"), []);
  const locked = lockedFieldsForSource("1c");
  for (const field of [...ONE_C_OWNED_CARD_FIELDS, "price", "stock"]) assert.ok(locked.includes(field), field);
  assert.ok(ONE_C_OWNED_CARD_FIELDS.includes("description"), "1C writes the description (upsertFromExternalSystem)");
  assert.equal(isImageLocked("1c", "1c"), true, "photos delivered by 1C are replaced by the exchange");
  assert.equal(isImageLocked("1c", "manual"), false, "photos added on the site survive the exchange");
  assert.equal(isImageLocked("csv", "csv"), false);
});

test("price change detection compares kopecks and the old price", () => {
  assert.equal(priceChanged(null, undefined), false);
  assert.equal(priceChanged(null, { amountKopecks: 100, oldAmountKopecks: null }), true);
  assert.equal(priceChanged({ amountKopecks: 100, oldAmountKopecks: null }, { amountKopecks: 100, oldAmountKopecks: null }), false);
  assert.equal(priceChanged({ amountKopecks: 100, oldAmountKopecks: null }, { amountKopecks: 100, oldAmountKopecks: 200 }), true);
});

test("editor form: rubles are converted to kopecks without floating-point errors", () => {
  assert.equal(parseRublesToKopecks("12 990"), 1_299_000);
  assert.equal(parseRublesToKopecks("12 990,5"), 1_299_050);
  assert.equal(parseRublesToKopecks("0,29"), 29);
  assert.equal(parseRublesToKopecks("1234.56 ₽"), 123_456);
  assert.equal(parseRublesToKopecks(""), null);
  for (const invalid of ["12,345", "-5", "abc", "1e5", "12..5"]) assert.equal(parseRublesToKopecks(invalid), "invalid", invalid);
  assert.equal(formatKopecksForInput(1_299_050), "12990,50");
  assert.equal(formatKopecksForInput(1_299_000), "12990");
  const onlyOld = productPriceFromForm({ ...emptyProductForm(), oldPrice: "15 000" });
  assert.equal(onlyOld.errors[0]?.field, "price.amountKopecks");
  assert.deepEqual(productPriceFromForm({ ...emptyProductForm(), price: "100", oldPrice: "" }).price, { amountKopecks: 10_000, oldAmountKopecks: null });
});

test("editor form: numbers with a comma, invalid numbers reported, only changes sent", () => {
  const state = { ...emptyProductForm("wheel"), sku: " W-1 ", name: "Диск", model: "M", brandId: BRAND_ID, diameter: "18", wheelWidth: "7,5", boltCount: "5", pcd: "114,3", centerBore: "abc" };
  const { card, errors } = productCardFromForm(state);
  assert.equal(card.sku, "W-1");
  assert.equal(card.wheelWidth, 7.5);
  assert.equal(card.pcd, 114.3);
  assert.equal(card.width, null, "tire fields are not sent for a wheel");
  assert.deepEqual(errors.map((error) => error.field), ["card.centerBore"]);
  assert.deepEqual(changedCardValues(tireCard(), tireCard({ name: "Новое", isActive: false })), { name: "Новое", isActive: false });
  const stock = productStockFromForm({ ...emptyProductForm(), stock: { [WAREHOUSE_ID]: "-2" } }, [{ warehouseId: WAREHOUSE_ID }]);
  assert.equal(stock.errors.length, 1);
});

test("photo links: only https without credentials; alt length and duplicates checked", () => {
  assert.equal(addImageUrlSchema.parse({ url: "https://cdn.example/a.jpg" }).alt, "");
  for (const url of ["http://cdn.example/a.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA", "//evil.example/a.jpg", "/uploads/products/x.jpg", "https://user:pass@cdn.example/a.jpg"]) {
    assert.throws(() => addImageUrlSchema.parse({ url }), url);
  }
  assert.throws(() => addImageUrlSchema.parse({ url: "https://cdn.example/a.jpg", alt: "a".repeat(301) }));
  const id = "2b0c7f6e-1d1a-4c55-9d43-6f0f3a2b8c11";
  assert.throws(() => updateImagesSchema.parse({ images: [{ id, alt: "" }, { id, alt: "x" }] }));
});

test("fitment input and wheel range checks", () => {
  const generationId = "3b0c7f6e-1d1a-4c55-9d43-6f0f3a2b8c11";
  assert.deepEqual(addFitmentSchema.parse({ generationId }), {
    generationId, modificationId: null, axle: "all", fitmentType: "factory", etMin: null, etMax: null, dia: null,
  });
  assert.throws(() => addFitmentSchema.parse({ generationId, etMin: 40, etMax: 30 }));
  const wheel = { kind: "wheel" as const, diameter: 18, width: 8, boltCount: 5, pcd: 112, et: 35, dia: 66.6 };
  assert.equal(wheelFitmentIssue(wheel, { etMin: 30, etMax: 45, dia: 57.1 }), null);
  assert.match(wheelFitmentIssue(wheel, { etMin: 40, etMax: null, dia: null }) ?? "", /меньше «ET от»/);
  assert.match(wheelFitmentIssue(wheel, { etMin: null, etMax: 30, dia: null }) ?? "", /больше «ET до»/);
  assert.match(wheelFitmentIssue(wheel, { etMin: null, etMax: null, dia: 70 }) ?? "", /DIA/);
  assert.match(wheelFitmentIssue({ ...wheel, et: null }, { etMin: 30, etMax: null, dia: null }) ?? "", /не указан вылет/);
  assert.equal(wheelFitmentIssue({ kind: "tire", width: 205, profile: 55, diameter: 16 }, { etMin: 1, etMax: 2, dia: 50 }), null);
});

test("admin list query: bounded page size, defaults to active products", () => {
  assert.deepEqual(adminProductListQuerySchema.parse({}), { type: "all", active: "true", page: 1, pageSize: 24 });
  assert.equal(adminProductListQuerySchema.parse({ pageSize: "100", active: "all" }).pageSize, 100);
  assert.throws(() => adminProductListQuerySchema.parse({ pageSize: "101" }));
  assert.throws(() => adminProductListQuerySchema.parse({ page: "0" }));
  assert.throws(() => adminProductListQuerySchema.parse({ search: "x".repeat(121) }));
});

test("brand slug matches the 1C/CSV import formula, so imports reuse admin-created brands", () => {
  assert.match(brandSlug("Nordman"), /^brand-[0-9a-f]{16}$/);
  assert.equal(brandSlug("NORDMAN"), brandSlug("nordman"));
});

test("QA-30: every missing required field is reported in one answer (schema issues merged with completeness)", () => {
  const raw = {
    card: tireCard({ sku: "", name: " ", model: "", brandId: null, diameter: null, width: null, profile: null, season: null }),
    price: { amountKopecks: 0, oldAmountKopecks: null },
  };
  assert.throws(() => parseCreateProductInput(raw), (error: Error & { code?: string; statusCode?: number; details?: Array<{ field: string }> }) => {
    const fields = new Set(error.details?.map((detail) => detail.field));
    for (const field of ["card.sku", "card.name", "card.model", "card.brandId", "card.diameter", "card.width", "card.profile", "card.season", "price.amountKopecks"]) {
      assert.ok(fields.has(field), field);
    }
    assert.equal(error.details?.length, fields.size, "each field once");
    return error.code === "VALIDATION_ERROR" && error.statusCode === 422;
  });
  const wheel = { card: { ...wheelCard({ wheelWidth: null, boltCount: null, pcd: null }), sku: "W", name: "Диск", diameter: "R18" } };
  assert.throws(() => parseCreateProductInput(wheel), (error: Error & { details?: Array<{ field: string }> }) => {
    const fields = error.details?.map((detail) => detail.field).sort();
    assert.deepEqual(fields, ["card.boltCount", "card.diameter", "card.pcd", "card.wheelWidth"].sort());
    return true;
  });
  // A card that passes the schema still gets all completeness issues together.
  assert.throws(() => parseCreateProductInput({ card: tireCard({ brandId: null, width: null, season: null }) }), (error: Error & { details?: Array<{ field: string }> }) => {
    assert.deepEqual(error.details?.map((detail) => detail.field), ["card.brandId", "card.width", "card.season"]);
    return true;
  });
  assert.equal(parseCreateProductInput({ card: tireCard() }).card.sku, "T21B-TIRE-1");
});

test("QA-30: the editor checks the same required fields before sending", () => {
  assert.deepEqual(missingRequiredFields(emptyProductForm("tire") as unknown as Record<string, unknown>, "tire").map((item) => item.field), [
    "sku", "name", "brandId", "model", "diameter", "width", "profile", "season",
  ]);
  assert.deepEqual(missingRequiredFields(emptyProductForm("wheel") as unknown as Record<string, unknown>, "wheel").map((item) => item.field), [
    "sku", "name", "brandId", "model", "diameter", "wheelWidth", "boltCount", "pcd",
  ]);
  const filled = { ...emptyProductForm("tire"), sku: "S", name: "N", brandId: BRAND_ID, model: "M", diameter: "16", width: "205", profile: "55", season: "winter" as const };
  assert.deepEqual(missingRequiredFields(filled as unknown as Record<string, unknown>, "tire"), []);
  assert.deepEqual(validateCompleteCard(tireCard({ sku: "" })).map((issue) => issue.field), ["card.sku"]);
});

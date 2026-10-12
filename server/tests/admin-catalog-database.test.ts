import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import type { AdminProductCard } from "../../lib/admin/product-types.js";
import { ProductRepository } from "../repositories/product-repository.js";
import { buildAdminCatalogServices } from "../services/admin-catalog-services.js";
import { LocalImageStorage } from "../storage/local-image-storage.js";
import {
  adminProductListQuerySchema,
  createProductSchema,
  updateProductSchema,
} from "../validators/admin-product-schema.js";
import { catalogQuerySchema } from "../validators/catalog-query-schema.js";
import { productSchema } from "../validators/one-c-schemas.js";

// Runs when TEST_DATABASE_URL points to a disposable database with all
// migrations; skipped otherwise. Works under the application role (no DDL).
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]);

function card(overrides: Partial<AdminProductCard>): AdminProductCard {
  return {
    kind: "tire", sku: "", article: null, name: "Шина", brandId: null, model: "Nordman 8", categoryId: null,
    description: "Описание", country: "Россия", isActive: true, diameter: 16, width: 205, profile: 55,
    season: "winter", studded: true, runflat: false, xl: false, loadIndex: "94", speedIndex: "T",
    wheelWidth: null, boltCount: null, pcd: null, offset: null, centerBore: null, wheelType: null, color: null,
    ...overrides,
  };
}

test("PostgreSQL: admin catalog create/edit, price and stock rules, 1C lock, photos and fitments", {
  skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not set",
}, async () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
  pool.on("error", () => {});
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  const uploadsDirectory = await mkdtemp(path.join(tmpdir(), "t21b-db-uploads-"));
  const uploadEnvironment = () => ({ uploadsDirectory, productImageMaxBytes: 1_000_000, productImageMaxCount: 3, problem: null });
  const services = buildAdminCatalogServices({ pool, uploadEnvironment });
  const storage = new LocalImageStorage(uploadsDirectory);
  const catalog = new ProductRepository();
  const productIds: string[] = [];
  const cleanup: { actorId?: string; warehouseId?: string; brandIds: string[]; categoryId?: string; makeId?: string } = { brandIds: [] };
  const environment = process.env as Record<string, string | undefined>;
  const previousUploads = environment.UPLOADS_DIR;
  try {
    const actor = await pool.query<{ id: string }>(
      "INSERT INTO users (email, name, role) VALUES ($1, 'T21b manager', 'manager') RETURNING id",
      [`t21b-${suffix.toLowerCase()}@example.invalid`],
    );
    const actorId = actor.rows[0].id;
    cleanup.actorId = actorId;

    // Brands and categories: create, reuse by name.
    const brand = await services.references.createBrand(actorId, `T21B Brand ${suffix}`);
    assert.equal(brand.created, true);
    cleanup.brandIds.push(brand.brand.id);
    const sameBrand = await services.references.createBrand(actorId, `t21b brand ${suffix.toLowerCase()}`);
    assert.deepEqual([sameBrand.created, sameBrand.brand.id], [false, brand.brand.id]);
    const category = await services.references.createCategory(actorId, { name: `T21B Шины ${suffix}`, parentId: null });
    assert.equal(category.created, true);
    cleanup.categoryId = category.category.id;
    assert.equal((await services.references.createCategory(actorId, { name: `t21b шины ${suffix}`, parentId: null })).created, false);
    const warehouse = await pool.query<{ id: string }>(
      "INSERT INTO warehouses (code, name) VALUES ($1, 'Склад T21B') RETURNING id",
      [`T21B-${suffix}`],
    );
    const warehouseId = warehouse.rows[0].id;
    cleanup.warehouseId = warehouseId;
    assert.ok((await services.references.listWarehouses()).some((item) => item.id === warehouseId));

    // Create a tire with price and stock: the storefront sees it at once.
    const tireSku = `T21B-${suffix}-TIRE`;
    const tire = await services.products.create(actorId, createProductSchema.parse({
      card: card({ sku: tireSku, name: `Шина T21B ${suffix} 205/55 R16`, brandId: brand.brand.id, categoryId: category.category.id }),
      price: { amountKopecks: 1_299_000, oldAmountKopecks: 1_499_000 },
      stock: [{ warehouseId, quantity: 8 }],
    }));
    productIds.push(tire.id);
    assert.match(tire.slug, /^шина-t21b-/);
    const publicTire = await catalog.findPublicBySlug(pool, tire.slug);
    assert.equal(Number(publicTire?.amount_kopecks), 1_299_000);
    assert.equal(Number(publicTire?.old_amount_kopecks), 1_499_000);
    assert.equal(publicTire?.stock, 8);
    assert.equal(publicTire?.width, 205);
    assert.equal(publicTire?.brand, `T21B Brand ${suffix}`);
    const filtered = await catalog.searchCatalog(pool, catalogQuerySchema.parse({
      type: "tire", width: "205", profile: "55", diameter: "16", season: "winter", studded: "true", search: tireSku,
    }));
    assert.deepEqual(filtered.map((row) => row.id), [tire.id], "tire_specs are filled for the catalog filters");

    // Duplicate SKU (any case) is refused; a product without price is listed in the admin only.
    await assert.rejects(services.products.create(actorId, createProductSchema.parse({
      card: card({ sku: tireSku.toLowerCase(), name: "Дубль", brandId: brand.brand.id }),
    })), { code: "SKU_CONFLICT", statusCode: 409 });
    const wheel = await services.products.create(actorId, createProductSchema.parse({
      card: card({
        kind: "wheel", sku: `T21B-${suffix}-WHEEL`, name: "Диск T21B", brandId: brand.brand.id, diameter: 18,
        width: null, profile: null, season: null, studded: false, loadIndex: null, speedIndex: null,
        wheelWidth: 8, boltCount: 5, pcd: 112, offset: 35, centerBore: 66.6, wheelType: "alloy", color: "серебристый",
      }),
    }));
    productIds.push(wheel.id);
    const listed = await services.products.list(adminProductListQuerySchema.parse({ search: `t21b-${suffix.toLowerCase()}`, active: "all" }));
    assert.deepEqual(new Set(listed.items.map((item) => item.id)), new Set([tire.id, wheel.id]));
    assert.equal(listed.items.find((item) => item.id === wheel.id)?.priceKopecks, null);
    assert.equal(listed.items.find((item) => item.id === wheel.id)?.subtitle, "R18 5x112");
    assert.equal((await catalog.findPublicByIds(pool, [wheel.id])).length, 0, "no price — not on the storefront");
    const wheelEditor = await services.products.getEditorData(wheel.id);
    assert.deepEqual([wheelEditor?.card.wheelWidth, wheelEditor?.card.pcd, wheelEditor?.card.centerBore], [8, 112, 66.6]);

    // Edit: optimistic concurrency, price, stock, audit.
    const editor = await services.products.getEditorData(tire.id);
    assert.ok(editor);
    assert.deepEqual(editor.lockedFields, []);
    assert.deepEqual(editor.stock.find((row) => row.warehouseId === warehouseId), {
      warehouseId, warehouseCode: `T21B-${suffix}`, warehouseName: "Склад T21B", quantity: 8, reserved: 0,
    });
    await assert.rejects(services.products.update(actorId, tire.id, updateProductSchema.parse({
      version: "1", card: { name: "Устаревшая форма" },
    })), { code: "PRODUCT_VERSION_CONFLICT", statusCode: 409 });
    const updated = await services.products.update(actorId, tire.id, updateProductSchema.parse({
      version: editor.version,
      card: { name: `Шина T21B ${suffix} новая`, xl: true },
      price: { amountKopecks: 1_199_000, oldAmountKopecks: null },
      stock: [{ warehouseId, quantity: 5 }],
    }));
    assert.equal(updated.changed, true);
    assert.notEqual(updated.version, editor.version);
    assert.equal(updated.slug, tire.slug, "the slug stays stable");
    await assert.rejects(services.products.update(actorId, tire.id, updateProductSchema.parse({
      version: editor.version, card: { name: "Поверх чужих правок" },
    })), { code: "PRODUCT_VERSION_CONFLICT" });
    const unchanged = await services.products.update(actorId, tire.id, updateProductSchema.parse({
      version: updated.version, card: { xl: true }, price: { amountKopecks: 1_199_000, oldAmountKopecks: null },
    }));
    assert.deepEqual([unchanged.changed, unchanged.version], [false, updated.version]);
    const afterEdit = await catalog.findPublicBySlug(pool, tire.slug);
    assert.deepEqual([afterEdit?.name, Number(afterEdit?.amount_kopecks), afterEdit?.old_amount_kopecks, afterEdit?.stock, afterEdit?.xl],
      [`Шина T21B ${suffix} новая`, 1_199_000, null, 5, true]);

    // A failing save changes nothing (one transaction).
    await assert.rejects(services.products.update(actorId, tire.id, updateProductSchema.parse({
      version: updated.version, card: { name: "Не сохранится", brandId: "00000000-0000-4000-8000-000000000000" },
    })), { code: "BRAND_UNAVAILABLE" });
    assert.equal((await services.products.getEditorData(tire.id))?.card.name, `Шина T21B ${suffix} новая`);

    // Stock never below the reserve.
    await pool.query("UPDATE inventories SET reserved = 3 WHERE product_id = $1 AND warehouse_id = $2", [tire.id, warehouseId]);
    await assert.rejects(services.products.update(actorId, tire.id, updateProductSchema.parse({
      version: updated.version, stock: [{ warehouseId, quantity: 2 }],
    })), (error: Error & { code?: string }) => error.code === "STOCK_BELOW_RESERVED" && /резерва \(3 шт\.\)/.test(error.message));
    const reserveOk = await services.products.update(actorId, tire.id, updateProductSchema.parse({
      version: updated.version, stock: [{ warehouseId, quantity: 3 }],
    }));
    assert.equal(reserveOk.changed, true);
    const audit = await pool.query<{ action: string; details: { changedFields?: string[] } }>(
      "SELECT action, details FROM admin_audit_log WHERE entity_id = $1 ORDER BY created_at, id",
      [tire.id],
    );
    assert.deepEqual(audit.rows.map((row) => row.action), ["catalog.product.created", "catalog.product.updated", "catalog.product.updated"]);
    assert.deepEqual(audit.rows[1].details.changedFields, ["name", "xl"]);

    // 1C product: owned fields, price and stock are closed; site photos are allowed.
    const oneCSku = `T21B-${suffix}-1C`;
    const oneCId = await catalog.upsertFromExternalSystem(pool, productSchema.parse({
      externalId: `T21B-1C-${suffix}`, sku: oneCSku, name: "Шина из 1С", brand: `T21B Brand ${suffix}`, model: "Hakka",
      kind: "tire", width: 205, profile: 55, diameter: 16, season: "summer",
      images: [{ url: "https://cdn.example/1c.jpg", alt: "1С", position: 0 }],
    }), "1c");
    productIds.push(oneCId);
    const oneC = await services.products.getEditorData(oneCId);
    assert.ok(oneC);
    assert.ok(oneC.lockedFields.includes("name") && oneC.lockedFields.includes("price") && oneC.lockedFields.includes("stock"));
    await assert.rejects(services.products.update(actorId, oneCId, updateProductSchema.parse({
      version: oneC.version, card: { name: "Правка в обход 1С" },
    })), { code: "PRODUCT_SOURCE_CONFLICT", statusCode: 409 });
    await assert.rejects(services.products.update(actorId, oneCId, updateProductSchema.parse({
      version: oneC.version, price: { amountKopecks: 100, oldAmountKopecks: null },
    })), { code: "PRODUCT_SOURCE_CONFLICT" });
    await assert.rejects(services.products.update(actorId, oneCId, updateProductSchema.parse({
      version: oneC.version, stock: [{ warehouseId, quantity: 1 }],
    })), { code: "PRODUCT_SOURCE_CONFLICT" });
    assert.equal((await services.products.update(actorId, oneCId, updateProductSchema.parse({
      version: oneC.version, card: { name: "Шина из 1С" },
    }))).changed, false, "repeating 1C values is not a change");
    const oneCImage = oneC.images[0];
    assert.equal(oneCImage.locked, true);
    await assert.rejects(services.images.deleteImage(actorId, oneCId, oneCImage.id), { code: "PRODUCT_SOURCE_CONFLICT" });
    const oneCPhotos = await services.images.addImageByUrl(actorId, oneCId, { url: "https://cdn.example/site.jpg", alt: "Сайт" });
    assert.deepEqual(oneCPhotos.images.map((image) => [image.source, image.position >= 1000]), [["1c", false], ["manual", true]]);
    await catalog.upsertFromExternalSystem(pool, productSchema.parse({
      externalId: `T21B-1C-${suffix}`, sku: oneCSku, name: "Шина из 1С", brand: `T21B Brand ${suffix}`, model: "Hakka",
      kind: "tire", width: 205, profile: 55, diameter: 16, season: "summer", images: [],
    }), "1c");
    assert.deepEqual((await services.products.getEditorData(oneCId))?.images.map((image) => image.source), ["manual"],
      "the next exchange keeps photos added on the site");

    // Photos: upload, limit, order, delete with the file.
    const first = await services.images.addUploadedImage(actorId, tire.id, { bytes: PNG, type: "png", alt: "Фото 1" }, storage, 3);
    const uploaded = first.images[0];
    assert.equal(uploaded.stored, true);
    assert.match(uploaded.url, new RegExp(`^/uploads/products/${tire.id}/[0-9a-f]{32}\\.png$`));
    assert.equal((await catalog.findPublicBySlug(pool, tire.slug))?.image, uploaded.url, "the storefront shows the uploaded photo");
    environment.UPLOADS_DIR = uploadsDirectory;
    const { GET } = await import("../../app/uploads/[...path]/route.js");
    const segments = uploaded.url.replace("/uploads/", "").split("/");
    const served = await GET(new Request(`https://store.example${uploaded.url}`), { params: Promise.resolve({ path: segments }) });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    await services.images.addUploadedImage(actorId, tire.id, { bytes: JPEG, type: "jpeg", alt: "" }, storage, 3);
    const third = await services.images.addImageByUrl(actorId, tire.id, { url: "https://cdn.example/t21b.jpg", alt: "Ссылка" });
    assert.equal(third.images.length, 3);
    await assert.rejects(
      services.images.addUploadedImage(actorId, tire.id, { bytes: PNG, type: "png", alt: "" }, storage, 3),
      { code: "IMAGE_LIMIT_REACHED", statusCode: 409 },
    );
    assert.equal((await readdir(path.join(uploadsDirectory, "products", tire.id))).length, 2, "no file is left by a refused upload");
    const reversed = [...third.images].reverse().map((image, index) => ({ id: image.id, alt: `Подпись ${index}` }));
    const reordered = await services.images.updateImages(actorId, tire.id, { images: reversed });
    assert.deepEqual(reordered.images.map((image) => image.id), reversed.map((image) => image.id));
    assert.equal((await catalog.findPublicBySlug(pool, tire.slug))?.image, "https://cdn.example/t21b.jpg", "the first photo is the main one");
    await assert.rejects(services.images.updateImages(actorId, tire.id, { images: reversed.slice(1) }), { code: "IMAGE_LIST_CHANGED" });
    const afterDelete = await services.images.deleteImage(actorId, tire.id, uploaded.id);
    assert.equal(afterDelete.images.length, 2);
    assert.equal(await storage.read(uploaded.url.replace("/uploads/", "")), null, "the stored file is deleted with the record");
    assert.equal((await readdir(path.join(uploadsDirectory, "products", tire.id))).length, 1);

    // Fitments: by size, used by the storefront vehicle filter.
    const make = await pool.query<{ id: string }>("INSERT INTO car_makes (name, slug) VALUES ($1, $2) RETURNING id", [`T21B Make ${suffix}`, `t21b-make-${suffix.toLowerCase()}`]);
    cleanup.makeId = make.rows[0].id;
    const model = await pool.query<{ id: string }>("INSERT INTO car_models (make_id, name, slug) VALUES ($1, 'Model', 'model') RETURNING id", [make.rows[0].id]);
    const generation = await pool.query<{ id: string }>(
      "INSERT INTO car_generations (model_id, name, slug, year_from, year_to) VALUES ($1, 'I', 'i', 2018, 2024) RETURNING id",
      [model.rows[0].id],
    );
    const generationId = generation.rows[0].id;
    const references = await services.fitments.listVehicleReferences({ level: "generations", parentId: model.rows[0].id });
    assert.deepEqual(references, [{ id: generationId, name: "I", yearFrom: 2018, yearTo: 2024 }]);
    const vehicleQuery = catalogQuerySchema.parse({
      type: "tire", search: tireSku, vehicleMake: `T21B Make ${suffix}`, vehicleModel: "Model", vehicleGeneration: "I",
    });
    assert.equal((await catalog.searchCatalog(pool, vehicleQuery)).length, 0);
    const before = await services.fitments.list(tire.id);
    assert.deepEqual([before?.size, before?.items.length], ["205/55 R16", 0]);
    assert.ok((before?.sameSizeProducts ?? 0) >= 1, "the 1C tire has the same size");
    const added = await services.fitments.add(actorId, tire.id, { generationId, modificationId: null, axle: "all", fitmentType: "factory", etMin: null, etMax: null, dia: null });
    assert.equal(added.created, true);
    assert.deepEqual((await catalog.searchCatalog(pool, vehicleQuery)).map((row) => row.id), [tire.id]);
    assert.equal((await services.fitments.add(actorId, tire.id, { generationId, modificationId: null, axle: "all", fitmentType: "factory", etMin: null, etMax: null, dia: null })).created, false);
    const withFitment = await services.fitments.list(tire.id);
    assert.deepEqual(withFitment?.items.map((item) => [item.make, item.generation, item.source]), [[`T21B Make ${suffix}`, "I", "manual"]]);
    await services.fitments.revoke(actorId, tire.id, added.fitmentId);
    assert.equal((await catalog.searchCatalog(pool, vehicleQuery)).length, 0, "a revoked fitment no longer applies");
    assert.equal((await services.fitments.list(tire.id))?.items.length, 0);
    await assert.rejects(services.fitments.revoke(actorId, tire.id, added.fitmentId), { code: "FITMENT_NOT_FOUND" });
    await assert.rejects(services.fitments.revoke(actorId, wheel.id, added.fitmentId), { code: "FITMENT_NOT_FOUND" }, "only fitments of this product's size");
    await assert.rejects(
      services.fitments.add(actorId, wheel.id, { generationId, modificationId: null, axle: "all", fitmentType: "factory", etMin: 40, etMax: 50, dia: null }),
      { code: "FITMENT_DOES_NOT_MATCH" },
    );
    const wheelFitment = await services.fitments.add(actorId, wheel.id, { generationId, modificationId: null, axle: "all", fitmentType: "factory", etMin: 30, etMax: 40, dia: 57.1 });
    assert.equal((await services.fitments.list(wheel.id))?.items[0]?.id, wheelFitment.fitmentId);
    const fitmentAudit = await pool.query<{ action: string }>(
      "SELECT action FROM admin_audit_log WHERE actor_user_id = $1 AND entity_type = 'fitments' ORDER BY created_at, id",
      [actorId],
    );
    assert.deepEqual(fitmentAudit.rows.map((row) => row.action), ["catalog.fitment.added", "catalog.fitment.added", "catalog.fitment.revoked", "catalog.fitment.added"]);
  } finally {
    if (previousUploads === undefined) delete environment.UPLOADS_DIR;
    else environment.UPLOADS_DIR = previousUploads;
    // Test data of a disposable database only.
    if (cleanup.makeId) await pool.query("DELETE FROM car_makes WHERE id = $1", [cleanup.makeId]);
    if (productIds.length) await pool.query("DELETE FROM products WHERE id = ANY($1::uuid[])", [productIds]);
    if (cleanup.warehouseId) await pool.query("DELETE FROM warehouses WHERE id = $1", [cleanup.warehouseId]);
    if (cleanup.brandIds.length) await pool.query("DELETE FROM brands WHERE id = ANY($1::uuid[])", [cleanup.brandIds]);
    if (cleanup.categoryId) await pool.query("DELETE FROM categories WHERE id = $1", [cleanup.categoryId]);
    if (cleanup.actorId) {
      await pool.query("DELETE FROM admin_audit_log WHERE actor_user_id = $1", [cleanup.actorId]);
      await pool.query("DELETE FROM users WHERE id = $1", [cleanup.actorId]);
    }
    await pool.end();
    await rm(uploadsDirectory, { recursive: true, force: true });
  }
});

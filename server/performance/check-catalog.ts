import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { ProductRepository } from "../repositories/product-repository";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import { CatalogImportService } from "../services/catalog-import-service";
import { CatalogService } from "../services/catalog-service";
import { CartService } from "../services/cart-service";
import { CartRepository } from "../repositories/cart-repository";
import { OrderService } from "../services/order-service";
import { OrderRepository } from "../repositories/order-repository";
import { FitmentRepository } from "../repositories/fitment-repository";
import { catalogQuerySchema } from "../validators/catalog-query-schema";
import type { CreateOrderInput } from "../validators/order-schemas";
import { releaseExpiredReservations } from "../services/reservation-cleanup-service";
import { stockSchema } from "../validators/one-c-schemas";
import { withTransaction } from "../database/postgres-client";

const connectionString = process.env.PERFORMANCE_DATABASE_URL;
if (!connectionString || process.env.NODE_ENV === "production") throw new Error("Set PERFORMANCE_DATABASE_URL to an empty test-only database.");
const destination = new URL(connectionString);
if (!destination.pathname.startsWith("/apex_perf_")) throw new Error("Test database name must start with apex_perf_.");
const pool = new pg.Pool({ connectionString, max: 5 });
const productCount = Number(process.env.PERFORMANCE_PRODUCT_COUNT || 50_000);
if (!Number.isInteger(productCount) || productCount < 100 || productCount > 300_000) throw new Error("Invalid test product count");
const measurements: Record<string, number> = {};
async function measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await operation();
  measurements[name] = Math.round((performance.now() - start) * 100) / 100;
  process.stdout.write(`${name}: ${measurements[name]} ms\n`);
  return result;
}

function productCsv(count: number, price = 5000): ReadableStream<Uint8Array> {
  let index = 0;
  const encoder = new TextEncoder();
  return new ReadableStream({
    pull(controller) {
      if (index === 0) controller.enqueue(encoder.encode("external_id,sku,article,kind,brand,model,name,width,profile,diameter,season,wheel_width,bolt_count,pcd_number,offset,center_bore,price,stock,warehouse_code,warehouse_name,is_active\n"));
      const rows: string[] = [];
      const end = Math.min(count, index + 500);
      while (index < end) {
        index += 1;
        const wheel = index % 2 === 0;
        rows.push([`PERF-${index}`, `PERF-SKU-${index}`, `ART-${index}`, wheel ? "wheel" : "tire",
          `TestBrand${index % 20}`, `TestModel${index % 200}`, `TEST ONLY product ${index}`,
          wheel ? 0 : 225, wheel ? 0 : 45, 18, wheel ? "none" : "winter",
          wheel ? 7.5 : "", wheel ? 5 : "", wheel ? 112 : "", wheel ? 35 : "", wheel ? 66.6 : "",
          price + index, index % 10 === 0 ? 0 : 8, "PERF-WH", "TEST ONLY warehouse", index % 50 !== 0].join(","));
      }
      controller.enqueue(encoder.encode(rows.join("\n") + "\n"));
      if (index === count) controller.close();
    },
  });
}

async function main() {
  const existing = await pool.query("SELECT to_regclass('public.products') AS products");
  assert.equal(existing.rows[0].products, null, "The performance database must be empty; no existing data is overwritten.");
  for (const filename of (await readdir("server/database/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    await pool.query(await readFile(`server/database/migrations/${filename}`, "utf8"));
    process.stdout.write(`Migration passed: ${filename}\n`);
  }
  const repository = new ProductRepository();
  const importer = new CatalogImportService(pool, repository, new AdminAuditRepository());
  const catalog = new CatalogService(pool, repository);
  const report = await measure("import_new", () => importer.importProductsCsvStream(productCsv(productCount), "test-only-products.csv"));
  assert.equal(report.failed, 0, JSON.stringify(report.errors));
  assert.equal(report.created, productCount);
  const repeat = await measure("import_repeated", () => importer.importProductsCsvStream(productCsv(100, 6000), "test-only-update.csv"));
  assert.equal(repeat.failed, 0, JSON.stringify(repeat.errors));
  assert.equal(repeat.created, 0);
  assert.equal(repeat.updated, 100);
  const count = await pool.query("SELECT COUNT(*)::integer AS count FROM products");
  assert.equal(count.rows[0].count, productCount);
  const partialCsv = "external_id,sku,kind,brand,model,name,width,profile,diameter,season,price\nPERF-1,PERF-SKU-1,tire,TestBrand1,TestModel1,TEST ONLY product 1,225,45,18,winter,6001\nINVALID,INVALID,tire,Test,Test,Invalid price,225,45,18,winter,-1\nDUPLICATE,PERF-SKU-1,tire,Test,Test,Duplicate SKU,225,45,18,winter,6001";
  const partial = await importer.importProductsCsvStream(new Blob([partialCsv]).stream(), "partial-test.csv");
  assert.equal(partial.updated, 1);
  assert.equal(partial.failed, 2);
  assert.equal(partial.created, 0);
  assert.equal((await pool.query("SELECT COUNT(*)::integer AS count FROM import_job_errors WHERE job_id=$1", [partial.jobId])).rows[0].count, 2);
  await pool.query("ANALYZE");
  const page = (input: Record<string, unknown>) => catalog.getCatalogPage(catalogQuerySchema.parse(input));
  const tires = await measure("catalog_tire_filters", () => page({ type: "tire", width: 225, profile: 45, diameter: 18, season: "winter", inStock: "true", sort: "price_asc" }));
  assert.equal(tires.items.length, 24);
  assert(tires.items.every((item) => item.kind === "tire" && item.width === 225 && item.stock > item.reserved));
  assert(tires.items.every((item, index) => index === 0 || item.price >= tires.items[index - 1].price));
  const wheels = await measure("catalog_wheel_filters", () => page({ type: "wheel", width: 7.5, boltCount: 5, pcd: 112, diameter: 18 }));
  assert.equal(wheels.items.length, 24);
  assert(wheels.items.every((item) => item.kind === "wheel"));
  await measure("catalog_deep_page", () => page({ page: Math.floor(productCount / 48), sort: "price_desc" }));
  const search = await measure("catalog_search", () => page({ search: "PERF-SKU-1" }));
  assert.equal(search.items.length, 1);
  const product = search.items[0];
  assert.equal(product.price, 6001);
  assert.equal((await page({ search: "PERF-SKU-50" })).items.length, 0);
  assert.equal((await page({ search: "PERF-SKU-10", inStock: "true" })).items.length, 0);
  assert.equal((await page({ search: "PERF-SKU-50", active: "false" })).items.length, 1);
  assert.equal((await measure("product_details", () => catalog.getProductBySlug(product.slug!)))?.id, product.id);

  const fitmentCsv = "make,model,generation,product_type,tire_width,tire_profile,tire_diameter,wheel_diameter,wheel_width,bolt_count,pcd,dia,et_min,et_max,verified\nTEST MAKE,TEST MODEL,TEST GENERATION,tire,225,45,18,,,,,,,,true\nTEST MAKE,TEST MODEL,TEST GENERATION,wheel,,,,18,7.5,5,112,66.6,30,40,true";
  const fitments = await importer.importFitmentsCsvStream(new Blob([fitmentCsv]).stream(), "test-only-fitments.csv");
  assert.equal(fitments.failed, 0, JSON.stringify(fitments.errors));
  assert.equal((await importer.importFitmentsCsvStream(new Blob([fitmentCsv]).stream(), "repeat.csv")).updated, 2);
  const fitmentRepository = new FitmentRepository();
  assert.deepEqual(await fitmentRepository.listMakes(pool), ["TEST MAKE"]);
  assert.deepEqual(await fitmentRepository.listModels(pool, "TEST MAKE"), ["TEST MODEL"]);
  assert.deepEqual(await fitmentRepository.listGenerations(pool, { make: "TEST MAKE", model: "TEST MODEL" }), ["TEST GENERATION"]);
  for (const type of ["tire", "wheel"]) {
    const matched = await measure(`fitment_${type}`, () => page({ type, vehicleMake: "TEST MAKE", vehicleModel: "TEST MODEL", vehicleGeneration: "TEST GENERATION" }));
    assert.equal(matched.items.length, 24);
  }
  assert.equal((await page({ vehicleMake: "UNKNOWN", vehicleModel: "UNKNOWN", vehicleGeneration: "UNKNOWN" })).items.length, 0);

  const cart = new CartService(pool, new CartRepository());
  const guestHash = randomUUID();
  await cart.replaceAnonymousCart(guestHash, [{ productId: product.id, quantity: 2 }]);
  assert.equal((await cart.getAnonymousCart(guestHash))[0].quantity, 2);
  await assert.rejects(() => cart.replaceAnonymousCart(guestHash, [{ productId: randomUUID(), quantity: 1 }]));
  const user = await pool.query("INSERT INTO users(email,name) VALUES($1,'Test user') RETURNING id", [`${randomUUID()}@example.invalid`]);
  await Promise.all([cart.mergeAnonymousCart(user.rows[0].id, guestHash), cart.mergeAnonymousCart(user.rows[0].id, guestHash)]);
  assert.equal((await cart.getCart(user.rows[0].id))[0].quantity, 2);
  const orderService = new OrderService({ pool, orderRepository: new OrderRepository(), enabledDeliveryMethods: ["pickup"] });
  const input: CreateOrderInput = { idempotencyKey: randomUUID(), customer: { name: "Test only", phone: "+70000000000" }, items: [{ productId: product.id, quantity: 2 }], delivery: { method: "pickup" }, requiresTireService: false, offerAccepted: true, personalDataConsent: true };
  const order = await measure("guest_order", () => orderService.createOrder(input));
  assert.equal(Number(order.total_kopecks), 6001 * 100 * 2);
  assert.equal((await orderService.createOrder(input)).id, order.id);
  const snapshot = await pool.query("SELECT product_attributes FROM order_items WHERE order_id=$1", [order.id]);
  assert.equal(snapshot.rows[0].product_attributes.tire.width, 225);
  assert.equal((await pool.query("SELECT status FROM order_status_history WHERE order_id=$1", [order.id])).rows[0].status, "new");
  await assert.rejects(() => orderService.createOrder({ ...input, idempotencyKey: randomUUID(), items: [{ productId: product.id, quantity: 99 }] }));
  await withTransaction(pool, (database) => repository.upsertStock(database, stockSchema.parse({externalId:"PERF-1",warehouseExternalId:"PERF-WH",warehouseCode:"PERF-WH",warehouseName:"TEST ONLY warehouse",quantity:8}), "csv"));
  assert.equal((await pool.query("SELECT reserved FROM inventories WHERE product_id=$1",[product.id])).rows[0].reserved,2);
  await pool.query("UPDATE inventory_reservations SET expires_at=NOW()-INTERVAL '1 minute' WHERE order_id=$1",[order.id]);
  await assert.rejects(() => pool.query("UPDATE orders SET status='shipped' WHERE id=$1",[order.id]));
  assert.equal(await releaseExpiredReservations(pool),1);
  assert.equal(await releaseExpiredReservations(pool),0);
  assert.equal((await pool.query("SELECT reserved FROM inventories WHERE product_id=$1",[product.id])).rows[0].reserved,0);
  await assert.rejects(() => pool.query("UPDATE orders SET status='completed' WHERE id=$1",[order.id]));
  const cancelOrder=await orderService.createOrder({...input,idempotencyKey:randomUUID()});
  await pool.query("UPDATE orders SET status='cancelled' WHERE id=$1",[cancelOrder.id]);
  assert.equal((await pool.query("SELECT reserved FROM inventories WHERE product_id=$1",[product.id])).rows[0].reserved,0);
  process.stdout.write(JSON.stringify({ postgres: (await pool.query("SELECT version()")).rows[0].version, productCount, measurements, assertions: "passed" }, null, 2) + "\n");
}

main().finally(() => pool.end()).catch((error: unknown) => { console.error(error); process.exitCode = 1; });

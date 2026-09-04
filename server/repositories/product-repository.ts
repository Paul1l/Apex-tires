import type { DatabaseExecutor } from "../types/common";
import type {
  PriceSyncItem,
  ProductFitmentsSyncItem,
  ProductSyncItem,
  StockSyncItem,
} from "../validators/one-c-schemas";

export interface CatalogProductRow {
  id: string;
  sku: string;
  external_id: string | null;
  kind: "tire" | "wheel";
  condition: "new" | "used";
  brand: string;
  model: string;
  name: string;
  width: number;
  profile: number;
  diameter: number;
  season: "summer" | "winter" | "all-season" | "none";
  studded: boolean;
  runflat: boolean;
  xl: boolean;
  wheel_type: "alloy" | "steel" | "other" | null;
  pcd: string | null;
  offset: number | null;
  center_bore: number | string | null;
  color: string | null;
  country: string | null;
  amount_kopecks: number | string;
  old_amount_kopecks: number | string | null;
  discount_percent: number | string | null;
  price_updated_at: Date | string;
  stock: number;
  reserved: number;
  warehouse: string | null;
  image: string | null;
  compatible_cars: string[];
  updated_at: Date | string;
}

function rublesToKopecks(amount: number): number {
  return Math.round(amount * 100);
}

export class ProductRepository {
  async listActiveCatalog(
    database: DatabaseExecutor,
    limit = 1_000,
  ): Promise<CatalogProductRow[]> {
    const result = await database.query<CatalogProductRow>(
      `SELECT
         products.id, products.sku, products.external_id, products.kind,
         products.condition, products.brand, products.model, products.name,
         products.width, products.profile, products.diameter, products.season,
         products.studded, products.runflat, products.xl, products.wheel_type,
         products.pcd, products.offset, products.center_bore, products.color,
         products.country, prices.amount_kopecks, prices.old_amount_kopecks,
         prices.discount_percent,
         COALESCE(prices.price_updated_at, prices.updated_at) AS price_updated_at,
         COALESCE(inventory.stock, 0)::integer AS stock,
         COALESCE(inventory.reserved, 0)::integer AS reserved,
         inventory.warehouse,
         image.url AS image,
         COALESCE(fitments.compatible_cars, ARRAY[]::text[]) AS compatible_cars,
         products.updated_at
       FROM products
       INNER JOIN prices
         ON prices.product_id = products.id AND prices.price_type = 'retail'
       LEFT JOIN LATERAL (
         SELECT
           SUM(inventories.quantity)::integer AS stock,
           SUM(inventories.reserved)::integer AS reserved,
           MIN(warehouses.name) AS warehouse
         FROM inventories
         INNER JOIN warehouses ON warehouses.id = inventories.warehouse_id
         WHERE inventories.product_id = products.id AND warehouses.is_active
       ) inventory ON TRUE
       LEFT JOIN LATERAL (
         SELECT product_images.url
         FROM product_images
         WHERE product_images.product_id = products.id
         ORDER BY product_images.position, product_images.id
         LIMIT 1
       ) image ON TRUE
       LEFT JOIN LATERAL (
         SELECT ARRAY_AGG(DISTINCT CONCAT(product_fitments.make, ' ', product_fitments.model)) AS compatible_cars
         FROM product_fitments
         WHERE product_fitments.product_id = products.id
           AND product_fitments.verified = TRUE
       ) fitments ON TRUE
       WHERE products.is_active = TRUE
       ORDER BY products.updated_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async upsertFromExternalSystem(
    database: DatabaseExecutor,
    product: ProductSyncItem,
    sourceSystem: string,
  ): Promise<string> {
    const result = await database.query<{ id: string }>(
      `INSERT INTO products (
         source_system, external_id, sku, kind, category, name, brand, model,
         description, specifications, width, profile, diameter, season,
         studded, runflat, xl, wheel_type, condition, pcd, offset, center_bore,
         color, country, is_active, sync_status, source_updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
         'active', $26
       )
       ON CONFLICT (source_system, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET
         sku = EXCLUDED.sku,
         kind = EXCLUDED.kind,
         category = EXCLUDED.category,
         name = EXCLUDED.name,
         brand = EXCLUDED.brand,
         model = EXCLUDED.model,
         description = EXCLUDED.description,
         specifications = EXCLUDED.specifications,
         width = EXCLUDED.width,
         profile = EXCLUDED.profile,
         diameter = EXCLUDED.diameter,
         season = EXCLUDED.season,
         studded = EXCLUDED.studded,
         runflat = EXCLUDED.runflat,
         xl = EXCLUDED.xl,
         wheel_type = EXCLUDED.wheel_type,
         condition = EXCLUDED.condition,
         pcd = EXCLUDED.pcd,
         offset = EXCLUDED.offset,
         center_bore = EXCLUDED.center_bore,
         color = EXCLUDED.color,
         country = EXCLUDED.country,
         is_active = EXCLUDED.is_active,
         sync_status = 'active',
         source_updated_at = EXCLUDED.source_updated_at,
         updated_at = NOW()
       RETURNING id`,
      [
        sourceSystem,
        product.externalId,
        product.sku,
        product.kind,
        product.category,
        product.name,
        product.brand,
        product.model,
        product.description,
        JSON.stringify(product.specifications),
        product.width,
        product.profile,
        product.diameter,
        product.season,
        product.studded,
        product.runflat,
        product.xl,
        product.wheelType ?? null,
        product.condition,
        product.pcd ?? null,
        product.offset ?? null,
        product.centerBore ?? null,
        product.color ?? null,
        product.country ?? null,
        product.isActive,
        product.sourceUpdatedAt ?? null,
      ],
    );

    const productId = result.rows[0].id;
    await database.query(
      "DELETE FROM product_images WHERE product_id = $1 AND source_system = $2",
      [productId, sourceSystem],
    );

    for (const image of product.images) {
      await database.query(
        `INSERT INTO product_images (
           product_id, source_system, external_id, url, alt, position
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          productId,
          sourceSystem,
          image.externalId ?? null,
          image.url,
          image.alt,
          image.position,
        ],
      );
    }

    return productId;
  }

  async deactivateMissing(
    database: DatabaseExecutor,
    sourceSystem: string,
    receivedExternalIds: string[],
  ): Promise<void> {
    await database.query(
      `UPDATE products
       SET is_active = FALSE, sync_status = 'inactive', updated_at = NOW()
       WHERE source_system = $1
         AND external_id IS NOT NULL
         AND NOT (external_id = ANY($2::text[]))`,
      [sourceSystem, receivedExternalIds],
    );
  }

  async upsertPrice(
    database: DatabaseExecutor,
    price: PriceSyncItem,
    sourceSystem: string,
  ): Promise<void> {
    const result = await database.query<{ product_id: string }>(
      `INSERT INTO prices (
         product_id, source_system, price_type, amount_kopecks,
         old_amount_kopecks, discount_percent, currency, source_updated_at,
         price_updated_at
       )
       SELECT id, $2, $3, $4, $5, $6, $7, $8, COALESCE($8::timestamptz, NOW())
       FROM products
       WHERE source_system = $2 AND external_id = $1
       ON CONFLICT (product_id, price_type) DO UPDATE SET
         source_system = EXCLUDED.source_system,
         amount_kopecks = EXCLUDED.amount_kopecks,
         old_amount_kopecks = EXCLUDED.old_amount_kopecks,
         discount_percent = EXCLUDED.discount_percent,
         currency = EXCLUDED.currency,
         source_updated_at = EXCLUDED.source_updated_at,
         price_updated_at = EXCLUDED.price_updated_at,
         updated_at = NOW()
       RETURNING product_id`,
      [
        price.externalId,
        sourceSystem,
        price.priceType,
        rublesToKopecks(price.price),
        price.oldPrice === undefined ? null : rublesToKopecks(price.oldPrice),
        price.discount ?? null,
        price.currency,
        price.sourceUpdatedAt ?? null,
      ],
    );

    if (result.rowCount === 0) {
      throw new Error("PRODUCT_NOT_FOUND");
    }
  }

  async upsertStock(
    database: DatabaseExecutor,
    stock: StockSyncItem,
    sourceSystem: string,
  ): Promise<void> {
    const warehouseResult = await database.query<{ id: string }>(
      `INSERT INTO warehouses (
         source_system, external_id, code, name
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET
         source_system = EXCLUDED.source_system,
         external_id = EXCLUDED.external_id,
         name = EXCLUDED.name,
         is_active = TRUE,
         updated_at = NOW()
       RETURNING id`,
      [
        sourceSystem,
        stock.warehouseExternalId,
        stock.warehouseCode,
        stock.warehouseName,
      ],
    );

    const stockResult = await database.query<{ product_id: string }>(
      `INSERT INTO inventories (
         product_id, warehouse_id, quantity, reserved, source_updated_at
       )
       SELECT id, $2, $3, $4, $5
       FROM products
       WHERE source_system = $6 AND external_id = $1
       ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         reserved = EXCLUDED.reserved,
         source_updated_at = EXCLUDED.source_updated_at,
         updated_at = NOW()
       RETURNING product_id`,
      [
        stock.externalId,
        warehouseResult.rows[0].id,
        stock.quantity,
        stock.reserved,
        stock.sourceUpdatedAt ?? null,
        sourceSystem,
      ],
    );

    if (stockResult.rowCount === 0) {
      throw new Error("PRODUCT_NOT_FOUND");
    }
  }

  async replaceFitments(
    database: DatabaseExecutor,
    item: ProductFitmentsSyncItem,
    sourceSystem: string,
  ): Promise<void> {
    const productResult = await database.query<{ id: string }>(
      `SELECT id FROM products
       WHERE source_system = $1 AND external_id = $2`,
      [sourceSystem, item.externalId],
    );
    if (productResult.rowCount === 0) throw new Error("PRODUCT_NOT_FOUND");

    const productId = productResult.rows[0].id;
    await database.query(
      "DELETE FROM product_fitments WHERE product_id = $1 AND source_system = $2",
      [productId, sourceSystem],
    );
    for (const fitment of item.fitments) {
      await database.query(
        `INSERT INTO product_fitments (
           product_id, source_system, make, model, generation,
           year_from, year_to, is_oem, data_source, verified, verified_at, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          productId,
          sourceSystem,
          fitment.make,
          fitment.model,
          fitment.generation ?? null,
          fitment.yearFrom ?? null,
          fitment.yearTo ?? null,
          fitment.isOem,
          fitment.source,
          fitment.verified,
          fitment.verifiedAt ?? null,
          fitment.notes ?? null,
        ],
      );
    }
  }
}

import type { DatabaseExecutor } from "../types/common";
import type {
  PriceSyncItem,
  ProductFitmentsSyncItem,
  ProductSyncItem,
  StockSyncItem,
} from "../validators/one-c-schemas";

function rublesToKopecks(amount: number): number {
  return Math.round(amount * 100);
}

export class ProductRepository {
  async upsertFromExternalSystem(
    database: DatabaseExecutor,
    product: ProductSyncItem,
    sourceSystem: string,
  ): Promise<string> {
    const result = await database.query<{ id: string }>(
      `INSERT INTO products (
         source_system, external_id, sku, kind, category, name, brand, model,
         description, specifications, width, profile, diameter, season,
         studded, runflat, pcd, offset, center_bore, color, country, is_active,
         sync_status, source_updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20, $21, $22, 'active', $23
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
         old_amount_kopecks, currency, source_updated_at
       )
       SELECT id, $2, $3, $4, $5, $6, $7
       FROM products
       WHERE source_system = $2 AND external_id = $1
       ON CONFLICT (product_id, price_type) DO UPDATE SET
         source_system = EXCLUDED.source_system,
         amount_kopecks = EXCLUDED.amount_kopecks,
         old_amount_kopecks = EXCLUDED.old_amount_kopecks,
         currency = EXCLUDED.currency,
         source_updated_at = EXCLUDED.source_updated_at,
         updated_at = NOW()
       RETURNING product_id`,
      [
        price.externalId,
        sourceSystem,
        price.priceType,
        rublesToKopecks(price.price),
        price.oldPrice === undefined ? null : rublesToKopecks(price.oldPrice),
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
           year_from, year_to, is_oem
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          productId,
          sourceSystem,
          fitment.make,
          fitment.model,
          fitment.generation ?? null,
          fitment.yearFrom ?? null,
          fitment.yearTo ?? null,
          fitment.isOem,
        ],
      );
    }
  }
}

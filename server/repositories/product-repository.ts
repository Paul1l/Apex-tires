import type { DatabaseExecutor } from "../types/common";
import type {
  PriceSyncItem,
  ProductFitmentsSyncItem,
  ProductSyncItem,
  StockSyncItem,
} from "../validators/one-c-schemas";
import type { CatalogQuery } from "../validators/catalog-query-schema";
import { createProductSlug } from "../utils/product-slug";
import { createHash } from "node:crypto";
import { ApplicationError } from "../utils/errors";

export interface CatalogProductRow {
  id: string;
  sku: string;
  external_id: string | null;
  slug: string;
  kind: "tire" | "wheel";
  condition: "new" | "used";
  brand: string;
  model: string;
  name: string;
  description?: string;
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
  total_count?: number | string;
}

export interface CatalogFacetRow {
  brands: string[];
  widths: number[];
  profiles: number[];
  diameters: number[];
}

interface SqlFilter {
  sql: string;
  values: unknown[];
}

function createCatalogFilter(query: CatalogQuery): SqlFilter {
  const clauses = [query.active === undefined ? "products.is_active = TRUE" : `products.is_active = $1`];
  const values: unknown[] = query.active === undefined ? [] : [query.active];
  const add = (clause: (parameter: number) => string, value: unknown) => {
    values.push(value);
    clauses.push(clause(values.length));
  };

  if (query.type !== "all") add((p) => `products.kind = $${p}`, query.type);
  if (query.brand) add((p) => `LOWER(products.brand) = ANY(string_to_array(LOWER($${p}), ','))`, query.brand);
  if (query.sourceSystem) add((p) => `products.source_system = $${p}`, query.sourceSystem);
  if (query.season) add((p) => `tire_specs.season = ANY(string_to_array($${p}, ','))`, query.season);
  if (query.width !== undefined) {
    add((p) => query.type === "wheel" ? `wheel_specs.width = $${p}`
      : query.type === "tire" ? `tire_specs.width = $${p}`
        : `(tire_specs.width = $${p}::numeric OR wheel_specs.width = $${p}::numeric)`, query.width);
  }
  if (query.profile !== undefined) add((p) => `tire_specs.profile = $${p}`, query.profile);
  if (query.diameter !== undefined) {
    add((p) => `(tire_specs.diameter = $${p} OR wheel_specs.diameter = $${p})`, query.diameter);
  }
  if (query.boltCount !== undefined) add((p) => `wheel_specs.bolt_count = $${p}`, query.boltCount);
  if (query.pcd !== undefined) add((p) => `wheel_specs.pcd = $${p}`, query.pcd);
  if (query.et !== undefined) add((p) => `wheel_specs.et = $${p}`, query.et);
  if (query.dia !== undefined) add((p) => `wheel_specs.dia = $${p}`, query.dia);
  if (query.studded !== undefined) add((p) => `tire_specs.studded = $${p}`, query.studded);
  if (query.runflat !== undefined) add((p) => `tire_specs.runflat = $${p}`, query.runflat);
  if (query.minPrice !== undefined) add((p) => `prices.amount_kopecks >= $${p}`, query.minPrice * 100);
  if (query.maxPrice !== undefined) add((p) => `prices.amount_kopecks <= $${p}`, query.maxPrice * 100);
  if (query.inStock) {
    clauses.push(`EXISTS (
      SELECT 1 FROM inventories available_inventory
      JOIN warehouses available_warehouse ON available_warehouse.id = available_inventory.warehouse_id
      WHERE available_inventory.product_id = products.id
        AND available_warehouse.is_active = TRUE
        AND available_inventory.quantity > available_inventory.reserved
    )`);
  }
  if (query.search) {
    add(
      (p) => `(LOWER(products.name) LIKE '%' || LOWER($${p}) || '%'
        OR LOWER(products.model) LIKE '%' || LOWER($${p}) || '%'
        OR LOWER(products.sku) = LOWER($${p})
        OR LOWER(COALESCE(products.article, '')) = LOWER($${p})
        OR LOWER(products.brand) LIKE '%' || LOWER($${p}) || '%')`,
      query.search,
    );
  }
  if (query.vehicleMake && query.vehicleModel && query.vehicleGeneration) {
    values.push(query.vehicleMake, query.vehicleModel, query.vehicleGeneration);
    const makeParameter = values.length - 2;
    const modelParameter = values.length - 1;
    const generationParameter = values.length;
    let modificationClause = "AND fitments.modification_id IS NULL";
    if (query.vehicleModification) {
      values.push(query.vehicleModification);
      modificationClause = `AND (car_modifications.id IS NULL OR LOWER(car_modifications.name) = LOWER($${values.length}))`;
    }
    clauses.push(`EXISTS (
      SELECT 1
      FROM fitments
      JOIN car_generations ON car_generations.id = fitments.generation_id
      JOIN car_models ON car_models.id = car_generations.model_id
      JOIN car_makes ON car_makes.id = car_models.make_id
      LEFT JOIN car_modifications ON car_modifications.id = fitments.modification_id
      WHERE fitments.verified = TRUE
        AND LOWER(car_makes.name) = LOWER($${makeParameter})
        AND LOWER(car_models.name) = LOWER($${modelParameter})
        AND LOWER(car_generations.name) = LOWER($${generationParameter})
        ${modificationClause}
        AND (
          (products.kind = 'tire' AND fitments.product_type = 'tire'
            AND tire_specs.width = fitments.tire_width
            AND tire_specs.profile = fitments.tire_profile
            AND tire_specs.diameter = fitments.tire_diameter)
          OR
          (products.kind = 'wheel' AND fitments.product_type = 'wheel'
            AND wheel_specs.diameter = fitments.wheel_diameter
            AND wheel_specs.width = fitments.wheel_width
            AND wheel_specs.bolt_count = fitments.bolt_count
            AND wheel_specs.pcd = fitments.pcd
            AND (fitments.dia IS NULL OR wheel_specs.dia >= fitments.dia)
            AND (fitments.et_min IS NULL OR wheel_specs.et >= fitments.et_min)
            AND (fitments.et_max IS NULL OR wheel_specs.et <= fitments.et_max))
        )
    )`);
  }
  return { sql: clauses.join("\n AND "), values };
}

function catalogSort(sort: CatalogQuery["sort"]): string {
  if (sort === "price_asc") return "prices.amount_kopecks ASC, products.id ASC";
  if (sort === "price_desc") return "prices.amount_kopecks DESC, products.id ASC";
  if (sort === "name") return "LOWER(products.name) ASC, products.id ASC";
  return "products.updated_at DESC, products.id DESC";
}

function rublesToKopecks(amount: number): number {
  return Math.round(amount * 100);
}

export class ProductRepository {
  async searchCatalog(
    database: DatabaseExecutor,
    query: CatalogQuery,
  ): Promise<CatalogProductRow[]> {
    const filter = createCatalogFilter(query);
    const limitParameter = filter.values.length + 1;
    const offsetParameter = filter.values.length + 2;
    const result = await database.query<CatalogProductRow>(
      `WITH matching_products AS (
         SELECT products.id, COUNT(*) OVER() AS total_count
         FROM products
         INNER JOIN prices ON prices.product_id = products.id AND prices.price_type = 'retail'
         LEFT JOIN tire_specs ON tire_specs.product_id = products.id
         LEFT JOIN wheel_specs ON wheel_specs.product_id = products.id
         WHERE ${filter.sql}
         ORDER BY ${catalogSort(query.sort)}
         LIMIT $${limitParameter} OFFSET $${offsetParameter}
       )
       SELECT
         products.id, products.sku, products.external_id, products.slug, products.kind,
         products.condition, products.brand, products.model, products.name,
         COALESCE(tire_specs.width, products.width)::integer AS width,
         COALESCE(tire_specs.profile, products.profile)::integer AS profile,
         COALESCE(tire_specs.diameter, wheel_specs.diameter, products.diameter)::integer AS diameter,
         COALESCE(tire_specs.season, products.season) AS season,
         COALESCE(tire_specs.studded, products.studded) AS studded,
         COALESCE(tire_specs.runflat, products.runflat) AS runflat,
         COALESCE(tire_specs.xl, products.xl) AS xl,
         products.wheel_type, products.pcd, products.offset, products.center_bore,
         products.color, products.country, prices.amount_kopecks,
         prices.old_amount_kopecks, prices.discount_percent,
         COALESCE(prices.price_updated_at, prices.updated_at) AS price_updated_at,
         COALESCE(inventory.stock, 0)::integer AS stock,
         COALESCE(inventory.reserved, 0)::integer AS reserved,
         inventory.warehouse, image.url AS image,
         ARRAY[]::text[] AS compatible_cars,
         products.updated_at, matching_products.total_count
       FROM matching_products
       JOIN products ON products.id = matching_products.id
       JOIN prices ON prices.product_id = products.id AND prices.price_type = 'retail'
       LEFT JOIN tire_specs ON tire_specs.product_id = products.id
       LEFT JOIN wheel_specs ON wheel_specs.product_id = products.id
       LEFT JOIN LATERAL (
         SELECT SUM(inventories.quantity)::integer AS stock,
           SUM(inventories.reserved)::integer AS reserved,
           MIN(warehouses.name) AS warehouse
         FROM inventories JOIN warehouses ON warehouses.id = inventories.warehouse_id
         WHERE inventories.product_id = products.id AND warehouses.is_active
       ) inventory ON TRUE
       LEFT JOIN LATERAL (
         SELECT product_images.url FROM product_images
         WHERE product_images.product_id = products.id
         ORDER BY product_images.position, product_images.id LIMIT 1
       ) image ON TRUE
       ORDER BY ${catalogSort(query.sort)}`,
      [...filter.values, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return result.rows;
  }

  async getCatalogFacets(
    database: DatabaseExecutor,
    type: CatalogQuery["type"],
  ): Promise<CatalogFacetRow> {
    const result = await database.query<CatalogFacetRow>(
      `SELECT
         ARRAY(SELECT DISTINCT brand FROM products WHERE is_active = TRUE
           AND ($1 = 'all' OR kind = $1) ORDER BY brand) AS brands,
         ARRAY(SELECT DISTINCT tire_specs.width FROM tire_specs JOIN products ON products.id = tire_specs.product_id
           WHERE products.is_active = TRUE ORDER BY tire_specs.width) AS widths,
         ARRAY(SELECT DISTINCT tire_specs.profile FROM tire_specs JOIN products ON products.id = tire_specs.product_id
           WHERE products.is_active = TRUE ORDER BY tire_specs.profile) AS profiles,
         ARRAY(SELECT DISTINCT diameter::integer FROM (
           SELECT tire_specs.diameter FROM tire_specs JOIN products ON products.id = tire_specs.product_id WHERE products.is_active = TRUE
           UNION SELECT wheel_specs.diameter FROM wheel_specs JOIN products ON products.id = wheel_specs.product_id WHERE products.is_active = TRUE
         ) dimensions ORDER BY diameter) AS diameters`,
      [type],
    );
    return result.rows[0] ?? { brands: [], widths: [], profiles: [], diameters: [] };
  }

  async findPublicBySlug(database: DatabaseExecutor, slug: string): Promise<CatalogProductRow | null> {
    return (await this.findPublicProducts(database, "products.slug=$1", [slug]))[0] ?? null;
  }

  async findPublicByIds(database: DatabaseExecutor, productIds: string[]): Promise<CatalogProductRow[]> {
    return this.findPublicProducts(database, "products.id=ANY($1::uuid[])", [productIds.slice(0, 100)]);
  }

  private async findPublicProducts(database: DatabaseExecutor, predicate: string, values: unknown[]): Promise<CatalogProductRow[]> {
    const result = await database.query<CatalogProductRow>(
      `SELECT products.id, products.sku, products.external_id, products.slug,
         products.kind, products.condition, products.brand, products.model,
         products.name, products.description, COALESCE(tire_specs.width, products.width)::integer AS width,
         COALESCE(tire_specs.profile, products.profile)::integer AS profile,
         COALESCE(tire_specs.diameter, wheel_specs.diameter, products.diameter)::integer AS diameter,
         COALESCE(tire_specs.season, products.season) AS season,
         COALESCE(tire_specs.studded, products.studded) AS studded,
         COALESCE(tire_specs.runflat, products.runflat) AS runflat,
         COALESCE(tire_specs.xl, products.xl) AS xl, products.wheel_type,
         products.pcd, products.offset, products.center_bore, products.color,
         products.country, prices.amount_kopecks, prices.old_amount_kopecks,
         prices.discount_percent, COALESCE(prices.price_updated_at, prices.updated_at) AS price_updated_at,
         COALESCE(inventory.stock,0)::integer AS stock,
         COALESCE(inventory.reserved,0)::integer AS reserved, inventory.warehouse,
         image.url AS image, ARRAY[]::text[] AS compatible_cars, products.updated_at
       FROM products JOIN prices ON prices.product_id=products.id AND prices.price_type='retail'
       LEFT JOIN tire_specs ON tire_specs.product_id=products.id
       LEFT JOIN wheel_specs ON wheel_specs.product_id=products.id
       LEFT JOIN LATERAL (
         SELECT SUM(inventories.quantity)::integer AS stock, SUM(inventories.reserved)::integer AS reserved,
           MIN(warehouses.name) AS warehouse FROM inventories JOIN warehouses ON warehouses.id=inventories.warehouse_id
         WHERE inventories.product_id=products.id AND warehouses.is_active
       ) inventory ON TRUE
       LEFT JOIN LATERAL (
         SELECT url FROM product_images WHERE product_id=products.id ORDER BY position,id LIMIT 1
       ) image ON TRUE
       WHERE ${predicate} AND products.is_active=TRUE LIMIT 100`,
      values,
    );
    return result.rows;
  }

  async findExistingExternalIds(
    database: DatabaseExecutor,
    sourceSystem: string,
    externalIds: string[],
    skus: string[] = [],
  ): Promise<Set<string>> {
    if (externalIds.length === 0) return new Set();
    const result = await database.query<{ external_id: string }>(
      `SELECT DISTINCT incoming.external_id FROM UNNEST($2::text[], $3::text[]) AS incoming(external_id, sku)
       JOIN products ON (products.source_system=$1 AND products.external_id=incoming.external_id)
         OR products.sku=incoming.sku`,
      [sourceSystem, externalIds, skus],
    );
    return new Set(result.rows.map((row) => row.external_id));
  }


  async upsertFromExternalSystem(
    database: DatabaseExecutor,
    product: ProductSyncItem,
    sourceSystem: string,
  ): Promise<string> {
    const brandSlug = `brand-${createHash("sha256").update(product.brand.toLocaleLowerCase("ru")).digest("hex").slice(0, 16)}`;
    const brandResult = await database.query<{ id: string }>(
      `INSERT INTO brands(name, slug) VALUES ($1, $2)
       ON CONFLICT (LOWER(name)) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
       RETURNING id`,
      [product.brand, brandSlug],
    );
    const existing = await database.query<{ id: string; slug: string; source_system: string }>(
      `SELECT id, slug, source_system FROM products
       WHERE (source_system = $1 AND external_id = $2) OR sku = $3
       ORDER BY CASE WHEN source_system = $1 AND external_id = $2 THEN 0 ELSE 1 END
       LIMIT 1 FOR UPDATE`,
      [sourceSystem, product.externalId, product.sku],
    );
    if (existing.rows[0]?.source_system === "1c" && sourceSystem !== "1c") {
      throw new ApplicationError({ code: "PRODUCT_SOURCE_CONFLICT", message: "Товар управляется 1С. Изменение через CSV недоступно.", statusCode: 409 });
    }
    const stableSlug = existing.rows[0]?.slug ?? createProductSlug(product.name, product.sku);
    const values = [
      sourceSystem, product.externalId, product.sku, product.article ?? null,
      stableSlug, product.kind, product.category, product.name, product.brand,
      brandResult.rows[0].id, product.model, product.description,
      JSON.stringify(product.specifications), product.width, product.profile,
      product.diameter, product.season, product.studded, product.runflat,
      product.xl, product.wheelType ?? null, product.condition,
      product.pcd ?? null, product.offset ?? null, product.centerBore ?? null,
      product.color ?? null, product.country ?? null, product.isActive,
      product.sourceUpdatedAt ?? null,
    ];
    const result = existing.rowCount
      ? await database.query<{ id: string }>(
        `UPDATE products SET source_system=$1, external_id=$2, sku=$3, article=$4,
           slug=$5, kind=$6, category=$7, name=$8, brand=$9, brand_id=$10,
           model=$11, description=$12, specifications=$13::jsonb, width=$14,
           profile=$15, diameter=$16, season=$17, studded=$18, runflat=$19,
           xl=$20, wheel_type=$21, condition=$22, pcd=$23, "offset"=$24,
           center_bore=$25, color=$26, country=$27, is_active=$28,
           sync_status='active', source_updated_at=$29,
           last_synced_at=CASE WHEN $1='1c' THEN NOW() ELSE last_synced_at END,
           updated_at=NOW() WHERE id=$30 RETURNING id`,
        [...values, existing.rows[0].id],
      )
      : await database.query<{ id: string }>(
        `INSERT INTO products (
           source_system, external_id, sku, article, slug, kind, category,
           name, brand, brand_id, model, description, specifications, width,
           profile, diameter, season, studded, runflat, xl, wheel_type,
           condition, pcd, "offset", center_bore, color, country, is_active,
           sync_status, source_updated_at, published_at, last_synced_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,
           $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,'active',$29,
           CASE WHEN $28 THEN NOW() ELSE NULL END,
           CASE WHEN $1='1c' THEN NOW() ELSE NULL END) RETURNING id`,
        values,
      );
    const productId = result.rows[0].id;
    await database.query(
      `INSERT INTO product_external_ids(product_id, source_system, external_id, last_synced_at, sync_status)
       VALUES ($1, $2, $3, CASE WHEN $2='1c' THEN NOW() ELSE NULL END, 'active')
       ON CONFLICT (source_system, external_id) DO UPDATE SET
         product_id=EXCLUDED.product_id, last_synced_at=EXCLUDED.last_synced_at,
         sync_status='active'`,
      [productId, sourceSystem, product.externalId],
    );
    if (product.kind === "tire") {
      await database.query(
        `INSERT INTO tire_specs(product_id,width,profile,diameter,season,studded,runflat,xl,load_index,speed_index,manufacturer_country,model_year,other_attributes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         ON CONFLICT(product_id) DO UPDATE SET width=EXCLUDED.width,profile=EXCLUDED.profile,
           diameter=EXCLUDED.diameter,season=EXCLUDED.season,studded=EXCLUDED.studded,
           runflat=EXCLUDED.runflat,xl=EXCLUDED.xl,load_index=EXCLUDED.load_index,
           speed_index=EXCLUDED.speed_index,manufacturer_country=EXCLUDED.manufacturer_country,
           model_year=EXCLUDED.model_year,other_attributes=EXCLUDED.other_attributes`,
        [productId, product.width, product.profile, product.diameter, product.season,
          product.studded, product.runflat, product.xl, product.loadIndex ?? null,
          product.speedIndex ?? null, product.country ?? null, product.modelYear ?? null,
          JSON.stringify(product.specifications)],
      );
      await database.query("DELETE FROM wheel_specs WHERE product_id=$1", [productId]);
    } else if (product.wheelWidth && product.boltCount && product.pcdNumber) {
      await database.query(
        `INSERT INTO wheel_specs(product_id,diameter,width,bolt_count,pcd,et,dia,material,color,manufacturer_country,other_attributes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT(product_id) DO UPDATE SET diameter=EXCLUDED.diameter,width=EXCLUDED.width,
           bolt_count=EXCLUDED.bolt_count,pcd=EXCLUDED.pcd,et=EXCLUDED.et,dia=EXCLUDED.dia,
           material=EXCLUDED.material,color=EXCLUDED.color,
           manufacturer_country=EXCLUDED.manufacturer_country,other_attributes=EXCLUDED.other_attributes`,
        [productId, product.diameter, product.wheelWidth, product.boltCount,
          product.pcdNumber, product.offset ?? null, product.centerBore ?? null,
          product.wheelType ?? null, product.color ?? null, product.country ?? null,
          JSON.stringify(product.specifications)],
      );
      await database.query("DELETE FROM tire_specs WHERE product_id=$1", [productId]);
    }
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

  async deactivateMissingFromImportJob(
    database: DatabaseExecutor,
    sourceSystem: string,
    jobId: string,
  ): Promise<void> {
    await database.query(
      `UPDATE products SET is_active = FALSE, sync_status = 'inactive', updated_at = NOW()
       WHERE source_system = $1 AND external_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM import_job_product_keys
           WHERE import_job_product_keys.job_id = $2
             AND import_job_product_keys.external_id = products.external_id
         )`,
      [sourceSystem, jobId],
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
    await database.query("SELECT id FROM products WHERE source_system=$1 AND external_id=$2 FOR UPDATE", [sourceSystem,stock.externalId]);
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

    await database.query(`SELECT inventories.product_id FROM inventories JOIN products ON products.id=inventories.product_id
      WHERE products.source_system=$1 AND products.external_id=$2 AND inventories.warehouse_id=$3 FOR UPDATE OF inventories`, [sourceSystem,stock.externalId,warehouseResult.rows[0].id]);
    const stockResult = await database.query<{ product_id: string }>(
      `INSERT INTO inventories (
         product_id, warehouse_id, quantity, reserved, source_updated_at, source_system
       )
       SELECT id, $2, $3, $4 + COALESCE((SELECT SUM(quantity) FROM inventory_reservations
         WHERE product_id=products.id AND warehouse_id=$2 AND status='active'),0), $5, $6
       FROM products
       WHERE source_system = $6 AND external_id = $1
       ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         reserved = EXCLUDED.reserved,
         source_system = EXCLUDED.source_system,
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
    productSourceSystem: string,
    fitmentSourceSystem = productSourceSystem,
  ): Promise<void> {
    const productResult = await database.query<{ id: string }>(
      `SELECT id FROM products
       WHERE source_system = $1 AND external_id = $2`,
      [productSourceSystem, item.externalId],
    );
    if (productResult.rowCount === 0) throw new Error("PRODUCT_NOT_FOUND");

    const productId = productResult.rows[0].id;
    await database.query(
      "DELETE FROM product_fitments WHERE product_id = $1 AND source_system = $2",
      [productId, fitmentSourceSystem],
    );
    for (const fitment of item.fitments) {
      await database.query(
        `INSERT INTO product_fitments (
         product_id, source_system, make, model, generation,
           modification, year_from, year_to, is_oem, data_source, verified,
           verified_at, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          productId,
          fitmentSourceSystem,
          fitment.make,
          fitment.model,
          fitment.generation ?? null,
          fitment.modification ?? null,
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

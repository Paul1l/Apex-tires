import type {
  AdminProductCard,
  AdminProductListItem,
  AdminProductPrice,
  AdminProductStockRow,
} from "../../lib/admin/product-types";
import type { DatabaseExecutor } from "../types/common";
import { buildProductSubtitle } from "../utils/product-title";
import { toSafeImageUrl } from "../validators/image-url";
import type { AdminProductListQuery } from "../validators/admin-product-schema";
import { SAFE_IMAGE_URL_SQL } from "./product-repository";

/**
 * Optimistic-concurrency token: products.updated_at in microseconds since the
 * epoch, as text (JavaScript dates would lose the microseconds).
 */
const VERSION_SQL = "(EXTRACT(EPOCH FROM products.updated_at) * 1000000)::bigint::text";
/** Always moves forward, even if two saves share a transaction timestamp. */
const NEXT_UPDATED_AT_SQL = "GREATEST(NOW(), products.updated_at + INTERVAL '1 microsecond')";

export interface EditorProductRow {
  id: string;
  slug: string;
  kind: "tire" | "wheel";
  source_system: string;
  external_id: string | null;
  sku: string;
  article: string | null;
  name: string;
  brand: string;
  brand_id: string | null;
  model: string;
  category: string;
  category_id: string | null;
  description: string;
  country: string | null;
  is_active: boolean;
  published_at: Date | null;
  width: number;
  profile: number;
  diameter: number;
  season: "summer" | "winter" | "all-season" | "none";
  studded: boolean;
  runflat: boolean;
  xl: boolean;
  pcd: string | null;
  offset: number | null;
  center_bore: string | number | null;
  color: string | null;
  wheel_type: "alloy" | "steel" | "other" | null;
  tire_width: number | null;
  tire_profile: number | null;
  tire_diameter: string | number | null;
  tire_season: "summer" | "winter" | "all-season" | null;
  tire_studded: boolean | null;
  tire_runflat: boolean | null;
  tire_xl: boolean | null;
  load_index: string | null;
  speed_index: string | null;
  wheel_diameter: string | number | null;
  wheel_width: string | number | null;
  bolt_count: number | null;
  wheel_pcd: string | number | null;
  wheel_et: string | number | null;
  wheel_dia: string | number | null;
  wheel_material: "alloy" | "steel" | "other" | null;
  wheel_color: string | null;
  version: string;
  created_at: Date;
  updated_at: Date;
}

export interface StoredImageRow {
  id: string;
  url: string;
  alt: string;
  position: number;
  source_system: string;
  storage_key: string | null;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/** Card as the editor shows it: typed specs first, legacy product columns as fallback. */
export function mapEditorCard(row: EditorProductRow): AdminProductCard {
  const isTire = row.kind === "tire";
  return {
    kind: row.kind,
    sku: row.sku,
    article: row.article,
    name: row.name,
    brandId: row.brand_id,
    model: row.model,
    categoryId: row.category_id,
    description: row.description,
    country: row.country,
    isActive: row.is_active,
    diameter: positiveOrNull(toNumber(isTire ? row.tire_diameter : row.wheel_diameter) ?? row.diameter),
    width: isTire ? positiveOrNull(row.tire_width ?? row.width) : null,
    profile: isTire ? positiveOrNull(row.tire_profile ?? row.profile) : null,
    season: isTire ? row.tire_season ?? (row.season === "none" ? null : row.season) : null,
    studded: isTire ? row.tire_studded ?? row.studded : false,
    runflat: isTire ? row.tire_runflat ?? row.runflat : false,
    xl: isTire ? row.tire_xl ?? row.xl : false,
    loadIndex: isTire ? row.load_index : null,
    speedIndex: isTire ? row.speed_index : null,
    wheelWidth: isTire ? null : toNumber(row.wheel_width),
    boltCount: isTire ? null : row.bolt_count,
    pcd: isTire ? null : toNumber(row.wheel_pcd),
    offset: isTire ? null : row.offset ?? toNumber(row.wheel_et),
    centerBore: isTire ? null : toNumber(row.center_bore) ?? toNumber(row.wheel_dia),
    wheelType: isTire ? null : row.wheel_type ?? row.wheel_material,
    color: isTire ? null : row.color ?? row.wheel_color,
  };
}

export interface ProductCardNames {
  brandName: string;
  categoryName: string;
  /** "5x112" for wheels; null for tires. */
  pcdText: string | null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

interface AdminListRow {
  id: string;
  sku: string;
  slug: string;
  kind: "tire" | "wheel";
  brand: string;
  model: string;
  name: string;
  season: "summer" | "winter" | "all-season" | "none";
  color: string | null;
  is_active: boolean;
  source_system: string;
  external_id: string | null;
  width: number;
  profile: number;
  diameter: number;
  pcd: string | null;
  amount_kopecks: string | number | null;
  old_amount_kopecks: string | number | null;
  stock: number;
  reserved: number;
  image: string | null;
  updated_at: Date;
  total_count: string | number;
}

export class AdminCatalogProductRepository {
  async listProducts(
    database: DatabaseExecutor,
    query: AdminProductListQuery,
  ): Promise<{ items: AdminProductListItem[]; total: number }> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (clause: (parameter: number) => string, value: unknown) => {
      values.push(value);
      clauses.push(clause(values.length));
    };
    if (query.active !== "all") add((p) => `products.is_active = $${p}`, query.active === "true");
    if (query.type !== "all") add((p) => `products.kind = $${p}`, query.type);
    if (query.sourceSystem) add((p) => `products.source_system = $${p}`, query.sourceSystem);
    if (query.search) {
      add(
        (p) => `(LOWER(products.name) LIKE '%' || LOWER($${p}) || '%' ESCAPE '\\'
          OR LOWER(products.model) LIKE '%' || LOWER($${p}) || '%' ESCAPE '\\'
          OR LOWER(products.brand) LIKE '%' || LOWER($${p}) || '%' ESCAPE '\\'
          OR LOWER(products.sku) LIKE '%' || LOWER($${p}) || '%' ESCAPE '\\'
          OR LOWER(COALESCE(products.article, '')) LIKE '%' || LOWER($${p}) || '%' ESCAPE '\\')`,
        escapeLike(query.search),
      );
    }
    const where = clauses.length > 0 ? clauses.join(" AND ") : "TRUE";
    const limitParameter = values.length + 1;
    const offsetParameter = values.length + 2;
    const result = await database.query<AdminListRow>(
      `WITH matching AS (
         SELECT products.id, COUNT(*) OVER() AS total_count
         FROM products
         WHERE ${where}
         ORDER BY products.updated_at DESC, products.id DESC
         LIMIT $${limitParameter} OFFSET $${offsetParameter}
       )
       SELECT products.id, products.sku, products.slug, products.kind, products.brand,
         products.model, products.name, products.season, products.color, products.is_active,
         products.source_system, products.external_id,
         COALESCE(tire_specs.width, products.width)::integer AS width,
         COALESCE(tire_specs.profile, products.profile)::integer AS profile,
         COALESCE(tire_specs.diameter, wheel_specs.diameter, products.diameter)::integer AS diameter,
         products.pcd, prices.amount_kopecks, prices.old_amount_kopecks,
         COALESCE(inventory.stock, 0)::integer AS stock,
         COALESCE(inventory.reserved, 0)::integer AS reserved,
         image.url AS image, products.updated_at, matching.total_count
       FROM matching
       JOIN products ON products.id = matching.id
       LEFT JOIN prices ON prices.product_id = products.id AND prices.price_type = 'retail'
       LEFT JOIN tire_specs ON tire_specs.product_id = products.id
       LEFT JOIN wheel_specs ON wheel_specs.product_id = products.id
       LEFT JOIN LATERAL (
         SELECT SUM(inventories.quantity)::integer AS stock, SUM(inventories.reserved)::integer AS reserved
         FROM inventories JOIN warehouses ON warehouses.id = inventories.warehouse_id
         WHERE inventories.product_id = products.id AND warehouses.is_active
       ) inventory ON TRUE
       LEFT JOIN LATERAL (
         SELECT product_images.url FROM product_images
         WHERE product_images.product_id = products.id AND ${SAFE_IMAGE_URL_SQL}
         ORDER BY product_images.position, product_images.id LIMIT 1
       ) image ON TRUE
       ORDER BY products.updated_at DESC, products.id DESC`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      total: Number(result.rows[0]?.total_count ?? 0),
      items: result.rows.map((row) => ({
        id: row.id,
        sku: row.sku,
        slug: row.slug,
        kind: row.kind,
        brand: row.brand,
        model: row.model,
        name: row.name,
        subtitle: buildProductSubtitle(row),
        season: row.season,
        color: row.color,
        isActive: row.is_active,
        source: row.source_system,
        externalId: row.external_id,
        priceKopecks: toNumber(row.amount_kopecks),
        oldPriceKopecks: toNumber(row.old_amount_kopecks),
        stock: row.stock,
        reserved: row.reserved,
        image: toSafeImageUrl(row.image),
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    };
  }

  async findEditorProduct(
    database: DatabaseExecutor,
    productId: string,
    options: { lock?: boolean } = {},
  ): Promise<EditorProductRow | null> {
    const result = await database.query<EditorProductRow>(
      `SELECT products.id, products.slug, products.kind, products.source_system, products.external_id,
         products.sku, products.article, products.name, products.brand, products.brand_id,
         products.model, products.category, products.category_id, products.description,
         products.country, products.is_active, products.published_at, products.width,
         products.profile, products.diameter, products.season, products.studded,
         products.runflat, products.xl, products.pcd, products."offset", products.center_bore,
         products.color, products.wheel_type,
         tire_specs.width AS tire_width, tire_specs.profile AS tire_profile,
         tire_specs.diameter AS tire_diameter, tire_specs.season AS tire_season,
         tire_specs.studded AS tire_studded, tire_specs.runflat AS tire_runflat,
         tire_specs.xl AS tire_xl, tire_specs.load_index, tire_specs.speed_index,
         wheel_specs.diameter AS wheel_diameter, wheel_specs.width AS wheel_width,
         wheel_specs.bolt_count, wheel_specs.pcd AS wheel_pcd, wheel_specs.et AS wheel_et,
         wheel_specs.dia AS wheel_dia, wheel_specs.material AS wheel_material,
         wheel_specs.color AS wheel_color,
         ${VERSION_SQL} AS version, products.created_at, products.updated_at
       FROM products
       LEFT JOIN tire_specs ON tire_specs.product_id = products.id
       LEFT JOIN wheel_specs ON wheel_specs.product_id = products.id
       WHERE products.id = $1
       ${options.lock ? "FOR UPDATE OF products" : ""}`,
      [productId],
    );
    return result.rows[0] ?? null;
  }

  /** Locks the product row (serializes edits of one product); null if missing. */
  async lockProduct(
    database: DatabaseExecutor,
    productId: string,
  ): Promise<{ id: string; kind: "tire" | "wheel"; slug: string; source_system: string } | null> {
    const result = await database.query<{ id: string; kind: "tire" | "wheel"; slug: string; source_system: string }>(
      "SELECT id, kind, slug, source_system FROM products WHERE id = $1 FOR UPDATE",
      [productId],
    );
    return result.rows[0] ?? null;
  }

  async findProductBySku(database: DatabaseExecutor, sku: string, exceptProductId: string | null): Promise<string | null> {
    const result = await database.query<{ sku: string }>(
      `SELECT sku FROM products WHERE LOWER(sku) = LOWER($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
      [sku, exceptProductId],
    );
    return result.rows[0]?.sku ?? null;
  }

  async slugExists(database: DatabaseExecutor, slug: string): Promise<boolean> {
    const result = await database.query("SELECT 1 FROM products WHERE slug = $1", [slug]);
    return (result.rowCount ?? 0) > 0;
  }

  async insertProduct(
    database: DatabaseExecutor,
    card: AdminProductCard,
    names: ProductCardNames,
    slug: string,
  ): Promise<{ id: string; version: string }> {
    const result = await database.query<{ id: string; version: string }>(
      `INSERT INTO products (
         source_system, external_id, sku, article, slug, kind, category, category_id,
         name, brand, brand_id, model, description, specifications, width, profile,
         diameter, season, studded, runflat, xl, wheel_type, condition, pcd, "offset",
         center_bore, color, country, is_active, sync_status, published_at
       ) VALUES ('manual', NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '{}'::jsonb,
         $12, $13, $14, $15, $16, $17, $18, $19, 'new', $20, $21, $22, $23, $24, $25, 'active',
         CASE WHEN $25 THEN NOW() ELSE NULL END)
       RETURNING id, ${VERSION_SQL} AS version`,
      [
        card.sku, card.article, slug, card.kind, names.categoryName, card.categoryId,
        card.name, names.brandName, card.brandId, card.model, card.description,
        card.width ?? 0, card.profile ?? 0, card.diameter, card.season ?? "none",
        card.studded, card.runflat, card.xl, card.wheelType, names.pcdText, card.offset,
        card.centerBore, card.color, card.country, card.isActive,
      ],
    );
    return result.rows[0];
  }

  async updateProduct(
    database: DatabaseExecutor,
    productId: string,
    card: AdminProductCard,
    names: ProductCardNames,
  ): Promise<void> {
    await database.query(
      `UPDATE products SET sku = $2, article = $3, category = $4, category_id = $5,
         name = $6, brand = $7, brand_id = $8, model = $9, description = $10,
         width = $11, profile = $12, diameter = $13, season = $14, studded = $15,
         runflat = $16, xl = $17, wheel_type = $18, pcd = $19, "offset" = $20,
         center_bore = $21, color = $22, country = $23, is_active = $24,
         published_at = CASE WHEN $24 AND published_at IS NULL THEN NOW() ELSE published_at END
       WHERE id = $1`,
      [
        productId, card.sku, card.article, names.categoryName, card.categoryId, card.name,
        names.brandName, card.brandId, card.model, card.description, card.width ?? 0,
        card.profile ?? 0, card.diameter, card.season ?? "none", card.studded, card.runflat,
        card.xl, card.wheelType, names.pcdText, card.offset, card.centerBore, card.color,
        card.country, card.isActive,
      ],
    );
  }

  /** Writes the typed specs the storefront filters by (tire_specs / wheel_specs). */
  async saveSpecs(database: DatabaseExecutor, productId: string, card: AdminProductCard): Promise<void> {
    if (card.kind === "tire") {
      await database.query(
        `INSERT INTO tire_specs (product_id, width, profile, diameter, season, studded, runflat, xl,
           load_index, speed_index, manufacturer_country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (product_id) DO UPDATE SET width = EXCLUDED.width, profile = EXCLUDED.profile,
           diameter = EXCLUDED.diameter, season = EXCLUDED.season, studded = EXCLUDED.studded,
           runflat = EXCLUDED.runflat, xl = EXCLUDED.xl, load_index = EXCLUDED.load_index,
           speed_index = EXCLUDED.speed_index, manufacturer_country = EXCLUDED.manufacturer_country`,
        [productId, card.width, card.profile, card.diameter, card.season, card.studded,
          card.runflat, card.xl, card.loadIndex, card.speedIndex, card.country],
      );
      return;
    }
    await database.query(
      `INSERT INTO wheel_specs (product_id, diameter, width, bolt_count, pcd, et, dia, material,
         color, manufacturer_country)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (product_id) DO UPDATE SET diameter = EXCLUDED.diameter, width = EXCLUDED.width,
         bolt_count = EXCLUDED.bolt_count, pcd = EXCLUDED.pcd, et = EXCLUDED.et, dia = EXCLUDED.dia,
         material = EXCLUDED.material, color = EXCLUDED.color,
         manufacturer_country = EXCLUDED.manufacturer_country`,
      [productId, card.diameter, card.wheelWidth, card.boltCount, card.pcd, card.offset,
        card.centerBore, card.wheelType, card.color, card.country],
    );
  }

  /** Marks the card as changed and returns the new version. */
  async touchProduct(database: DatabaseExecutor, productId: string): Promise<string> {
    const result = await database.query<{ version: string }>(
      `UPDATE products SET updated_at = ${NEXT_UPDATED_AT_SQL} WHERE id = $1 RETURNING ${VERSION_SQL} AS version`,
      [productId],
    );
    return result.rows[0].version;
  }

  async findRetailPrice(database: DatabaseExecutor, productId: string): Promise<AdminProductPrice | null> {
    const result = await database.query<{ amount_kopecks: string; old_amount_kopecks: string | null }>(
      "SELECT amount_kopecks, old_amount_kopecks FROM prices WHERE product_id = $1 AND price_type = 'retail'",
      [productId],
    );
    const row = result.rows[0];
    return row
      ? { amountKopecks: Number(row.amount_kopecks), oldAmountKopecks: toNumber(row.old_amount_kopecks) }
      : null;
  }

  async saveRetailPrice(database: DatabaseExecutor, productId: string, price: AdminProductPrice): Promise<void> {
    await database.query(
      `INSERT INTO prices (product_id, source_system, price_type, amount_kopecks, old_amount_kopecks,
         currency, price_updated_at)
       VALUES ($1, 'manual', 'retail', $2, $3, 'RUB', NOW())
       ON CONFLICT (product_id, price_type) DO UPDATE SET source_system = 'manual',
         amount_kopecks = EXCLUDED.amount_kopecks, old_amount_kopecks = EXCLUDED.old_amount_kopecks,
         source_updated_at = NULL, price_updated_at = NOW(), updated_at = NOW()`,
      [productId, price.amountKopecks, price.oldAmountKopecks],
    );
  }

  /**
   * Stock of the product in every active warehouse (0 where there is no row).
   * With `lock`, the existing inventory rows are locked until the end of the
   * transaction, so a checkout cannot change `reserved` in between.
   */
  async listStock(
    database: DatabaseExecutor,
    productId: string,
    options: { lock?: boolean } = {},
  ): Promise<AdminProductStockRow[]> {
    if (options.lock) {
      await database.query(
        "SELECT warehouse_id FROM inventories WHERE product_id = $1 ORDER BY warehouse_id FOR UPDATE",
        [productId],
      );
    }
    const result = await database.query<{
      id: string; code: string; name: string; quantity: number | null; reserved: number | null;
    }>(
      `SELECT warehouses.id, warehouses.code, warehouses.name, inventories.quantity, inventories.reserved
       FROM warehouses
       LEFT JOIN inventories ON inventories.warehouse_id = warehouses.id AND inventories.product_id = $1
       WHERE warehouses.is_active
       ORDER BY LOWER(warehouses.name), warehouses.code`,
      [productId],
    );
    return result.rows.map((row) => ({
      warehouseId: row.id,
      warehouseCode: row.code,
      warehouseName: row.name,
      quantity: row.quantity ?? 0,
      reserved: row.reserved ?? 0,
    }));
  }

  /** Sets the physical quantity; the reserve is kept (the CHECK reserved <= quantity still applies). */
  async setStockQuantity(
    database: DatabaseExecutor,
    productId: string,
    warehouseId: string,
    quantity: number,
  ): Promise<void> {
    await database.query(
      `INSERT INTO inventories (product_id, warehouse_id, quantity, reserved, source_system)
       VALUES ($1, $2, $3, 0, 'manual')
       ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = EXCLUDED.quantity,
         source_system = 'manual', source_updated_at = NULL, updated_at = NOW()`,
      [productId, warehouseId, quantity],
    );
  }

  async listImages(database: DatabaseExecutor, productId: string): Promise<StoredImageRow[]> {
    const result = await database.query<StoredImageRow>(
      `SELECT id, url, alt, position, source_system, storage_key FROM product_images
       WHERE product_id = $1 ORDER BY position, created_at, id`,
      [productId],
    );
    return result.rows;
  }

  async insertImage(
    database: DatabaseExecutor,
    image: { productId: string; url: string; storageKey: string | null; alt: string; position: number },
  ): Promise<string> {
    const result = await database.query<{ id: string }>(
      `INSERT INTO product_images (product_id, source_system, url, storage_key, alt, position)
       VALUES ($1, 'manual', $2, $3, $4, $5) RETURNING id`,
      [image.productId, image.url, image.storageKey, image.alt, image.position],
    );
    return result.rows[0].id;
  }

  async updateImage(
    database: DatabaseExecutor,
    productId: string,
    image: { id: string; alt: string; position: number },
  ): Promise<void> {
    await database.query(
      "UPDATE product_images SET alt = $3, position = $4 WHERE id = $2 AND product_id = $1",
      [productId, image.id, image.alt, image.position],
    );
  }

  async deleteImage(database: DatabaseExecutor, productId: string, imageId: string): Promise<void> {
    await database.query("DELETE FROM product_images WHERE id = $2 AND product_id = $1", [productId, imageId]);
  }
}

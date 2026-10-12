import type {
  AdminBrand,
  AdminCategory,
  AdminVehicleReference,
  AdminWarehouse,
} from "../../lib/admin/product-types";
import type { DatabaseExecutor } from "../types/common";

interface BrandRow { id: string; name: string; is_active: boolean }
interface CategoryRow { id: string; name: string; parent_id: string | null; is_active: boolean }

const mapBrand = (row: BrandRow): AdminBrand => ({ id: row.id, name: row.name, isActive: row.is_active });
const mapCategory = (row: CategoryRow): AdminCategory => ({
  id: row.id, name: row.name, parentId: row.parent_id, isActive: row.is_active,
});

/** Upper bound of every reference list sent to the editor. */
export const MAXIMUM_REFERENCE_ITEMS = 3_000;

/** Brands, categories, warehouses and the vehicle reference for the admin editor. */
export class AdminCatalogReferenceRepository {
  async listBrands(database: DatabaseExecutor): Promise<AdminBrand[]> {
    const result = await database.query<BrandRow>(
      `SELECT id, name, is_active FROM brands ORDER BY LOWER(name), id LIMIT ${MAXIMUM_REFERENCE_ITEMS}`,
    );
    return result.rows.map(mapBrand);
  }

  async findBrand(database: DatabaseExecutor, brandId: string, options: { lock?: boolean } = {}): Promise<AdminBrand | null> {
    const result = await database.query<BrandRow>(
      `SELECT id, name, is_active FROM brands WHERE id = $1 ${options.lock ? "FOR SHARE" : ""}`,
      [brandId],
    );
    return result.rows[0] ? mapBrand(result.rows[0]) : null;
  }

  /** Inserts a brand unless one with the same name (any case) exists; returns the stored one. */
  async insertBrand(database: DatabaseExecutor, name: string, slug: string): Promise<{ brand: AdminBrand; created: boolean }> {
    const inserted = await database.query<BrandRow>(
      `INSERT INTO brands (name, slug) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING id, name, is_active`,
      [name, slug],
    );
    if (inserted.rows[0]) return { brand: mapBrand(inserted.rows[0]), created: true };
    const existing = await database.query<BrandRow>(
      "SELECT id, name, is_active FROM brands WHERE LOWER(name) = LOWER($1) OR slug = $2 ORDER BY (LOWER(name) = LOWER($1)) DESC LIMIT 1",
      [name, slug],
    );
    return { brand: mapBrand(existing.rows[0]), created: false };
  }

  async listCategories(database: DatabaseExecutor): Promise<AdminCategory[]> {
    const result = await database.query<CategoryRow>(
      `SELECT id, name, parent_id, is_active FROM categories ORDER BY LOWER(name), id LIMIT ${MAXIMUM_REFERENCE_ITEMS}`,
    );
    return result.rows.map(mapCategory);
  }

  async findCategory(database: DatabaseExecutor, categoryId: string, options: { lock?: boolean } = {}): Promise<AdminCategory | null> {
    const result = await database.query<CategoryRow>(
      `SELECT id, name, parent_id, is_active FROM categories WHERE id = $1 ${options.lock ? "FOR SHARE" : ""}`,
      [categoryId],
    );
    return result.rows[0] ? mapCategory(result.rows[0]) : null;
  }

  async findCategoryByName(database: DatabaseExecutor, name: string, parentId: string | null): Promise<AdminCategory | null> {
    const result = await database.query<CategoryRow>(
      `SELECT id, name, parent_id, is_active FROM categories
       WHERE LOWER(name) = LOWER($1) AND parent_id IS NOT DISTINCT FROM $2::uuid LIMIT 1`,
      [name, parentId],
    );
    return result.rows[0] ? mapCategory(result.rows[0]) : null;
  }

  async categorySlugExists(database: DatabaseExecutor, slug: string): Promise<boolean> {
    const result = await database.query("SELECT 1 FROM categories WHERE slug = $1", [slug]);
    return (result.rowCount ?? 0) > 0;
  }

  async insertCategory(database: DatabaseExecutor, name: string, slug: string, parentId: string | null): Promise<AdminCategory> {
    const result = await database.query<CategoryRow>(
      `INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3)
       RETURNING id, name, parent_id, is_active`,
      [name, slug, parentId],
    );
    return mapCategory(result.rows[0]);
  }

  async listActiveWarehouses(database: DatabaseExecutor): Promise<AdminWarehouse[]> {
    const result = await database.query<{ id: string; code: string; name: string; source_system: string }>(
      `SELECT id, code, name, source_system FROM warehouses WHERE is_active
       ORDER BY LOWER(name), code LIMIT ${MAXIMUM_REFERENCE_ITEMS}`,
    );
    return result.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, source: row.source_system }));
  }

  /** One level of the vehicle reference (car_makes → car_models → car_generations → car_modifications). */
  async listVehicleReferences(
    database: DatabaseExecutor,
    level: "makes" | "models" | "generations" | "modifications",
    parentId?: string,
  ): Promise<AdminVehicleReference[]> {
    if (level === "makes") {
      const result = await database.query<{ id: string; name: string }>(
        `SELECT id, name FROM car_makes WHERE sync_status = 'active'
         ORDER BY LOWER(name), id LIMIT ${MAXIMUM_REFERENCE_ITEMS}`,
      );
      return result.rows;
    }
    if (level === "models") {
      const result = await database.query<{ id: string; name: string }>(
        `SELECT id, name FROM car_models WHERE make_id = $1 AND sync_status = 'active'
         ORDER BY LOWER(name), id LIMIT ${MAXIMUM_REFERENCE_ITEMS}`,
        [parentId],
      );
      return result.rows;
    }
    const table = level === "generations" ? "car_generations" : "car_modifications";
    const parentColumn = level === "generations" ? "model_id" : "generation_id";
    const result = await database.query<{ id: string; name: string; year_from: number | null; year_to: number | null }>(
      `SELECT id, name, year_from, year_to FROM ${table}
       WHERE ${parentColumn} = $1 AND sync_status = 'active'
       ORDER BY year_from NULLS LAST, LOWER(name), id LIMIT ${MAXIMUM_REFERENCE_ITEMS}`,
      [parentId],
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, yearFrom: row.year_from, yearTo: row.year_to }));
  }
}

import type { AdminProductFitment } from "../../lib/admin/product-types";
import type { DatabaseExecutor } from "../types/common";
import { FITMENT_MATCHES_PRODUCT_SQL } from "./product-repository";

/**
 * Vehicle fitment of a product. The storefront vehicle filter does not use a
 * product-to-car table: it reads verified rows of `fitments` (generation or
 * modification + size) and matches them against tire_specs / wheel_specs
 * (FITMENT_MATCHES_PRODUCT_SQL). The admin therefore lists, adds and revokes
 * fitments by the product's size; every product of that size is affected.
 * product_fitments (legacy 1C protocol) is not used by the storefront.
 */

export type ProductFitmentSize =
  | { kind: "tire"; width: number; profile: number; diameter: number }
  | {
      kind: "wheel";
      diameter: number;
      width: number;
      boltCount: number;
      pcd: number;
      et: number | null;
      dia: number | null;
    };

interface SizeRow {
  kind: "tire" | "wheel";
  tire_width: number | null;
  tire_profile: number | null;
  tire_diameter: string | null;
  wheel_diameter: string | null;
  wheel_width: string | null;
  bolt_count: number | null;
  wheel_pcd: string | null;
  wheel_et: string | null;
  wheel_dia: string | null;
}

interface FitmentRow {
  id: string;
  make: string;
  model: string;
  generation: string;
  year_from: number | null;
  year_to: number | null;
  modification: string | null;
  axle: "all" | "front" | "rear";
  fitment_type: "factory" | "alternative" | "tuning";
  source: string;
  dia: string | null;
  et_min: string | null;
  et_max: string | null;
}

const toNumber = (value: string | number | null) => (value === null ? null : Number(value));

const FITMENT_VEHICLE_SELECT = `SELECT fitments.id, car_makes.name AS make, car_models.name AS model,
  car_generations.name AS generation, car_generations.year_from, car_generations.year_to,
  car_modifications.name AS modification, fitments.axle, fitments.fitment_type, fitments.source,
  fitments.dia, fitments.et_min, fitments.et_max`;

const PRODUCT_WITH_SPECS = `FROM products
  LEFT JOIN tire_specs ON tire_specs.product_id = products.id
  LEFT JOIN wheel_specs ON wheel_specs.product_id = products.id`;

const VEHICLE_JOINS = `JOIN car_generations ON car_generations.id = fitments.generation_id
  JOIN car_models ON car_models.id = car_generations.model_id
  JOIN car_makes ON car_makes.id = car_models.make_id
  LEFT JOIN car_modifications ON car_modifications.id = fitments.modification_id`;

function mapFitment(row: FitmentRow): AdminProductFitment {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    generation: row.generation,
    yearFrom: row.year_from,
    yearTo: row.year_to,
    modification: row.modification,
    axle: row.axle,
    fitmentType: row.fitment_type,
    source: row.source,
    dia: toNumber(row.dia),
    etMin: toNumber(row.et_min),
    etMax: toNumber(row.et_max),
  };
}

export class AdminCatalogFitmentRepository {
  /** Size from the typed specs the storefront matches; null while incomplete. */
  async findProductSize(database: DatabaseExecutor, productId: string): Promise<ProductFitmentSize | null | undefined> {
    const result = await database.query<SizeRow>(
      `SELECT products.kind, tire_specs.width AS tire_width, tire_specs.profile AS tire_profile,
         tire_specs.diameter AS tire_diameter, wheel_specs.diameter AS wheel_diameter,
         wheel_specs.width AS wheel_width, wheel_specs.bolt_count, wheel_specs.pcd AS wheel_pcd,
         wheel_specs.et AS wheel_et, wheel_specs.dia AS wheel_dia
       ${PRODUCT_WITH_SPECS}
       WHERE products.id = $1`,
      [productId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (row.kind === "tire") {
      if (row.tire_width === null || row.tire_profile === null || row.tire_diameter === null) return null;
      return { kind: "tire", width: row.tire_width, profile: row.tire_profile, diameter: Number(row.tire_diameter) };
    }
    if (row.wheel_diameter === null || row.wheel_width === null || row.bolt_count === null || row.wheel_pcd === null) return null;
    return {
      kind: "wheel",
      diameter: Number(row.wheel_diameter),
      width: Number(row.wheel_width),
      boltCount: row.bolt_count,
      pcd: Number(row.wheel_pcd),
      et: toNumber(row.wheel_et),
      dia: toNumber(row.wheel_dia),
    };
  }

  /** Verified fitments that the storefront applies to this product. */
  async listForProduct(database: DatabaseExecutor, productId: string): Promise<AdminProductFitment[]> {
    const result = await database.query<FitmentRow>(
      `${FITMENT_VEHICLE_SELECT}
       ${PRODUCT_WITH_SPECS}
       JOIN fitments ON fitments.verified = TRUE AND ${FITMENT_MATCHES_PRODUCT_SQL}
       ${VEHICLE_JOINS}
       WHERE products.id = $1
       ORDER BY LOWER(car_makes.name), LOWER(car_models.name), car_generations.year_from NULLS LAST,
         LOWER(car_generations.name), LOWER(COALESCE(car_modifications.name, '')), fitments.id
       LIMIT 500`,
      [productId],
    );
    return result.rows.map(mapFitment);
  }

  /** Other products with the same typed size (they share the fitments). */
  async countSameSizeProducts(database: DatabaseExecutor, productId: string): Promise<number> {
    const result = await database.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM products
       LEFT JOIN tire_specs ON tire_specs.product_id = products.id
       LEFT JOIN wheel_specs ON wheel_specs.product_id = products.id
       JOIN products other ON other.id <> products.id AND other.kind = products.kind
       LEFT JOIN tire_specs other_tire ON other_tire.product_id = other.id
       LEFT JOIN wheel_specs other_wheel ON other_wheel.product_id = other.id
       WHERE products.id = $1 AND (
         (products.kind = 'tire' AND other_tire.width = tire_specs.width
           AND other_tire.profile = tire_specs.profile AND other_tire.diameter = tire_specs.diameter)
         OR (products.kind = 'wheel' AND other_wheel.diameter = wheel_specs.diameter
           AND other_wheel.width = wheel_specs.width AND other_wheel.bolt_count = wheel_specs.bolt_count
           AND other_wheel.pcd = wheel_specs.pcd))`,
      [productId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async findGeneration(database: DatabaseExecutor, generationId: string): Promise<{ id: string } | null> {
    const result = await database.query<{ id: string }>(
      "SELECT id FROM car_generations WHERE id = $1 AND sync_status = 'active'",
      [generationId],
    );
    return result.rows[0] ?? null;
  }

  async findModification(database: DatabaseExecutor, modificationId: string): Promise<{ id: string; generation_id: string } | null> {
    const result = await database.query<{ id: string; generation_id: string }>(
      "SELECT id, generation_id FROM car_modifications WHERE id = $1 AND sync_status = 'active'",
      [modificationId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Adds (or re-verifies) a manual fitment for the size. The identity follows
   * fitments_import_identity_uq, so repeating an addition never duplicates.
   */
  async saveManualFitment(
    database: DatabaseExecutor,
    fitment: {
      generationId: string;
      modificationId: string | null;
      axle: "all" | "front" | "rear";
      fitmentType: "factory" | "alternative" | "tuning";
      size: ProductFitmentSize;
      dia: number | null;
      etMin: number | null;
      etMax: number | null;
      notes: string;
    },
  ): Promise<{ id: string; created: boolean }> {
    const tire = fitment.size.kind === "tire" ? fitment.size : null;
    const wheel = fitment.size.kind === "wheel" ? fitment.size : null;
    const values = [
      fitment.generationId, fitment.modificationId, fitment.size.kind, fitment.axle,
      fitment.fitmentType, tire?.width ?? null, tire?.profile ?? null, tire?.diameter ?? null,
      wheel?.diameter ?? null, wheel?.width ?? null, wheel?.boltCount ?? null, wheel?.pcd ?? null,
      wheel ? fitment.dia : null, wheel ? fitment.etMin : null, wheel ? fitment.etMax : null,
      fitment.notes,
    ];
    const inserted = await database.query<{ id: string }>(
      `INSERT INTO fitments (generation_id, modification_id, product_type, axle, fitment_type,
         tire_width, tire_profile, tire_diameter, wheel_diameter, wheel_width, bolt_count, pcd,
         dia, et_min, et_max, source, verified, verified_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'manual', TRUE, NOW(), $16)
       ON CONFLICT DO NOTHING RETURNING id`,
      values,
    );
    if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };
    const updated = await database.query<{ id: string }>(
      `UPDATE fitments SET verified = TRUE, verified_at = NOW(), notes = $16, updated_at = NOW()
       WHERE generation_id = $1 AND modification_id IS NOT DISTINCT FROM $2::uuid
         AND product_type = $3 AND axle = $4 AND fitment_type = $5
         AND tire_width IS NOT DISTINCT FROM $6::integer
         AND tire_profile IS NOT DISTINCT FROM $7::integer
         AND tire_diameter IS NOT DISTINCT FROM $8::numeric
         AND wheel_diameter IS NOT DISTINCT FROM $9::numeric
         AND wheel_width IS NOT DISTINCT FROM $10::numeric
         AND bolt_count IS NOT DISTINCT FROM $11::smallint
         AND pcd IS NOT DISTINCT FROM $12::numeric
         AND dia IS NOT DISTINCT FROM $13::numeric
         AND et_min IS NOT DISTINCT FROM $14::numeric
         AND et_max IS NOT DISTINCT FROM $15::numeric
         AND source = 'manual'
       RETURNING id`,
      values,
    );
    return { id: updated.rows[0].id, created: false };
  }

  /** A verified fitment that applies to this product, locked for revocation. */
  async findProductFitmentForUpdate(
    database: DatabaseExecutor,
    productId: string,
    fitmentId: string,
  ): Promise<AdminProductFitment | null> {
    const result = await database.query<FitmentRow>(
      `${FITMENT_VEHICLE_SELECT}
       ${PRODUCT_WITH_SPECS}
       JOIN fitments ON fitments.id = $2 AND fitments.verified = TRUE AND ${FITMENT_MATCHES_PRODUCT_SQL}
       ${VEHICLE_JOINS}
       WHERE products.id = $1
       FOR UPDATE OF fitments`,
      [productId, fitmentId],
    );
    return result.rows[0] ? mapFitment(result.rows[0]) : null;
  }

  /** Revocation keeps the row (history, re-adding) and removes it from the storefront filter. */
  async revoke(database: DatabaseExecutor, fitmentId: string, notes: string): Promise<void> {
    await database.query(
      "UPDATE fitments SET verified = FALSE, verified_at = NULL, notes = $2, updated_at = NOW() WHERE id = $1",
      [fitmentId, notes],
    );
  }
}

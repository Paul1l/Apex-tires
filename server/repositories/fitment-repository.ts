import type { DatabaseExecutor } from "../types/common";
import type { VehicleSelection } from "../integrations/fitment/fitment-provider";
import type { NormalizedFitmentImport } from "../validators/fitment-import-schema";
import { createEntitySlug } from "../utils/product-slug";

export interface FitmentOption {
  value: string;
}

export interface FitmentMatchRow {
  product_id: string;
  data_source: "manual" | "import" | "external_api";
  verified_at: Date | string | null;
}

export interface TechnicalFitmentRow {
  product_type: "tire" | "wheel";
  axle: "all" | "front" | "rear";
  fitment_type: "factory" | "alternative" | "tuning";
  tire_width: number | null;
  tire_profile: number | null;
  tire_diameter: number | string | null;
  wheel_diameter: number | string | null;
  wheel_width: number | string | null;
  bolt_count: number | null;
  pcd: number | string | null;
  dia: number | string | null;
  et_min: number | string | null;
  et_max: number | string | null;
}

export class FitmentRepository {
  async listMakes(database: DatabaseExecutor): Promise<string[]> {
    const result = await database.query<FitmentOption>(
      `SELECT car_makes.name AS value FROM car_makes
       WHERE car_makes.sync_status = 'active' AND EXISTS (
         SELECT 1 FROM car_models JOIN car_generations ON car_generations.model_id=car_models.id
         JOIN fitments ON fitments.generation_id=car_generations.id
         WHERE car_models.make_id=car_makes.id AND fitments.verified=TRUE
       ) ORDER BY car_makes.name COLLATE "C"`,
    );
    return result.rows.map((row) => row.value);
  }

  async listModels(
    database: DatabaseExecutor,
    make: string,
    year?: number,
  ): Promise<string[]> {
    const result = await database.query<FitmentOption>(
      `SELECT DISTINCT car_models.name COLLATE "C" AS value
       FROM car_models JOIN car_makes ON car_makes.id=car_models.make_id
       JOIN car_generations ON car_generations.model_id=car_models.id
       JOIN fitments ON fitments.generation_id=car_generations.id
       WHERE fitments.verified=TRUE AND LOWER(car_makes.name)=LOWER($1)
         AND ($2::integer IS NULL OR car_generations.year_from IS NULL OR car_generations.year_from <= $2)
         AND ($2::integer IS NULL OR car_generations.year_to IS NULL OR car_generations.year_to >= $2)
       ORDER BY value`,
      [make, year ?? null],
    );
    return result.rows.map((row) => row.value);
  }

  async listGenerations(
    database: DatabaseExecutor,
    vehicle: Pick<VehicleSelection, "make" | "model" | "year">,
  ): Promise<string[]> {
    const result = await database.query<FitmentOption>(
      `SELECT DISTINCT car_generations.name COLLATE "C" AS value
       FROM car_generations JOIN car_models ON car_models.id=car_generations.model_id
       JOIN car_makes ON car_makes.id=car_models.make_id
       JOIN fitments ON fitments.generation_id=car_generations.id
       WHERE fitments.verified=TRUE AND LOWER(car_makes.name)=LOWER($1)
         AND LOWER(car_models.name)=LOWER($2)
         AND ($3::integer IS NULL OR car_generations.year_from IS NULL OR car_generations.year_from <= $3)
         AND ($3::integer IS NULL OR car_generations.year_to IS NULL OR car_generations.year_to >= $3)
       ORDER BY value`,
      [vehicle.make, vehicle.model, vehicle.year ?? null],
    );
    return result.rows.map((row) => row.value);
  }


  async listModifications(
    database: DatabaseExecutor,
    vehicle: Pick<VehicleSelection, "make" | "model" | "generation">,
  ): Promise<string[]> {
    const result = await database.query<FitmentOption>(
      `SELECT DISTINCT car_modifications.name COLLATE "C" AS value
       FROM car_modifications JOIN car_generations ON car_generations.id=car_modifications.generation_id
       JOIN car_models ON car_models.id=car_generations.model_id
       JOIN car_makes ON car_makes.id=car_models.make_id
       JOIN fitments ON fitments.modification_id=car_modifications.id
       WHERE fitments.verified=TRUE AND LOWER(car_makes.name)=LOWER($1)
         AND LOWER(car_models.name)=LOWER($2) AND LOWER(car_generations.name)=LOWER($3)
       ORDER BY value`,
      [vehicle.make, vehicle.model, vehicle.generation ?? ""],
    );
    return result.rows.map((row) => row.value);
  }

  async getTechnicalFitments(database: DatabaseExecutor, vehicle: VehicleSelection): Promise<TechnicalFitmentRow[]> {
    const result = await database.query<TechnicalFitmentRow>(
      `SELECT DISTINCT fitments.product_type, fitments.axle, fitments.fitment_type,
         fitments.tire_width, fitments.tire_profile, fitments.tire_diameter,
         fitments.wheel_diameter, fitments.wheel_width, fitments.bolt_count,
         fitments.pcd, fitments.dia, fitments.et_min, fitments.et_max
       FROM fitments JOIN car_generations ON car_generations.id=fitments.generation_id
       JOIN car_models ON car_models.id=car_generations.model_id
       JOIN car_makes ON car_makes.id=car_models.make_id
       LEFT JOIN car_modifications ON car_modifications.id=fitments.modification_id
       WHERE fitments.verified=TRUE AND LOWER(car_makes.name)=LOWER($1)
         AND LOWER(car_models.name)=LOWER($2)
         AND ($3::text IS NULL OR LOWER(car_generations.name)=LOWER($3))
         AND (car_modifications.id IS NULL OR LOWER(car_modifications.name)=LOWER($4))
       LIMIT 500`,
      [vehicle.make, vehicle.model, vehicle.generation ?? null, vehicle.modification ?? null],
    );
    return result.rows;
  }

  async upsertNormalized(database: DatabaseExecutor, fitment: NormalizedFitmentImport): Promise<boolean> {
    const make = await database.query<{ id: string }>(
      `INSERT INTO car_makes(name,slug) VALUES($1,$2)
       ON CONFLICT(LOWER(name)) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [fitment.make, createEntitySlug(fitment.make)],
    );
    const model = await database.query<{ id: string }>(
      `INSERT INTO car_models(make_id,name,slug) VALUES($1,$2,$3)
       ON CONFLICT(make_id,slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [make.rows[0].id, fitment.model, createEntitySlug(fitment.model)],
    );
    const generation = await database.query<{ id: string }>(
      `INSERT INTO car_generations(model_id,name,slug,year_from,year_to)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(model_id,slug) DO UPDATE SET
         name=EXCLUDED.name,year_from=EXCLUDED.year_from,year_to=EXCLUDED.year_to RETURNING id`,
      [model.rows[0].id, fitment.generation, createEntitySlug(fitment.generation), fitment.yearFrom ?? null, fitment.yearTo ?? null],
    );
    let modificationId: string | null = null;
    if (fitment.modification) {
      const modification = await database.query<{ id: string }>(
        `INSERT INTO car_modifications(generation_id,name,engine,year_from,year_to)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(generation_id,name) DO UPDATE SET
           engine=EXCLUDED.engine,year_from=EXCLUDED.year_from,year_to=EXCLUDED.year_to RETURNING id`,
        [generation.rows[0].id, fitment.modification, fitment.engine ?? null, fitment.yearFrom ?? null, fitment.yearTo ?? null],
      );
      modificationId = modification.rows[0].id;
    }
    const inserted = await database.query<{ id: string }>(
      `INSERT INTO fitments(generation_id,modification_id,product_type,axle,fitment_type,
         tire_width,tire_profile,tire_diameter,wheel_diameter,wheel_width,bolt_count,
         pcd,dia,et_min,et_max,source,verified,verified_at,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT DO NOTHING RETURNING id`,
      [generation.rows[0].id, modificationId, fitment.productType, fitment.axle,
        fitment.fitmentType, fitment.tireWidth ?? null, fitment.tireProfile ?? null,
        fitment.tireDiameter ?? null, fitment.wheelDiameter ?? null, fitment.wheelWidth ?? null,
        fitment.boltCount ?? null, fitment.pcd ?? null, fitment.dia ?? null,
        fitment.etMin ?? null, fitment.etMax ?? null, fitment.source, fitment.verified,
        fitment.verifiedAt ?? null, fitment.notes ?? null],
    );
    if (inserted.rowCount === 0) {
      await database.query(
        `UPDATE fitments SET verified=$17, verified_at=$18, notes=$19, updated_at=NOW()
         WHERE generation_id=$1 AND modification_id IS NOT DISTINCT FROM $2::uuid
           AND product_type=$3 AND axle=$4 AND fitment_type=$5
           AND tire_width IS NOT DISTINCT FROM $6::integer
           AND tire_profile IS NOT DISTINCT FROM $7::integer
           AND tire_diameter IS NOT DISTINCT FROM $8::numeric
           AND wheel_diameter IS NOT DISTINCT FROM $9::numeric
           AND wheel_width IS NOT DISTINCT FROM $10::numeric
           AND bolt_count IS NOT DISTINCT FROM $11::smallint
           AND pcd IS NOT DISTINCT FROM $12::numeric
           AND dia IS NOT DISTINCT FROM $13::numeric
           AND et_min IS NOT DISTINCT FROM $14::numeric
           AND et_max IS NOT DISTINCT FROM $15::numeric AND source=$16`,
        [generation.rows[0].id, modificationId, fitment.productType, fitment.axle,
          fitment.fitmentType, fitment.tireWidth ?? null, fitment.tireProfile ?? null,
          fitment.tireDiameter ?? null, fitment.wheelDiameter ?? null, fitment.wheelWidth ?? null,
          fitment.boltCount ?? null, fitment.pcd ?? null, fitment.dia ?? null,
          fitment.etMin ?? null, fitment.etMax ?? null, fitment.source, fitment.verified,
          fitment.verifiedAt ?? null, fitment.notes ?? null],
      );
    }
    return inserted.rowCount === 1;
  }
}

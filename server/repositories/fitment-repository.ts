import type { DatabaseExecutor } from "../types/common";
import type { VehicleSelection } from "../integrations/fitment/fitment-provider";

export interface FitmentOption {
  value: string;
}

export interface FitmentMatchRow {
  product_id: string;
  data_source: "manual" | "import" | "external_api";
  verified_at: Date | string | null;
}

export class FitmentRepository {
  async listMakes(database: DatabaseExecutor): Promise<string[]> {
    const result = await database.query<FitmentOption>(
      `SELECT DISTINCT make AS value
       FROM product_fitments
       WHERE verified = TRUE
       ORDER BY make COLLATE "C"`,
    );
    return result.rows.map((row) => row.value);
  }

  async listModels(
    database: DatabaseExecutor,
    make: string,
    year?: number,
  ): Promise<string[]> {
    const result = await database.query<FitmentOption>(
      `SELECT DISTINCT model AS value
       FROM product_fitments
       WHERE verified = TRUE
         AND LOWER(make) = LOWER($1)
         AND ($2::integer IS NULL OR year_from IS NULL OR year_from <= $2)
         AND ($2::integer IS NULL OR year_to IS NULL OR year_to >= $2)
       ORDER BY model COLLATE "C"`,
      [make, year ?? null],
    );
    return result.rows.map((row) => row.value);
  }

  async listGenerations(
    database: DatabaseExecutor,
    vehicle: Pick<VehicleSelection, "make" | "model" | "year">,
  ): Promise<string[]> {
    const result = await database.query<FitmentOption>(
      `SELECT DISTINCT generation AS value
       FROM product_fitments
       WHERE verified = TRUE
         AND generation IS NOT NULL
         AND generation <> ''
         AND LOWER(make) = LOWER($1)
         AND LOWER(model) = LOWER($2)
         AND ($3::integer IS NULL OR year_from IS NULL OR year_from <= $3)
         AND ($3::integer IS NULL OR year_to IS NULL OR year_to >= $3)
       ORDER BY generation COLLATE "C"`,
      [vehicle.make, vehicle.model, vehicle.year ?? null],
    );
    return result.rows.map((row) => row.value);
  }

  async findMatches(
    database: DatabaseExecutor,
    vehicle: VehicleSelection,
  ): Promise<FitmentMatchRow[]> {
    const result = await database.query<FitmentMatchRow>(
      `SELECT DISTINCT product_id, data_source, verified_at
       FROM product_fitments
       WHERE verified = TRUE
         AND LOWER(make) = LOWER($1)
         AND LOWER(model) = LOWER($2)
         AND ($3::text IS NULL OR generation IS NULL OR LOWER(generation) = LOWER($3))
         AND ($4::integer IS NULL OR year_from IS NULL OR year_from <= $4)
         AND ($4::integer IS NULL OR year_to IS NULL OR year_to >= $4)
         AND ($5::text IS NULL OR modification IS NULL OR LOWER(modification) = LOWER($5))`,
      [
        vehicle.make,
        vehicle.model,
        vehicle.generation ?? null,
        vehicle.year ?? null,
        vehicle.modification ?? null,
      ],
    );
    return result.rows;
  }
}

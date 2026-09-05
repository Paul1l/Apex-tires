import type { Pool } from "pg";
import { FitmentRepository } from "../../repositories/fitment-repository";
import type {
  FitmentProvider,
  VehicleSelection,
  VerifiedFitmentResult,
} from "./fitment-provider";

export class LocalFitmentProvider implements FitmentProvider {
  constructor(
    private readonly pool: Pool,
    private readonly repository: FitmentRepository,
  ) {}

  listMakes(): Promise<string[]> {
    return this.repository.listMakes(this.pool);
  }

  listModels(make: string, year?: number): Promise<string[]> {
    return this.repository.listModels(this.pool, make, year);
  }

  listGenerations(
    vehicle: Pick<VehicleSelection, "make" | "model" | "year">,
  ): Promise<string[]> {
    return this.repository.listGenerations(this.pool, vehicle);
  }

  async findCompatibleProducts(
    vehicle: VehicleSelection,
  ): Promise<VerifiedFitmentResult> {
    const matches = await this.repository.findMatches(this.pool, vehicle);
    const verifiedDates = matches
      .map((match) => match.verified_at)
      .filter(Boolean)
      .map((value) => new Date(value as Date | string).toISOString())
      .sort();
    return {
      productIds: matches.map((match) => match.product_id),
      source: matches[0]?.data_source ?? "manual",
      verified: matches.length > 0,
      verifiedAt: verifiedDates.at(-1) ?? null,
    };
  }
}

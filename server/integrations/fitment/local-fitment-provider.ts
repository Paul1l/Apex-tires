import type { Pool } from "pg";
import { FitmentRepository } from "../../repositories/fitment-repository";
import type {
  FitmentProvider,
  VehicleSelection,
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

  listModifications(
    vehicle: Pick<VehicleSelection, "make" | "model" | "generation">,
  ): Promise<string[]> {
    return this.repository.listModifications(this.pool, vehicle);
  }

  getFitments(vehicle: VehicleSelection) {
    return this.repository.getTechnicalFitments(this.pool, vehicle);
  }

}

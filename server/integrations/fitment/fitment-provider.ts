export interface VehicleSelection {
  make: string;
  model: string;
  generation?: string;
  year?: number;
  modification?: string;
}

export interface FitmentProvider {
  listMakes(): Promise<string[]>;
  listModels(make: string, year?: number): Promise<string[]>;
  listGenerations(vehicle: Pick<VehicleSelection, "make" | "model" | "year">): Promise<string[]>;
  listModifications(vehicle: Pick<VehicleSelection, "make" | "model" | "generation">): Promise<string[]>;
  getFitments(vehicle: VehicleSelection): Promise<unknown[]>;
}

// AI may parse a query, but it must never implement this verification contract.

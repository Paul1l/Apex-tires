export interface VehicleSelection {
  make: string;
  model: string;
  generation?: string;
  year?: number;
  modification?: string;
}

export interface VerifiedFitmentResult {
  productIds: string[];
  source: "manual" | "import" | "external_api";
  verified: boolean;
  verifiedAt: string | null;
}

export interface FitmentProvider {
  findCompatibleProducts(
    vehicle: VehicleSelection,
  ): Promise<VerifiedFitmentResult>;
}

// AI may parse a query, but it must never implement this verification contract.

import type { Pool } from "pg";
import {
  FitmentRequestRepository,
  type CreatedFitmentRequest,
} from "../repositories/fitment-request-repository";
import type { CreateFitmentRequestInput } from "../validators/fitment-request-schema";

export class FitmentRequestService {
  constructor(
    private readonly pool: Pool,
    private readonly repository: FitmentRequestRepository,
  ) {}

  create(request: CreateFitmentRequestInput): Promise<CreatedFitmentRequest> {
    return this.repository.create(this.pool, request);
  }
}

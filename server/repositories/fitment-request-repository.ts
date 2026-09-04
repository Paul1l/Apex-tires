import type { DatabaseExecutor } from "../types/common";
import type { CreateFitmentRequestInput } from "../validators/fitment-request-schema";

export interface CreatedFitmentRequest {
  id: string;
  status: "new";
  created_at: Date | string;
}

export class FitmentRequestRepository {
  async create(
    database: DatabaseExecutor,
    request: CreateFitmentRequestInput,
  ): Promise<CreatedFitmentRequest> {
    const result = await database.query<CreatedFitmentRequest>(
      `INSERT INTO vehicle_fitment_requests (
         make, model, model_year, generation, modification, customer_name,
         customer_phone, consent_document_version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, status, created_at`,
      [
        request.make,
        request.model,
        request.year ?? null,
        request.generation ?? null,
        request.modification ?? null,
        request.customerName,
        request.customerPhone,
        "2026-09-04",
      ],
    );
    return result.rows[0];
  }
}

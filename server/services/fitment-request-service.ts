import type { Pool } from "pg";
import {
  FitmentRequestRepository,
  type CreatedFitmentRequest,
} from "../repositories/fitment-request-repository";
import type { CreateFitmentRequestInput } from "../validators/fitment-request-schema";
import { withTransaction } from "../database/postgres-client";
import { NotificationOutboxRepository } from "../repositories/notification-outbox-repository";

export class FitmentRequestService {
  constructor(
    private readonly pool: Pool,
    private readonly repository: FitmentRequestRepository,
    private readonly notificationRepository: NotificationOutboxRepository,
    private readonly managerEmail?: string,
  ) {}

  create(request: CreateFitmentRequestInput): Promise<CreatedFitmentRequest> {
    return withTransaction(this.pool, async (database) => {
      const createdRequest = await this.repository.create(database, request);
      if (this.managerEmail) {
        await this.notificationRepository.enqueue(database, {
          channel: "email",
          template: "manager-fitment-request-created",
          recipient: this.managerEmail,
          payload: { requestId: createdRequest.id },
        });
      }
      return createdRequest;
    });
  }
}

import type { Pool } from "pg";
import { getManagerNotificationEmail } from "../../lib/site-settings";
import {
  FitmentRequestRepository,
  type CreatedFitmentRequest,
} from "../repositories/fitment-request-repository";
import type { CreateFitmentRequestInput } from "../validators/fitment-request-schema";
import { withTransaction } from "../database/postgres-client";
import { NotificationOutboxRepository } from "../repositories/notification-outbox-repository";
import { readSiteSettings, type SiteSettingsReader } from "./site-settings-store";

export class FitmentRequestService {
  /**
   * `readSettings` gives the manager notification address saved in the admin
   * («Настройки» → contacts), read in the request's transaction; build-time
   * defaults when nothing is saved.
   */
  constructor(
    private readonly pool: Pool,
    private readonly repository: Pick<FitmentRequestRepository, "create">,
    private readonly notificationRepository: Pick<NotificationOutboxRepository, "enqueue">,
    private readonly readSettings: SiteSettingsReader = readSiteSettings,
  ) {}

  create(request: CreateFitmentRequestInput): Promise<CreatedFitmentRequest> {
    return withTransaction(this.pool, async (database) => {
      const createdRequest = await this.repository.create(database, request);
      const managerEmail = getManagerNotificationEmail(await this.readSettings(database));
      if (managerEmail) {
        await this.notificationRepository.enqueue(database, {
          channel: "email",
          template: "manager-fitment-request-created",
          recipient: managerEmail,
          payload: { requestId: createdRequest.id },
        });
      }
      return createdRequest;
    });
  }
}

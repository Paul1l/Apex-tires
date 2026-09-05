import type { Pool } from "pg";
import { withTransaction } from "../database/postgres-client";
import type { NotificationProvider } from "../integrations/notifications/notification-provider";
import { NotificationOutboxRepository } from "../repositories/notification-outbox-repository";
import type { ApplicationLogger } from "../types/common";

export class NotificationService {
  constructor(
    private readonly pool: Pool,
    private readonly repository: NotificationOutboxRepository,
    private readonly providers: NotificationProvider[],
    private readonly logger: ApplicationLogger,
  ) {}

  async processPending(limit = 20): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (let index = 0; index < limit; index += 1) {
      const notification = await withTransaction(this.pool, (database) =>
        this.repository.claimNext(database),
      );
      if (!notification) break;
      const provider = this.providers.find(
        (candidate) => candidate.channel === notification.channel,
      );
      if (!provider) {
        await this.repository.markFailed(
          this.pool,
          notification.id,
          "Канал уведомлений не настроен.",
        );
        failed += 1;
        continue;
      }
      try {
        await provider.send(notification);
        await this.repository.markSent(this.pool, notification.id);
        sent += 1;
      } catch (error) {
        this.logger.error({ error, notificationId: notification.id }, "Notification delivery failed");
        await this.repository.markFailed(
          this.pool,
          notification.id,
          "Провайдер временно не принял уведомление.",
        );
        failed += 1;
      }
    }
    return { sent, failed };
  }
}

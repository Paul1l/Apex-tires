import type { DatabaseExecutor, JsonValue } from "../types/common";

export interface NotificationOutboxItem {
  id: string;
  channel: "email" | "telegram";
  template: string;
  recipient: string;
  payload: JsonValue;
}

export class NotificationOutboxRepository {
  async enqueue(
    database: DatabaseExecutor,
    notification: Omit<NotificationOutboxItem, "id">,
  ): Promise<void> {
    await database.query(
      `INSERT INTO notification_outbox (channel, template, recipient, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        notification.channel,
        notification.template,
        notification.recipient,
        JSON.stringify(notification.payload),
      ],
    );
  }

  async claimNext(
    database: DatabaseExecutor,
  ): Promise<NotificationOutboxItem | null> {
    const result = await database.query<NotificationOutboxItem>(
      `WITH selected AS (
         SELECT id FROM notification_outbox
         WHERE
           (status IN ('pending', 'failed') AND next_attempt_at <= NOW())
           OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes')
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE notification_outbox outbox
       SET status = 'processing', updated_at = NOW()
       FROM selected
       WHERE outbox.id = selected.id
       RETURNING outbox.id, outbox.channel, outbox.template,
                 outbox.recipient, outbox.payload`,
    );
    return result.rows[0] ?? null;
  }

  /** Notifications not delivered yet (pending, waiting for a retry or in progress). */
  async countUnsent(database: DatabaseExecutor): Promise<number> {
    const result = await database.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM notification_outbox WHERE status <> 'sent'",
    );
    return result.rows[0]?.count ?? 0;
  }

  async markSent(database: DatabaseExecutor, id: string): Promise<void> {
    await database.query(
      `UPDATE notification_outbox
       SET status = 'sent', sent_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [id],
    );
  }

  async markFailed(
    database: DatabaseExecutor,
    id: string,
    safeError: string,
  ): Promise<void> {
    await database.query(
      `UPDATE notification_outbox
       SET status = 'failed', retry_count = retry_count + 1,
           last_error = $2,
           next_attempt_at = NOW() + LEAST(
             INTERVAL '1 hour',
             INTERVAL '1 minute' * POWER(2, retry_count)
           ),
           updated_at = NOW()
       WHERE id = $1`,
      [id, safeError],
    );
  }
}

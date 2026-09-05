import type { DatabaseExecutor, JsonValue } from "../types/common";

export class AdminAuditRepository {
  async record(
    database: DatabaseExecutor,
    event: {
      actorUserId: string;
      action: string;
      entityType: string;
      entityId?: string;
      details: JsonValue;
    },
  ): Promise<void> {
    await database.query(
      `INSERT INTO admin_audit_log (
         actor_user_id, action, entity_type, entity_id, details
       ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        event.actorUserId,
        event.action,
        event.entityType,
        event.entityId ?? null,
        JSON.stringify(event.details),
      ],
    );
  }
}

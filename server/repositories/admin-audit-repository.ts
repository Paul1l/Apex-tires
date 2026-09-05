import type { DatabaseExecutor, JsonValue } from "../types/common";

export class AdminAuditRepository {
  async record(
    database: DatabaseExecutor,
    event: {
      actorUserId: string;
      action: string;
      entityType: string;
      details: JsonValue;
    },
  ): Promise<void> {
    await database.query(
      `INSERT INTO admin_audit_log (
         actor_user_id, action, entity_type, details
       ) VALUES ($1, $2, $3, $4::jsonb)`,
      [
        event.actorUserId,
        event.action,
        event.entityType,
        JSON.stringify(event.details),
      ],
    );
  }
}

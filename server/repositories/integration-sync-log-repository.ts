import type { DatabaseExecutor } from "../types/common";

export interface SynchronizationRecordError {
  index: number;
  externalId?: string;
  code: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}

export interface SynchronizationResponse {
  ok: boolean;
  idempotencyKey: string;
  processed: number;
  failed: number;
  errors: SynchronizationRecordError[];
  duplicate?: boolean;
}

interface StartSyncLogInput {
  sourceSystem: string;
  entityType: string;
  operation: string;
  direction: "incoming" | "outgoing";
  idempotencyKey: string;
  syncMode?: "full" | "incremental";
  cursor?: string;
  recordsReceived: number;
}

interface CompleteSyncLogInput {
  status: "success" | "partial" | "failed";
  processed: number;
  failed: number;
  errorSummary?: string | null;
  response: SynchronizationResponse;
}

export interface IntegrationSyncSummary {
  last_success_at: string | null;
  products_processed_24h: number;
  error_runs: number;
  recentErrors: Array<{
    entity_type: string;
    operation: string;
    status: string;
    error_summary: string | null;
    started_at: string;
  }>;
}

export class IntegrationSyncLogRepository {
  async findByIdempotencyKey(
    database: DatabaseExecutor,
    idempotencyKey: string,
  ): Promise<{
    id: string;
    status: string;
    result_summary: SynchronizationResponse;
  } | null> {
    const result = await database.query<{
      id: string;
      status: string;
      result_summary: SynchronizationResponse;
    }>(
      `SELECT id, status, result_summary
       FROM integration_sync_logs
       WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async start(
    database: DatabaseExecutor,
    input: StartSyncLogInput,
  ): Promise<string | null> {
    const result = await database.query<{ id: string }>(
      `INSERT INTO integration_sync_logs (
         source_system, entity_type, operation, direction, idempotency_key,
         sync_mode, cursor_value, status, records_received
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', $8)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        input.sourceSystem,
        input.entityType,
        input.operation,
        input.direction,
        input.idempotencyKey,
        input.syncMode ?? null,
        input.cursor ?? null,
        input.recordsReceived,
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  async complete(
    database: DatabaseExecutor,
    syncLogId: string,
    result: CompleteSyncLogInput,
  ): Promise<void> {
    await database.query(
      `UPDATE integration_sync_logs
       SET finished_at = NOW(), status = $2, records_processed = $3,
           records_failed = $4, error_summary = $5, result_summary = $6::jsonb
       WHERE id = $1`,
      [
        syncLogId,
        result.status,
        result.processed,
        result.failed,
        result.errorSummary ?? null,
        JSON.stringify(result.response),
      ],
    );
  }

  async recordErrors(
    database: DatabaseExecutor,
    syncLogId: string,
    errors: SynchronizationRecordError[],
  ): Promise<void> {
    for (const error of errors) {
      await database.query(
        `INSERT INTO integration_sync_errors (
           sync_log_id, record_index, external_id, error_code, safe_message
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          syncLogId,
          error.index,
          error.externalId ?? null,
          error.code,
          error.message,
        ],
      );
    }
  }

  async getLatestSummary(
    database: DatabaseExecutor,
  ): Promise<IntegrationSyncSummary> {
    const summaryResult = await database.query<
      Omit<IntegrationSyncSummary, "recentErrors">
    >(
      `SELECT
         MAX(finished_at) FILTER (WHERE status = 'success') AS last_success_at,
         COALESCE(SUM(records_processed) FILTER (
           WHERE entity_type = 'products' AND started_at >= NOW() - INTERVAL '24 hours'
         ), 0)::integer AS products_processed_24h,
         COUNT(*) FILTER (WHERE status IN ('partial', 'failed'))::integer AS error_runs
       FROM integration_sync_logs
       WHERE source_system = '1c'`,
    );

    const recentErrorsResult = await database.query<
      IntegrationSyncSummary["recentErrors"][number]
    >(
      `SELECT entity_type, operation, status, error_summary, started_at
       FROM integration_sync_logs
       WHERE source_system = '1c' AND status IN ('partial', 'failed')
       ORDER BY started_at DESC
       LIMIT 10`,
    );

    return {
      ...summaryResult.rows[0],
      recentErrors: recentErrorsResult.rows,
    };
  }
}

import type { DatabaseExecutor, JsonValue } from "../types/common";

export type ImportJobType = "products_csv" | "fitments_csv";
export type ImportJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "failed";

export interface PersistedImportError {
  rowNumber: number;
  sku?: string;
  field?: string;
  errorCode: string;
  message: string;
  rawValue?: string;
}

export interface ImportProgress {
  totalRows: number;
  processedRows: number;
  createdRows: number;
  updatedRows: number;
  failedRows: number;
}

export class ImportJobRepository {
  async create(
    database: DatabaseExecutor,
    input: { type: ImportJobType; filename: string; createdBy?: string },
  ): Promise<string> {
    const result = await database.query<{ id: string }>(
      `INSERT INTO import_jobs (import_type, filename, status, created_by)
       VALUES ($1, $2, 'queued', $3) RETURNING id`,
      [input.type, input.filename, input.createdBy ?? null],
    );
    return result.rows[0].id;
  }

  async start(database: DatabaseExecutor, jobId: string): Promise<void> {
    await database.query(
      `UPDATE import_jobs SET status = 'processing', started_at = NOW() WHERE id = $1`,
      [jobId],
    );
  }

  async updateProgress(
    database: DatabaseExecutor,
    jobId: string,
    progress: ImportProgress,
  ): Promise<void> {
    await database.query(
      `UPDATE import_jobs SET total_rows = $2, processed_rows = $3,
         created_rows = $4, updated_rows = $5, failed_rows = $6
       WHERE id = $1`,
      [jobId, progress.totalRows, progress.processedRows, progress.createdRows, progress.updatedRows, progress.failedRows],
    );
  }

  async addErrors(
    database: DatabaseExecutor,
    jobId: string,
    errors: PersistedImportError[],
  ): Promise<void> {
    if (errors.length === 0) return;
    await database.query(
      `INSERT INTO import_job_errors
         (job_id, row_number, sku, field, error_code, message, raw_value)
       SELECT $1, item.row_number, item.sku, item.field, item.error_code,
         item.message, item.raw_value
       FROM jsonb_to_recordset($2::jsonb) AS item(
         row_number integer, sku text, field text, error_code text,
         message text, raw_value text
       )`,
      [
        jobId,
        JSON.stringify(errors.map((error) => ({
          row_number: error.rowNumber,
          sku: error.sku ?? null,
          field: error.field ?? null,
          error_code: error.errorCode,
          message: error.message,
          raw_value: error.rawValue ?? null,
        }))),
      ],
    );
  }

  async rememberProductKeys(
    database: DatabaseExecutor,
    jobId: string,
    externalIds: string[],
  ): Promise<void> {
    if (externalIds.length === 0) return;
    await database.query(
      `INSERT INTO import_job_product_keys (job_id, external_id)
       SELECT $1, UNNEST($2::text[]) ON CONFLICT DO NOTHING`,
      [jobId, externalIds],
    );
  }

  async finish(
    database: DatabaseExecutor,
    jobId: string,
    status: ImportJobStatus,
    errorSummary?: string,
  ): Promise<void> {
    await database.query(
      `UPDATE import_jobs SET status = $2, error_summary = $3,
         finished_at = NOW() WHERE id = $1`,
      [jobId, status, errorSummary ?? null],
    );
  }

  async list(database: DatabaseExecutor, limit = 50): Promise<JsonValue[]> {
    const result = await database.query<Record<string, JsonValue>>(
      `SELECT id, import_type, filename, status, total_rows, processed_rows,
         created_rows, updated_rows, failed_rows, started_at, finished_at,
         error_summary, created_at
       FROM import_jobs ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows;
  }
}

import type { Pool } from "pg";
import { withTransaction } from "../database/postgres-client";
import {
  retryWhileDatabaseUnavailable,
  type DatabaseRetryOptions,
} from "../database/database-retry";
import { parseCsvStream, type CsvRecord } from "../imports/csv-parser";
import { ProductRepository } from "../repositories/product-repository";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import { applicationLogger, type DatabaseExecutor, type JsonValue } from "../types/common";
import { ImportJobRepository } from "../repositories/import-job-repository";
import { FitmentRepository } from "../repositories/fitment-repository";
import { normalizedFitmentImportSchema } from "../validators/fitment-import-schema";
import {
  formatValidationIssues,
  priceSchema,
  productSchema,
  stockSchema,
  type PriceSyncItem,
  type ProductSyncItem,
  type StockSyncItem,
} from "../validators/one-c-schemas";

/** An import without a committed batch for this long is considered dead. */
export const DEFAULT_STALE_IMPORT_MINUTES = 30;

/** IMPORT_JOB_STALE_MINUTES: 1–1440, otherwise the default (30). */
export function readStaleImportMinutes(value = process.env.IMPORT_JOB_STALE_MINUTES): number {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440
    ? minutes
    : DEFAULT_STALE_IMPORT_MINUTES;
}

export function staleImportReason(minutes: number): string {
  return `Импорт прерван: нет признаков работы ${minutes} мин.`;
}

/**
 * Marks dead imports (queued/processing without progress for the threshold)
 * as failed. Called before an import starts and before the admin reads the
 * job list, so a job whose final status was lost never stays "processing".
 */
export async function failStaleImportJobs(
  database: DatabaseExecutor,
  repository = new ImportJobRepository(),
  staleMinutes = readStaleImportMinutes(),
): Promise<string[]> {
  const ids = await repository.failStale(database, staleMinutes, staleImportReason(staleMinutes));
  if (ids.length > 0) {
    applicationLogger.warn({ jobIds: ids.join(","), staleMinutes }, "Stale CSV import jobs marked failed");
  }
  return ids;
}

export interface CatalogImportServiceOptions {
  /** Retries of the final "failed" status while PostgreSQL is unavailable. */
  statusRetry?: DatabaseRetryOptions;
  staleImportMinutes?: number;
}

const CSV_SOURCE_SYSTEM = "csv";
const MAXIMUM_STREAM_IMPORT_ROWS = 300_000;
const DEFAULT_IMPORT_BATCH_SIZE = 1_000;

export interface ImportRowError {
  line: number;
  externalId?: string;
  code: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}

export interface ImportReport {
  jobId?: string;
  ok: boolean;
  received: number;
  created: number;
  updated: number;
  failed: number;
  errors: ImportRowError[];
}

interface PreparedProductRow {
  line: number;
  product: ProductSyncItem;
  price: PriceSyncItem;
  stock?: StockSyncItem;
}

function optionalValue(value: string): string | undefined {
  return value || undefined;
}

function numberValue(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

function booleanValue(value: string, defaultValue: boolean): unknown {
  if (!value) return defaultValue;
  const normalized = value.toLocaleLowerCase("ru");
  if (["true", "1", "yes", "да"].includes(normalized)) return true;
  if (["false", "0", "no", "нет"].includes(normalized)) return false;
  return value;
}

function persistenceError(line: number, externalId?: string, error?: unknown): ImportRowError {
  applicationLogger.error({ line, externalId, databaseCode: (error as { code?: string })?.code }, "CSV row persistence failed");
  return {
    line,
    externalId,
    code: "PERSISTENCE_ERROR",
    message: "Строка не сохранена из-за конфликта или ошибки базы данных.",
  };
}

export class CatalogImportService {
  constructor(
    private readonly pool: Pool,
    private readonly productRepository: ProductRepository,
    private readonly auditRepository: AdminAuditRepository,
    private readonly importJobRepository = new ImportJobRepository(),
    private readonly fitmentRepository = new FitmentRepository(),
    private readonly options: CatalogImportServiceOptions = {},
  ) {}

  /** Creates and starts a job record after closing dead jobs of earlier runs. */
  private async startJob(type: "products_csv" | "fitments_csv", filename: string, actorUserId?: string) {
    await failStaleImportJobs(
      this.pool,
      this.importJobRepository,
      this.options.staleImportMinutes ?? readStaleImportMinutes(),
    );
    const jobId = await this.importJobRepository.create(this.pool, { type, filename, createdBy: actorUserId });
    await this.importJobRepository.start(this.pool, jobId);
    return jobId;
  }

  /**
   * Records an interrupted import. The usual reason is an unavailable
   * database (restart, network), so the write is retried with growing pauses
   * for up to ~45 s (see retryWhileDatabaseUnavailable); a CLI waits that
   * long at most. If the status still cannot be saved, that is logged, the
   * original error goes to the caller, and the job is closed later as stale
   * (failStaleImportJobs).
   */
  private async markJobFailed(jobId: string, error: unknown): Promise<void> {
    try {
      await retryWhileDatabaseUnavailable(
        () =>
          this.importJobRepository.finish(
            this.pool,
            jobId,
            "failed",
            error instanceof Error ? error.message.slice(0, 500) : "Импорт прерван.",
          ),
        {
          onRetry: (retryError, attempt, delay) =>
            applicationLogger.warn(
              { error: retryError, jobId, attempt, retryInSeconds: delay / 1_000 },
              "Import job status not saved yet: database unavailable, retrying",
            ),
          ...this.options.statusRetry,
        },
      );
    } catch (finishError) {
      applicationLogger.error({ error: finishError, jobId }, "Import job status was not saved");
    }
  }

  async importFitmentsCsvStream(
    stream: ReadableStream<Uint8Array>,
    filename: string,
    actorUserId?: string,
  ): Promise<ImportReport> {
    const jobId = await this.startJob("fitments_csv", filename, actorUserId);
    const batchSize = Math.min(2_000, Math.max(100, Number(process.env.FITMENT_IMPORT_BATCH_SIZE) || DEFAULT_IMPORT_BATCH_SIZE));
    const responseErrors: ImportRowError[] = [];
    let batch: CsvRecord[] = [];
    let received = 0;
    let created = 0;
    let updated = 0;
    let failed = 0;

    const processBatch = async () => {
      if (batch.length === 0) return;
      const batchErrors: ImportRowError[] = [];
      await withTransaction(this.pool, async (database) => {
        for (const record of batch) {
          const values = record.values;
          const validation = normalizedFitmentImportSchema.safeParse({
            make: values.make,
            model: values.model,
            generation: values.generation,
            yearFrom: numberValue(values.year_from),
            yearTo: numberValue(values.year_to),
            modification: optionalValue(values.modification),
            engine: optionalValue(values.engine),
            productType: values.product_type,
            axle: values.axle || "all",
            fitmentType: values.fitment_type || "factory",
            tireWidth: numberValue(values.tire_width),
            tireProfile: numberValue(values.tire_profile),
            tireDiameter: numberValue(values.tire_diameter),
            wheelDiameter: numberValue(values.wheel_diameter),
            wheelWidth: numberValue(values.wheel_width),
            boltCount: numberValue(values.bolt_count),
            pcd: numberValue(values.pcd),
            dia: numberValue(values.dia),
            etMin: numberValue(values.et_min),
            etMax: numberValue(values.et_max),
            source: values.source || "import",
            verified: booleanValue(values.verified, false),
            verifiedAt: optionalValue(values.verified_at),
            notes: optionalValue(values.notes),
          });
          if (!validation.success) {
            batchErrors.push({
              line: record.lineNumber,
              code: "VALIDATION_ERROR",
              message: "Строка применяемости не соответствует шаблону.",
              issues: formatValidationIssues(validation.error),
            });
            continue;
          }
          const savepoint = `csv_fitment_${record.lineNumber}`;
          await database.query(`SAVEPOINT ${savepoint}`);
          try {
            const wasCreated = await this.fitmentRepository.upsertNormalized(database, validation.data);
            if (wasCreated) created += 1;
            else updated += 1;
            await database.query(`RELEASE SAVEPOINT ${savepoint}`);
          } catch (error) {
            await database.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await database.query(`RELEASE SAVEPOINT ${savepoint}`);
            batchErrors.push(persistenceError(record.lineNumber, undefined, error));
          }
        }
        failed += batchErrors.length;
        await this.importJobRepository.addErrors(database, jobId, batchErrors.map((error) => ({
          rowNumber: error.line,
          field: error.issues?.[0]?.path,
          errorCode: error.code,
          message: error.message,
        })));
        await this.importJobRepository.updateProgress(database, jobId, {
          totalRows: received,
          processedRows: received,
          createdRows: created,
          updatedRows: updated,
          failedRows: failed,
        });
      });
      responseErrors.push(...batchErrors.slice(0, Math.max(0, 100 - responseErrors.length)));
      batch = [];
    };

    try {
      for await (const record of parseCsvStream(stream, {
        maximumRows: MAXIMUM_STREAM_IMPORT_ROWS,
        requiredHeaders: ["make", "model", "generation", "product_type", "verified"],
      })) {
        received += 1;
        batch.push(record);
        if (batch.length >= batchSize) await processBatch();
      }
      await processBatch();
      await this.importJobRepository.finish(this.pool, jobId, failed === 0 ? "completed" : "completed_with_errors");
      const report = { jobId, ok: failed === 0, received, created, updated, failed, errors: responseErrors };
      if (actorUserId) {
        await this.auditRepository.record(this.pool, {
          actorUserId,
          action: "catalog.fitments.csv_import",
          entityType: "import_jobs",
          entityId: jobId,
          details: { received, created, updated, failed } as unknown as JsonValue,
        });
      }
      return report;
    } catch (error) {
      await this.markJobFailed(jobId, error);
      throw error;
    }
  }

  async importProductsCsvStream(
    stream: ReadableStream<Uint8Array>,
    filename: string,
    mode: "full" | "incremental" = "incremental",
    actorUserId?: string,
  ): Promise<ImportReport> {
    const jobId = await this.startJob("products_csv", filename, actorUserId);
    const batchSize = Math.min(
      2_000,
      Math.max(100, Number(process.env.CATALOG_IMPORT_BATCH_SIZE) || DEFAULT_IMPORT_BATCH_SIZE),
    );
    const seenExternalIds = new Set<string>();
    const seenSkus = new Set<string>();
    const responseErrors: ImportRowError[] = [];
    let batch: CsvRecord[] = [];
    let received = 0;
    let created = 0;
    let updated = 0;
    let failed = 0;

    const processBatch = async () => {
      if (batch.length === 0) return;
      const batchErrors: ImportRowError[] = [];
      const preparedRows: PreparedProductRow[] = [];
      for (const record of batch) {
        const prepared = this.prepareProductRow(record, batchErrors);
        if (!prepared) continue;
        if (seenExternalIds.has(prepared.product.externalId) || seenSkus.has(prepared.product.sku)) {
          batchErrors.push({
            line: record.lineNumber,
            externalId: prepared.product.externalId,
            code: "DUPLICATE_PRODUCT_KEY",
            message: "external_id или SKU повторяется внутри CSV-файла.",
          });
          continue;
        }
        seenExternalIds.add(prepared.product.externalId);
        seenSkus.add(prepared.product.sku);
        preparedRows.push(prepared);
      }
      await withTransaction(this.pool, async (database) => {
        const existingIds = await this.productRepository.findExistingExternalIds(
          database,
          CSV_SOURCE_SYSTEM,
          preparedRows.map((row) => row.product.externalId),
          preparedRows.map((row) => row.product.sku),
        );
        const persistedIds: string[] = [];
        for (const row of preparedRows) {
          const savepoint = `csv_product_${row.line}`;
          await database.query(`SAVEPOINT ${savepoint}`);
          try {
            await this.productRepository.upsertFromExternalSystem(database, row.product, CSV_SOURCE_SYSTEM);
            await this.productRepository.upsertPrice(database, row.price, CSV_SOURCE_SYSTEM);
            if (row.stock) await this.productRepository.upsertStock(database, row.stock, CSV_SOURCE_SYSTEM);
            await database.query(`RELEASE SAVEPOINT ${savepoint}`);
            persistedIds.push(row.product.externalId);
            if (existingIds.has(row.product.externalId)) updated += 1;
            else created += 1;
          } catch (error) {
            await database.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await database.query(`RELEASE SAVEPOINT ${savepoint}`);
            batchErrors.push(persistenceError(row.line, row.product.externalId, error));
          }
        }
        failed += batchErrors.length;
        await this.importJobRepository.rememberProductKeys(database, jobId, persistedIds);
        await this.importJobRepository.addErrors(
          database,
          jobId,
          batchErrors.map((error) => ({
            rowNumber: error.line,
            sku: batch.find((record) => record.lineNumber === error.line)?.values.sku,
            field: error.issues?.[0]?.path,
            errorCode: error.code,
            message: error.message,
          })),
        );
        await this.importJobRepository.updateProgress(database, jobId, {
          totalRows: received,
          processedRows: received,
          createdRows: created,
          updatedRows: updated,
          failedRows: failed,
        });
      });
      responseErrors.push(...batchErrors.slice(0, Math.max(0, 100 - responseErrors.length)));
      batch = [];
    };

    try {
      for await (const record of parseCsvStream(stream, {
        maximumRows: MAXIMUM_STREAM_IMPORT_ROWS,
        requiredHeaders: ["external_id", "sku", "name", "brand", "model", "kind", "diameter", "price"],
      })) {
        received += 1;
        batch.push(record);
        if (batch.length >= batchSize) await processBatch();
      }
      await processBatch();
      if (mode === "full" && failed === 0 && received > 0) {
        await withTransaction(this.pool, (database) =>
          this.productRepository.deactivateMissingFromImportJob(database, CSV_SOURCE_SYSTEM, jobId),
        );
      }
      const status = failed === 0 ? "completed" : "completed_with_errors";
      await this.importJobRepository.finish(this.pool, jobId, status);
      const report = { jobId, ok: failed === 0, received, created, updated, failed, errors: responseErrors };
      if (actorUserId) {
        await this.auditRepository.record(this.pool, {
          actorUserId,
          action: "catalog.products.csv_import",
          entityType: "import_jobs",
          entityId: jobId,
          details: { mode, received, created, updated, failed } as unknown as JsonValue,
        });
      }
      return report;
    } catch (error) {
      await this.markJobFailed(jobId, error);
      throw error;
    }
  }


  private prepareProductRow(
    record: CsvRecord,
    errors: ImportRowError[],
  ): PreparedProductRow | null {
    const values = record.values;
    const sourceUpdatedAt = optionalValue(values.source_updated_at);
    const productValidation = productSchema.safeParse({
      externalId: values.external_id,
      sku: values.sku,
      article: optionalValue(values.article),
      name: values.name,
      brand: values.brand,
      model: values.model,
      category: values.category || "",
      description: values.description || "",
      kind: values.kind,
      condition: values.condition || "new",
      width: numberValue(values.width) ?? 0,
      profile: numberValue(values.profile) ?? 0,
      diameter: numberValue(values.diameter),
      season: values.season || "none",
      studded: booleanValue(values.studded, false),
      runflat: booleanValue(values.runflat, false),
      xl: booleanValue(values.xl, false),
      loadIndex: optionalValue(values.load_index),
      speedIndex: optionalValue(values.speed_index),
      modelYear: numberValue(values.model_year),
      wheelType: optionalValue(values.wheel_type),
      wheelWidth: numberValue(values.wheel_width),
      boltCount: numberValue(values.bolt_count),
      pcdNumber: numberValue(values.pcd_number || values.pcd),
      pcd: optionalValue(values.pcd),
      offset: numberValue(values.offset),
      centerBore: numberValue(values.center_bore),
      color: optionalValue(values.color),
      country: optionalValue(values.country),
      specifications: {},
      images: values.image_url
        ? [{ url: values.image_url, alt: values.name, position: 0 }]
        : [],
      isActive: booleanValue(values.is_active, true),
      sourceUpdatedAt,
    });
    const priceValidation = priceSchema.safeParse({
      externalId: values.external_id,
      price: numberValue(values.price),
      oldPrice: numberValue(values.old_price),
      discount: numberValue(values.discount),
      sourceUpdatedAt,
    });
    const hasStock = Boolean(values.stock?.trim());
    const stockValidation = hasStock
      ? stockSchema.safeParse({
          externalId: values.external_id,
          warehouseExternalId:
            values.warehouse_external_id || values.warehouse_code,
          warehouseCode: values.warehouse_code,
          warehouseName: values.warehouse_name,
          quantity: numberValue(values.stock),
          reserved: numberValue(values.reserved) ?? 0,
          sourceUpdatedAt,
        })
      : null;

    if (
      !productValidation.success ||
      !priceValidation.success ||
      (stockValidation && !stockValidation.success)
    ) {
      errors.push({
        line: record.lineNumber,
        externalId: values.external_id || undefined,
        code: "VALIDATION_ERROR",
        message: "Строка товара не соответствует шаблону.",
        issues: [
          ...(productValidation.success
            ? []
            : formatValidationIssues(productValidation.error)),
          ...(priceValidation.success
            ? []
            : formatValidationIssues(priceValidation.error)),
          ...(stockValidation && !stockValidation.success
            ? formatValidationIssues(stockValidation.error)
            : []),
        ],
      });
      return null;
    }
    return {
      line: record.lineNumber,
      product: productValidation.data,
      price: priceValidation.data,
      stock: stockValidation?.data,
    };
  }
}

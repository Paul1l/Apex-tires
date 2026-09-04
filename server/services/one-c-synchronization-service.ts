import type { Pool } from "pg";
import type { z } from "zod";
import { withTransaction } from "../database/postgres-client";
import type {
  SynchronizationRecordError,
  SynchronizationResponse,
} from "../repositories/integration-sync-log-repository";
import { IntegrationSyncLogRepository } from "../repositories/integration-sync-log-repository";
import { ProductRepository } from "../repositories/product-repository";
import type { ApplicationLogger, DatabaseExecutor } from "../types/common";
import { ApplicationError } from "../utils/errors";
import {
  formatValidationIssues,
  type BatchEnvelope,
  type PriceSyncItem,
  type ProductFitmentsSyncItem,
  type ProductSyncItem,
  type StockSyncItem,
} from "../validators/one-c-schemas";

const SOURCE_SYSTEM = "1c";

type SyncProductRepository = Pick<
  ProductRepository,
  | "upsertFromExternalSystem"
  | "deactivateMissing"
  | "upsertPrice"
  | "upsertStock"
  | "replaceFitments"
>;

type SyncLogRepository = Pick<
  IntegrationSyncLogRepository,
  | "findByIdempotencyKey"
  | "start"
  | "complete"
  | "recordErrors"
>;

export interface SynchronizationServiceDependencies {
  pool: Pool;
  productRepository: SyncProductRepository;
  syncLogRepository: SyncLogRepository;
  logger: ApplicationLogger;
}

interface ProcessBatchInput<Item extends object> {
  envelope: BatchEnvelope;
  entityType: string;
  itemSchema: z.ZodType<Item>;
  persistItem: (database: DatabaseExecutor, item: Item) => Promise<unknown>;
  afterSuccessfulBatch?: (
    database: DatabaseExecutor,
    externalIds: string[],
  ) => Promise<unknown>;
}

function safePersistenceError(error: unknown): Pick<
  SynchronizationRecordError,
  "code" | "message"
> {
  if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
    return {
      code: "PRODUCT_NOT_FOUND",
      message: "Товар с указанным externalId сначала должен быть загружен.",
    };
  }

  if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
    return {
      code: "ORDER_NOT_FOUND",
      message: "Заказ с указанным siteOrderId не найден.",
    };
  }

  return {
    code: "PERSISTENCE_ERROR",
    message: "Запись не сохранена из-за конфликта или ошибки базы данных.",
  };
}

function readExternalId(rawItem: unknown): string | undefined {
  if (typeof rawItem !== "object" || rawItem === null) return undefined;
  const externalId = Reflect.get(rawItem, "externalId");
  return typeof externalId === "string" ? externalId : undefined;
}

export class OneCSynchronizationService {
  private readonly pool: Pool;
  private readonly productRepository: SyncProductRepository;
  private readonly syncLogRepository: SyncLogRepository;
  private readonly logger: ApplicationLogger;

  constructor({
    pool,
    productRepository,
    syncLogRepository,
    logger,
  }: SynchronizationServiceDependencies) {
    this.pool = pool;
    this.productRepository = productRepository;
    this.syncLogRepository = syncLogRepository;
    this.logger = logger;
  }

  async processBatch<Item extends object>({
    envelope,
    entityType,
    itemSchema,
    persistItem,
    afterSuccessfulBatch,
  }: ProcessBatchInput<Item>): Promise<SynchronizationResponse> {
    const existingLog = await this.syncLogRepository.findByIdempotencyKey(
      this.pool,
      envelope.idempotencyKey,
    );

    if (existingLog) {
      if (existingLog.status === "processing") {
        throw new ApplicationError({
          code: "SYNCHRONIZATION_IN_PROGRESS",
          message: "Пакет с таким idempotencyKey уже обрабатывается.",
          statusCode: 409,
        });
      }

      return { ...existingLog.result_summary, duplicate: true };
    }

    const syncLogId = await this.syncLogRepository.start(this.pool, {
      sourceSystem: SOURCE_SYSTEM,
      entityType,
      operation: "upsert_batch",
      direction: "incoming",
      idempotencyKey: envelope.idempotencyKey,
      syncMode: envelope.mode,
      cursor: envelope.cursor,
      recordsReceived: envelope.items.length,
    });

    if (!syncLogId) {
      throw new ApplicationError({
        code: "SYNCHRONIZATION_CONFLICT",
        message: "Пакет с таким idempotencyKey уже принят.",
        statusCode: 409,
      });
    }

    const errors: SynchronizationRecordError[] = [];
    const processedExternalIds: string[] = [];

    try {
      await withTransaction(this.pool, async (database) => {
        for (const [recordIndex, rawItem] of envelope.items.entries()) {
          const validationResult = itemSchema.safeParse(rawItem);

          if (!validationResult.success) {
            errors.push({
              index: recordIndex,
              externalId: readExternalId(rawItem),
              code: "VALIDATION_ERROR",
              message: "Запись не соответствует контракту.",
              issues: formatValidationIssues(validationResult.error),
            });
            continue;
          }

          const savepointName = `sync_item_${recordIndex}`;
          await database.query(`SAVEPOINT ${savepointName}`);

          try {
            await persistItem(database, validationResult.data);
            const externalId = readExternalId(validationResult.data);
            if (externalId) processedExternalIds.push(externalId);
            await database.query(`RELEASE SAVEPOINT ${savepointName}`);
          } catch (error) {
            await database.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            await database.query(`RELEASE SAVEPOINT ${savepointName}`);
            errors.push({
              index: recordIndex,
              externalId: readExternalId(validationResult.data),
              ...safePersistenceError(error),
            });
            this.logger.error(
              { error, entityType, recordIndex },
              "1C batch record persistence failed",
            );
          }
        }

        if (errors.length === 0 && afterSuccessfulBatch) {
          await afterSuccessfulBatch(database, processedExternalIds);
        }
      });

      const response: SynchronizationResponse = {
        ok: errors.length === 0,
        idempotencyKey: envelope.idempotencyKey,
        processed: envelope.items.length - errors.length,
        failed: errors.length,
        errors,
      };

      await this.syncLogRepository.complete(this.pool, syncLogId, {
        status: errors.length === 0 ? "success" : "partial",
        processed: response.processed,
        failed: response.failed,
        errorSummary:
          errors.length > 0 ? `${errors.length} записей не обработано` : null,
        response,
      });
      await this.syncLogRepository.recordErrors(this.pool, syncLogId, errors);
      return response;
    } catch (error) {
      const response: SynchronizationResponse = {
        ok: false,
        idempotencyKey: envelope.idempotencyKey,
        processed: 0,
        failed: envelope.items.length,
        errors: [
          {
            index: -1,
            code: "BATCH_PROCESSING_ERROR",
            message: "Пакет не обработан из-за ошибки базы данных.",
          },
        ],
      };

      await this.syncLogRepository.complete(this.pool, syncLogId, {
        status: "failed",
        processed: 0,
        failed: envelope.items.length,
        errorSummary: "Ошибка обработки пакета",
        response,
      });
      this.logger.error({ error, entityType }, "1C batch processing failed");
      throw new ApplicationError({
        code: "BATCH_PROCESSING_ERROR",
        message: "Пакет временно не может быть обработан.",
        statusCode: 503,
      });
    }
  }

  synchronizeProducts(
    envelope: BatchEnvelope,
    itemSchema: z.ZodType<ProductSyncItem>,
  ): Promise<SynchronizationResponse> {
    return this.processBatch({
      envelope,
      entityType: "products",
      itemSchema,
      persistItem: (database, product) =>
        this.productRepository.upsertFromExternalSystem(
          database,
          product,
          SOURCE_SYSTEM,
        ),
      afterSuccessfulBatch:
        envelope.mode === "full"
          ? (database, externalIds) =>
              this.productRepository.deactivateMissing(
                database,
                SOURCE_SYSTEM,
                externalIds,
              )
          : undefined,
    });
  }

  synchronizePrices(
    envelope: BatchEnvelope,
    itemSchema: z.ZodType<PriceSyncItem>,
  ): Promise<SynchronizationResponse> {
    return this.processBatch({
      envelope,
      entityType: "prices",
      itemSchema,
      persistItem: (database, price) =>
        this.productRepository.upsertPrice(database, price, SOURCE_SYSTEM),
    });
  }

  synchronizeStocks(
    envelope: BatchEnvelope,
    itemSchema: z.ZodType<StockSyncItem>,
  ): Promise<SynchronizationResponse> {
    return this.processBatch({
      envelope,
      entityType: "stocks",
      itemSchema,
      persistItem: (database, stock) =>
        this.productRepository.upsertStock(database, stock, SOURCE_SYSTEM),
    });
  }

  synchronizeFitments(
    envelope: BatchEnvelope,
    itemSchema: z.ZodType<ProductFitmentsSyncItem>,
  ): Promise<SynchronizationResponse> {
    return this.processBatch({
      envelope,
      entityType: "fitments",
      itemSchema,
      persistItem: (database, item) =>
        this.productRepository.replaceFitments(database, item, SOURCE_SYSTEM),
    });
  }
}

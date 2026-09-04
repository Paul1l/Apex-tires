import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { z } from "zod";
import type {
  SynchronizationRecordError,
  SynchronizationResponse,
} from "../repositories/integration-sync-log-repository.js";
import type { DatabaseExecutor } from "../types/common.js";
import {
  OneCSynchronizationService,
  type SynchronizationServiceDependencies,
} from "../services/one-c-synchronization-service.js";

function createTransactionPool() {
  const database = {
    async query() {
      return { rows: [] };
    },
    release() {},
  };
  return {
    async connect() {
      return database;
    },
  };
}

test("a malformed record does not reject the rest of a batch", async () => {
  const completed: SynchronizationResponse[] = [];
  const recordedErrors: SynchronizationRecordError[] = [];
  const service = new OneCSynchronizationService({
    pool: createTransactionPool() as unknown as Pool,
    productRepository: {} as SynchronizationServiceDependencies["productRepository"],
    syncLogRepository: {
      async findByIdempotencyKey() {
        return null;
      },
      async start() {
        return "sync-log-id";
      },
      async complete(_database, _syncLogId, result) {
        completed.push(result.response);
      },
      async recordErrors(_database, _syncLogId, errors) {
        recordedErrors.push(...errors);
      },
    },
    logger: { error() {}, warn() {} },
  });
  const persisted: string[] = [];
  const itemSchema = z.object({
    externalId: z.string().min(1),
    value: z.number().nonnegative(),
  });

  const result = await service.processBatch({
    envelope: {
      apiVersion: "1.0",
      idempotencyKey: "batch-key",
      mode: "incremental",
      items: [
        { externalId: "valid", value: 1 },
        { externalId: "invalid", value: -1 },
      ],
    },
    entityType: "test",
    itemSchema,
    persistItem: async (_database: DatabaseExecutor, item) => {
      persisted.push(item.externalId);
    },
  });

  assert.deepEqual(persisted, ["valid"]);
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 1);
  assert.equal(completed[0].failed, 1);
  assert.equal(recordedErrors[0].externalId, "invalid");
});

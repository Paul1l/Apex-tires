import type { Pool } from "pg";
import {
  oneCConnectionIsConfigured,
  readEnvironment,
  type ServerEnvironment,
} from "../config/environment";
import { createPostgresPool } from "../database/postgres-client";
import { createOneCProvider } from "../integrations/onec/one-c-http-provider";
import type { OneCProvider } from "../integrations/onec/one-c-provider";
import { IntegrationSyncLogRepository } from "../repositories/integration-sync-log-repository";
import { OrderRepository } from "../repositories/order-repository";
import { ProductRepository } from "../repositories/product-repository";
import { IntegrationStatusService } from "../services/integration-status-service";
import { OneCSynchronizationService } from "../services/one-c-synchronization-service";
import { OrderIntegrationService } from "../services/order-integration-service";
import { OrderService } from "../services/order-service";
import { applicationLogger } from "../types/common";

interface ApplicationServices {
  environment: ServerEnvironment;
  pool: Pool;
  synchronizationService: OneCSynchronizationService;
  orderIntegrationService: OrderIntegrationService;
  orderService: OrderService;
  integrationStatusService: IntegrationStatusService;
}

declare global {
  var apexPostgresPool: Pool | undefined;
}

function getPostgresPool(environment: ServerEnvironment): Pool {
  if (!globalThis.apexPostgresPool) {
    globalThis.apexPostgresPool = createPostgresPool(environment);
  }
  return globalThis.apexPostgresPool;
}

export function databaseIsConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function createApplicationServices(): ApplicationServices {
  const environment = readEnvironment();
  const pool = getPostgresPool(environment);
  const productRepository = new ProductRepository();
  const orderRepository = new OrderRepository();
  const syncLogRepository = new IntegrationSyncLogRepository();
  const oneCConfigured = oneCConnectionIsConfigured(environment);
  const oneCProvider: OneCProvider | null = oneCConfigured
    ? createOneCProvider(environment, applicationLogger)
    : null;
  const synchronizationService = new OneCSynchronizationService({
    pool,
    productRepository,
    syncLogRepository,
    logger: applicationLogger,
  });

  return {
    environment,
    pool,
    synchronizationService,
    orderService: new OrderService({ pool, orderRepository }),
    orderIntegrationService: new OrderIntegrationService({
      pool,
      orderRepository,
      oneCProvider,
      synchronizationService,
      logger: applicationLogger,
    }),
    integrationStatusService: new IntegrationStatusService({
      pool,
      oneCProvider,
      oneCConfigured,
      syncLogRepository,
      orderRepository,
      logger: applicationLogger,
    }),
  };
}

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
import { AuthRepository } from "../repositories/auth-repository";
import { FitmentRepository } from "../repositories/fitment-repository";
import { CartRepository } from "../repositories/cart-repository";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import { NotificationOutboxRepository } from "../repositories/notification-outbox-repository";
import { FitmentRequestRepository } from "../repositories/fitment-request-repository";
import { OrderRepository } from "../repositories/order-repository";
import { ProductRepository } from "../repositories/product-repository";
import { IntegrationStatusService } from "../services/integration-status-service";
import { FitmentRequestService } from "../services/fitment-request-service";
import { CatalogService } from "../services/catalog-service";
import { OneCSynchronizationService } from "../services/one-c-synchronization-service";
import { OrderIntegrationService } from "../services/order-integration-service";
import { OrderService } from "../services/order-service";
import { AuthService } from "../services/auth-service";
import { CatalogImportService } from "../services/catalog-import-service";
import { CartService } from "../services/cart-service";
import { NotificationService } from "../services/notification-service";
import { AdminOrderService } from "../services/admin-order-service";
import { YandexPostboxNotificationProvider } from "../integrations/notifications/yandex-postbox-notification-provider";
import { LocalFitmentProvider } from "../integrations/fitment/local-fitment-provider";
import { applicationLogger } from "../types/common";
import { businessConfig } from "../../config/business";

interface ApplicationServices {
  environment: ServerEnvironment;
  pool: Pool;
  synchronizationService: OneCSynchronizationService;
  orderIntegrationService: OrderIntegrationService;
  orderService: OrderService;
  integrationStatusService: IntegrationStatusService;
  fitmentRequestService: FitmentRequestService;
  catalogService: CatalogService;
  authService: AuthService | null;
  fitmentProvider: LocalFitmentProvider;
  catalogImportService: CatalogImportService;
  cartService: CartService;
  notificationService: NotificationService;
  adminOrderService: AdminOrderService;
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

export function authenticationSessionsAreConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.OTP_CODE_PEPPER);
}

export function createApplicationServices(): ApplicationServices {
  const environment = readEnvironment();
  const pool = getPostgresPool(environment);
  const productRepository = new ProductRepository();
  const authRepository = new AuthRepository();
  const fitmentRepository = new FitmentRepository();
  const cartRepository = new CartRepository();
  const adminAuditRepository = new AdminAuditRepository();
  const notificationOutboxRepository = new NotificationOutboxRepository();
  const notificationProviders =
    environment.YANDEX_POSTBOX_ACCESS_KEY_ID &&
    environment.YANDEX_POSTBOX_SECRET_ACCESS_KEY &&
    environment.YANDEX_POSTBOX_FROM_EMAIL
      ? [new YandexPostboxNotificationProvider(environment)]
      : [];
  const fitmentRequestRepository = new FitmentRequestRepository();
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
    fitmentRequestService: new FitmentRequestService(
      pool,
      fitmentRequestRepository,
      notificationOutboxRepository,
      businessConfig.contacts.supportEmail ??
        businessConfig.contacts.email ??
        undefined,
    ),
    catalogService: new CatalogService(pool, productRepository),
    authService: environment.OTP_CODE_PEPPER
      ? new AuthService({
          pool,
          repository: authRepository,
          securitySecret: environment.OTP_CODE_PEPPER,
          emailEnvironment: environment,
        })
      : null,
    fitmentProvider: new LocalFitmentProvider(pool, fitmentRepository),
    catalogImportService: new CatalogImportService(
      pool,
      productRepository,
      adminAuditRepository,
    ),
    cartService: new CartService(pool, cartRepository),
    notificationService: new NotificationService(
      pool,
      notificationOutboxRepository,
      notificationProviders,
      applicationLogger,
    ),
    adminOrderService: new AdminOrderService(
      pool,
      orderRepository,
      adminAuditRepository,
    ),
  };
}

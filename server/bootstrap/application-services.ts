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
import { readSecurityLimits } from "../config/security-limits";
import { reportRuntimeConfigurationOnce } from "../config/runtime-configuration";
import {
  InMemoryRateLimiter,
  type RateLimiter,
} from "../security/fixed-window-rate-limiter";
import { PostgresRateLimiter } from "../security/postgres-rate-limiter";

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
  rateLimiter: RateLimiter;
}

declare global {
  var apexPostgresPool: Pool | undefined;
  var apexInMemoryRateLimiter: InMemoryRateLimiter | undefined;
}

function getPostgresPool(environment: ServerEnvironment): Pool {
  if (!globalThis.apexPostgresPool) {
    globalThis.apexPostgresPool = createPostgresPool(environment);
  }
  return globalThis.apexPostgresPool;
}

export function databaseIsConfigured(): boolean {
  // Fallback for runtimes without instrumentation.ts: name a missing
  // OTP_CODE_PEPPER or invalid env once in the log instead of silent 503s.
  reportRuntimeConfigurationOnce();
  return Boolean(process.env.DATABASE_URL);
}

export function authenticationSessionsAreConfigured(): boolean {
  reportRuntimeConfigurationOnce();
  return Boolean(process.env.DATABASE_URL && process.env.OTP_CODE_PEPPER);
}

/**
 * Shared limiter for route handlers: PostgreSQL when the database is
 * configured, otherwise a bounded process-local fallback (preview mode and
 * local development without a database).
 */
export function getRateLimiter(): RateLimiter {
  if (databaseIsConfigured()) return createApplicationServices().rateLimiter;
  globalThis.apexInMemoryRateLimiter ??= new InMemoryRateLimiter();
  return globalThis.apexInMemoryRateLimiter;
}

export function createApplicationServices(): ApplicationServices {
  const environment = readEnvironment();
  const securityLimits = readSecurityLimits();
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
    // Delivery methods, tire service and the manager notification address
    // come from the settings saved in the admin, read with each order.
    orderService: new OrderService({
      pool,
      orderRepository,
      maximumActiveReservationsPerContact:
        securityLimits.orders.maximumActiveReservationsPerContact,
    }),
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
    // Manager notification address: from the settings saved in the admin
    // («Настройки»), read with each request; build-time defaults without a row.
    fitmentRequestService: new FitmentRequestService(
      pool,
      fitmentRequestRepository,
      notificationOutboxRepository,
    ),
    catalogService: new CatalogService(pool, productRepository),
    authService: environment.OTP_CODE_PEPPER
      ? new AuthService({
          pool,
          repository: authRepository,
          securitySecret: environment.OTP_CODE_PEPPER,
          emailEnvironment: environment,
          maximumFailedAttemptsPerDestination:
            securityLimits.otp.maximumFailedAttemptsPerEmail,
          failedAttemptsWindowMilliseconds:
            securityLimits.otp.failedAttemptsWindowSeconds * 1_000,
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
    rateLimiter: new PostgresRateLimiter(pool, {
      keySecret: environment.OTP_CODE_PEPPER,
    }),
  };
}

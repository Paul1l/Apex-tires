import type { Pool } from "pg";
import type { OneCProvider } from "../integrations/onec/one-c-provider";
import { IntegrationSyncLogRepository } from "../repositories/integration-sync-log-repository";
import { OrderRepository } from "../repositories/order-repository";
import type { ApplicationLogger } from "../types/common";

export type DependencyHealth = "healthy" | "unavailable" | "not_configured";

interface IntegrationStatusServiceDependencies {
  pool: Pool;
  oneCProvider: OneCProvider | null;
  oneCConfigured: boolean;
  syncLogRepository: IntegrationSyncLogRepository;
  orderRepository: OrderRepository;
  logger: ApplicationLogger;
}

export class IntegrationStatusService {
  private readonly pool: Pool;
  private readonly oneCProvider: OneCProvider | null;
  private readonly oneCConfigured: boolean;
  private readonly syncLogRepository: IntegrationSyncLogRepository;
  private readonly orderRepository: OrderRepository;
  private readonly logger: ApplicationLogger;

  constructor({
    pool,
    oneCProvider,
    oneCConfigured,
    syncLogRepository,
    orderRepository,
    logger,
  }: IntegrationStatusServiceDependencies) {
    this.pool = pool;
    this.oneCProvider = oneCProvider;
    this.oneCConfigured = oneCConfigured;
    this.syncLogRepository = syncLogRepository;
    this.orderRepository = orderRepository;
    this.logger = logger;
  }

  async checkDatabase(): Promise<Extract<DependencyHealth, "healthy" | "unavailable">> {
    try {
      await this.pool.query("SELECT 1");
      return "healthy";
    } catch (error) {
      this.logger.error({ error }, "PostgreSQL health check failed");
      return "unavailable";
    }
  }

  async checkOneC(): Promise<DependencyHealth> {
    if (!this.oneCConfigured || !this.oneCProvider) return "not_configured";

    try {
      await this.oneCProvider.healthCheck();
      return "healthy";
    } catch (error) {
      this.logger.warn({ error }, "1C health check failed");
      return "unavailable";
    }
  }

  async getHealth() {
    const [database, oneC] = await Promise.all([
      this.checkDatabase(),
      this.checkOneC(),
    ]);
    return {
      ok: database === "healthy",
      site: database === "healthy" ? "healthy" : "degraded",
      database,
      oneC,
      timestamp: new Date().toISOString(),
    };
  }

  async getAdminStatus() {
    const [health, synchronization, orders] = await Promise.all([
      this.getHealth(),
      this.syncLogRepository.getLatestSummary(this.pool),
      this.orderRepository.getIntegrationStatusCounts(this.pool),
    ]);
    return { ...health, synchronization, orders };
  }
}

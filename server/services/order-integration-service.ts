import type { Pool } from "pg";
import type { z } from "zod";
import { withTransaction } from "../database/postgres-client";
import type { OneCProvider } from "../integrations/onec/one-c-provider";
import {
  OrderRepository,
  type IntegrationOrderRow,
} from "../repositories/order-repository";
import type { ApplicationLogger, JsonValue } from "../types/common";
import type {
  BatchEnvelope,
  OrderStatusSyncItem,
} from "../validators/one-c-schemas";
import { OneCSynchronizationService } from "./one-c-synchronization-service";

interface OrderIntegrationServiceDependencies {
  pool: Pool;
  orderRepository: OrderRepository;
  oneCProvider: OneCProvider | null;
  synchronizationService: OneCSynchronizationService;
  logger: ApplicationLogger;
}

function mapOrderForOneC(order: IntegrationOrderRow): JsonValue {
  return {
    siteOrderId: order.id,
    orderNumber: order.number,
    date:
      order.created_at instanceof Date
        ? order.created_at.toISOString()
        : order.created_at,
    customer: {
      name: order.customer_name,
      phone: order.customer_phone,
      email: order.customer_email,
    },
    items: order.items.map((item) => ({
      sku: item.sku,
      name: item.product_name,
      quantity: item.quantity,
      price: Number(item.unit_price_kopecks) / 100,
      discount: Number(item.discount_kopecks) / 100,
      total: Number(item.total_kopecks) / 100,
    })),
    subtotal: Number(order.subtotal_kopecks) / 100,
    discount: Number(order.discount_kopecks) / 100,
    deliveryPrice: Number(order.delivery_kopecks) / 100,
    total: Number(order.total_kopecks) / 100,
    delivery: {
      method: order.delivery_method,
      address: order.delivery_address,
    },
    requiresTireService: order.requires_tire_service,
    comment: order.comment,
    status: order.status,
    paymentStatus: order.payment_status,
  };
}

export class OrderIntegrationService {
  private readonly pool: Pool;
  private readonly orderRepository: OrderRepository;
  private readonly oneCProvider: OneCProvider | null;
  private readonly synchronizationService: OneCSynchronizationService;
  private readonly logger: ApplicationLogger;

  constructor({
    pool,
    orderRepository,
    oneCProvider,
    synchronizationService,
    logger,
  }: OrderIntegrationServiceDependencies) {
    this.pool = pool;
    this.orderRepository = orderRepository;
    this.oneCProvider = oneCProvider;
    this.synchronizationService = synchronizationService;
    this.logger = logger;
  }

  synchronizeOrderStatuses(
    envelope: BatchEnvelope,
    itemSchema: z.ZodType<OrderStatusSyncItem>,
  ) {
    return this.synchronizationService.processBatch({
      envelope,
      entityType: "order-statuses",
      itemSchema,
      persistItem: (database, orderStatus) =>
        this.orderRepository.updateFromOneC(database, orderStatus),
    });
  }

  async getOrdersForOneC(limit: number) {
    const orders = await this.orderRepository.getOrdersForIntegration(
      this.pool,
      limit,
    );
    return {
      ok: true,
      orders: orders.map(mapOrderForOneC),
      hasMore: orders.length === limit,
    };
  }

  async processNextPendingOrder() {
    if (!this.oneCProvider) {
      return {
        processed: false,
        reason: "ONEC_NOT_CONFIGURED",
      };
    }

    const queueItem = await withTransaction(this.pool, (database) =>
      this.orderRepository.claimNextQueueItem(database),
    );
    if (!queueItem) return { processed: false, reason: "QUEUE_EMPTY" };

    try {
      const response = await this.oneCProvider.sendOrder(queueItem.payload, {
        idempotencyKey: queueItem.idempotency_key,
      });
      await this.orderRepository.markQueueItemSynced(
        this.pool,
        queueItem.id,
        response?.externalOrderId,
      );
      return { processed: true, queueItemId: queueItem.id };
    } catch (error) {
      const safeMessage = "Не удалось передать заказ в 1С.";
      await this.orderRepository.markQueueItemFailed(
        this.pool,
        queueItem.id,
        safeMessage,
      );
      this.logger.error(
        { error, queueItemId: queueItem.id },
        "Order delivery to 1C failed",
      );
      return { processed: false, reason: "ONEC_DELIVERY_FAILED" };
    }
  }

  retryFailedOrders(): Promise<number> {
    return this.orderRepository.retryFailed(this.pool);
  }
}

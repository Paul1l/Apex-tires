import type { Pool } from "pg";
import { withTransaction } from "../database/postgres-client";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import { OrderRepository } from "../repositories/order-repository";
import { ApplicationError } from "../utils/errors";
import type { UpdateOrderStatusInput } from "../validators/admin-order-schema";

export class AdminOrderService {
  constructor(
    private readonly pool: Pool,
    private readonly orderRepository: OrderRepository,
    private readonly auditRepository: AdminAuditRepository,
  ) {}

  async updateStatus(
    actorUserId: string,
    orderId: string,
    input: UpdateOrderStatusInput,
  ): Promise<void> {
    await withTransaction(this.pool, async (database) => {
      const updated = await this.orderRepository.updateStatus(
        database,
        orderId,
        input.status,
        input.paymentStatus,
      );
      if (!updated) {
        throw new ApplicationError({
          code: "ORDER_NOT_FOUND",
          message: "Заказ не найден.",
          statusCode: 404,
        });
      }
      await this.auditRepository.record(database, {
        actorUserId,
        action: "order.status_updated",
        entityType: "order",
        details: { orderId, ...input },
      });
    });
  }
}

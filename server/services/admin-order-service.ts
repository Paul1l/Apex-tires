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
      await database.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
      const expired = await database.query("SELECT 1 FROM inventory_reservations WHERE order_id=$1 AND (status='expired' OR (status='active' AND expires_at <= NOW())) LIMIT 1", [orderId]);
      if (expired.rowCount && !["new","cancelled"].includes(input.status)) throw new ApplicationError({ code: "ORDER_RESERVATION_EXPIRED", message: "Резерв заказа истёк. Проверьте наличие и оформите новый заказ; старый можно отменить.", statusCode: 409 });
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

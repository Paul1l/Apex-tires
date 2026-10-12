import { createApplicationServices } from "../bootstrap/application-services";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import { AdminOrderRepository } from "../repositories/admin-order-repository";
import { NotificationOutboxRepository } from "../repositories/notification-outbox-repository";
import { OrderCommentRepository } from "../repositories/order-comment-repository";
import { OrderRepository } from "../repositories/order-repository";
import { AdminOrderService } from "./admin-order-service";

/**
 * Customer emails on staff status changes (confirmed, ready for pickup,
 * shipped, cancelled) go through notification_outbox only. Keep false until
 * the delivery provider renders the "customer-order-status-changed" template
 * (renderCustomerOrderStatusNotification in admin-order-notifications.ts);
 * an unknown template would fail and be retried by the notification job.
 */
export const CUSTOMER_STATUS_NOTIFICATIONS_ENABLED = false;

/** Admin order service on the shared PostgreSQL pool of createApplicationServices(). */
export function createAdminOrderService(): AdminOrderService {
  const { pool } = createApplicationServices();
  return new AdminOrderService(pool, new OrderRepository(), new AdminAuditRepository(), {
    adminOrderRepository: new AdminOrderRepository(),
    commentRepository: new OrderCommentRepository(),
    notificationOutboxRepository: new NotificationOutboxRepository(),
    customerStatusNotifications: CUSTOMER_STATUS_NOTIFICATIONS_ENABLED,
  });
}

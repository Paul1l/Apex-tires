import type { Pool } from "pg";
import type {
  AdminOrderComment,
  AdminOrderDetails,
  AdminOrderListItem,
  AdminOrderPagination,
  AdminOrderReservation,
} from "../../lib/admin/order-types";
import { STATUSES_ALLOWED_WITH_EXPIRED_RESERVATION } from "../../lib/admin/order-statuses";
import { withTransaction } from "../database/postgres-client";
import type { AdminAuditRepository } from "../repositories/admin-audit-repository";
import {
  AdminOrderRepository,
  type AdminOrderReservationRow,
} from "../repositories/admin-order-repository";
import type { UserRole } from "../repositories/auth-repository";
import type { NotificationOutboxRepository } from "../repositories/notification-outbox-repository";
import {
  OrderCommentRepository,
  type OrderCommentRow,
} from "../repositories/order-comment-repository";
import type { OrderRepository } from "../repositories/order-repository";
import { redactPersonalData } from "../types/common";
import { ApplicationError } from "../utils/errors";
import {
  canChangePaymentStatus,
  type AdminOrderListQuery,
  type CreateOrderCommentInput,
  type UpdateOrderStatusInput,
  type UpdatePaymentStatusInput,
} from "../validators/admin-order-schema";
import { customerStatusNotification } from "./admin-order-notifications";

/** Authenticated staff member performing the action (from requireUserRole). */
export interface AdminOrderActor {
  id: string;
  role: UserRole;
}

export interface AdminOrderServiceOptions {
  adminOrderRepository?: Pick<
    AdminOrderRepository,
    | "countOrders"
    | "listOrders"
    | "findOrder"
    | "listItems"
    | "listStatusHistory"
    | "listReservations"
    | "findQueueItem"
    | "lockOrder"
    | "hasExpiredReservation"
    | "setStatusChangeContext"
    | "clearStatusChangeContext"
    | "updatePaymentStatus"
  >;
  commentRepository?: Pick<OrderCommentRepository, "create" | "listForOrder">;
  notificationOutboxRepository?: Pick<NotificationOutboxRepository, "enqueue">;
  /**
   * Enqueue a customer email on customer-relevant status changes. Off until
   * the delivery provider renders CUSTOMER_ORDER_STATUS_TEMPLATE (otherwise
   * every such email would fail and be retried).
   */
  customerStatusNotifications?: boolean;
}

export interface OrderStatusUpdateResult {
  status: string;
  previousStatus: string;
  notificationQueued: boolean;
}

const MAXIMUM_ERROR_SUMMARY_LENGTH = 300;

function orderNotFound(): ApplicationError {
  return new ApplicationError({
    code: "ORDER_NOT_FOUND",
    message: "Заказ не найден.",
    statusCode: 404,
  });
}

function reservationExpired(): ApplicationError {
  return new ApplicationError({
    code: "ORDER_RESERVATION_EXPIRED",
    message: "Резерв заказа истёк. Проверьте наличие и оформите новый заказ; старый можно отменить.",
    statusCode: 409,
  });
}

function paymentStatusForbidden(): ApplicationError {
  return new ApplicationError({
    code: "PAYMENT_STATUS_FORBIDDEN",
    message: "Статус оплаты может менять только администратор.",
    statusCode: 403,
  });
}

function toIsoString(value: Date | string): string;
function toIsoString(value: Date | string | null): string | null;
function toIsoString(value: Date | string | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString();
}

/** Safe summary of a stored transfer error: personal data masked, length limited. */
export function summarizeIntegrationError(value: string | null): string | null {
  if (!value) return null;
  const summary = redactPersonalData(value).replace(/\s+/g, " ").trim();
  return summary ? summary.slice(0, MAXIMUM_ERROR_SUMMARY_LENGTH) : null;
}

export function storefrontProductPath(kind: string | null, slug: string | null): string | null {
  if (!slug || (kind !== "tire" && kind !== "wheel")) return null;
  return `/${kind === "tire" ? "tires" : "wheels"}/${encodeURIComponent(slug)}`;
}

export function summarizeReservations(rows: AdminOrderReservationRow[]): AdminOrderReservation {
  if (rows.length === 0) return { state: "none", expiresAt: null, expired: false };
  if (rows.some((row) => row.expired)) return { state: "expired", expiresAt: null, expired: true };
  const active = rows.filter((row) => row.status === "active");
  if (active.length > 0) {
    const earliest = Math.min(...active.map((row) => new Date(row.expires_at).getTime()));
    return { state: "active", expiresAt: new Date(earliest).toISOString(), expired: false };
  }
  if (rows.some((row) => row.status === "consumed")) {
    return { state: "consumed", expiresAt: null, expired: false };
  }
  return { state: "released", expiresAt: null, expired: false };
}

function toComment(row: OrderCommentRow): AdminOrderComment {
  return {
    id: row.id,
    body: row.body,
    author: row.author_user_id
      ? { id: row.author_user_id, name: row.author_name ?? "Сотрудник" }
      : null,
    createdAt: toIsoString(row.created_at),
  };
}

/** RAISE EXCEPTION 'ORDER_RESERVATION_EXPIRED' of the reservation trigger (migration 006). */
function isReservationTriggerError(error: unknown): boolean {
  return error instanceof Error && error.message === "ORDER_RESERVATION_EXPIRED";
}

export class AdminOrderService {
  private readonly adminOrderRepository: NonNullable<AdminOrderServiceOptions["adminOrderRepository"]>;
  private readonly commentRepository: NonNullable<AdminOrderServiceOptions["commentRepository"]>;
  private readonly notificationOutboxRepository: AdminOrderServiceOptions["notificationOutboxRepository"];
  private readonly customerStatusNotifications: boolean;

  constructor(
    private readonly pool: Pool,
    private readonly orderRepository: Pick<OrderRepository, "updateStatus">,
    private readonly auditRepository: Pick<AdminAuditRepository, "record">,
    options: AdminOrderServiceOptions = {},
  ) {
    this.adminOrderRepository = options.adminOrderRepository ?? new AdminOrderRepository();
    this.commentRepository = options.commentRepository ?? new OrderCommentRepository();
    this.notificationOutboxRepository = options.notificationOutboxRepository;
    this.customerStatusNotifications = Boolean(
      options.customerStatusNotifications && options.notificationOutboxRepository,
    );
  }

  async listOrders(
    query: AdminOrderListQuery,
  ): Promise<{ items: AdminOrderListItem[]; pagination: AdminOrderPagination }> {
    const filters = {
      q: query.q,
      status: query.status,
      integrationStatus: query.integrationStatus,
      from: query.from,
      to: query.to,
    };
    const total = await this.adminOrderRepository.countOrders(this.pool, filters);
    const offset = (query.page - 1) * query.pageSize;
    const rows =
      offset < total
        ? await this.adminOrderRepository.listOrders(this.pool, filters, {
            limit: query.pageSize,
            offset,
          })
        : [];
    return {
      items: rows.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        paymentStatus: order.payment_status,
        integrationStatus: order.integration_status,
        total: Number(order.total_kopecks) / 100,
        deliveryMethod: order.delivery_method,
        createdAt: toIsoString(order.created_at),
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        items: order.items.map((item) => ({
          name: item.product_name,
          sku: item.sku,
          quantity: item.quantity,
          total: Number(item.total_kopecks) / 100,
        })),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async getOrderDetails(orderId: string): Promise<AdminOrderDetails | null> {
    const repository = this.adminOrderRepository;
    const order = await repository.findOrder(this.pool, orderId);
    if (!order) return null;
    const items = await repository.listItems(this.pool, orderId);
    const history = await repository.listStatusHistory(this.pool, orderId);
    const reservations = await repository.listReservations(this.pool, orderId);
    const queueItem = await repository.findQueueItem(this.pool, orderId);
    const comments = await this.commentRepository.listForOrder(this.pool, orderId);

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.payment_status,
      createdAt: toIsoString(order.created_at),
      updatedAt: toIsoString(order.updated_at),
      customer: {
        name: order.customer_name,
        phone: order.customer_phone,
        email: order.customer_email,
        hasAccount: order.user_id !== null,
      },
      delivery: {
        method: order.delivery_method,
        address: order.delivery_address,
        requiresTireService: order.requires_tire_service,
      },
      customerComment: order.comment,
      totals: {
        subtotalKopecks: Number(order.subtotal_kopecks),
        discountKopecks: Number(order.discount_kopecks),
        deliveryKopecks: Number(order.delivery_kopecks),
        totalKopecks: Number(order.total_kopecks),
      },
      items: items.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.product_name,
        quantity: item.quantity,
        unitPriceKopecks: Number(item.unit_price_kopecks),
        discountKopecks: Number(item.discount_kopecks),
        totalKopecks: Number(item.total_kopecks),
        product: item.catalog_product_id
          ? {
              id: item.catalog_product_id,
              kind: item.product_kind ?? "",
              isActive: Boolean(item.product_is_active),
              storefrontPath: item.product_is_active
                ? storefrontProductPath(item.product_kind, item.product_slug)
                : null,
            }
          : null,
      })),
      reservation: summarizeReservations(reservations),
      statusHistory: history.map((entry) => ({
        id: entry.id,
        status: entry.status,
        actor: entry.actor_user_id
          ? { id: entry.actor_user_id, name: entry.actor_name ?? "Сотрудник" }
          : null,
        comment: entry.comment,
        createdAt: toIsoString(entry.created_at),
      })),
      integration: {
        status: order.integration_status,
        retryCount: order.retry_count,
        lastError: summarizeIntegrationError(order.last_error ?? queueItem?.last_error ?? null),
        lastAttemptAt: toIsoString(order.last_attempt_at),
        syncedAt: toIsoString(order.synced_at),
        externalId: order.external_id,
        nextAttemptAt:
          queueItem && queueItem.status !== "synced" ? toIsoString(queueItem.next_attempt_at) : null,
      },
      comments: comments.map(toComment),
    };
  }

  /**
   * Status change by staff. Transition rules and stock side effects are the
   * existing ones: an expired reservation allows only "new"/"cancelled"
   * (checked here for a clear message and again by the trigger of migration
   * 006, which also releases or consumes the holds). The actor and optional
   * comment go into order_status_history through the trigger of migration 012.
   */
  async updateStatus(
    actor: AdminOrderActor,
    orderId: string,
    input: UpdateOrderStatusInput,
  ): Promise<OrderStatusUpdateResult> {
    if (input.paymentStatus !== undefined && !canChangePaymentStatus(actor.role)) {
      throw paymentStatusForbidden();
    }
    try {
      return await withTransaction(this.pool, async (database) => {
        const order = await this.adminOrderRepository.lockOrder(database, orderId);
        if (!order) throw orderNotFound();
        const statusChanged = order.status !== input.status;
        if (!statusChanged && input.comment) {
          throw new ApplicationError({
            code: "ORDER_STATUS_UNCHANGED",
            message:
              "Заказ уже в этом статусе. Комментарий без смены статуса добавьте в блоке «Комментарии сотрудников».",
            statusCode: 409,
          });
        }
        if (
          !STATUSES_ALLOWED_WITH_EXPIRED_RESERVATION.includes(input.status) &&
          (await this.adminOrderRepository.hasExpiredReservation(database, orderId))
        ) {
          throw reservationExpired();
        }

        await this.adminOrderRepository.setStatusChangeContext(database, {
          actorUserId: actor.id,
          comment: input.comment ?? null,
        });
        const updated = await this.orderRepository.updateStatus(
          database,
          orderId,
          input.status,
          input.paymentStatus,
        );
        await this.adminOrderRepository.clearStatusChangeContext(database);
        if (!updated) throw orderNotFound();

        await this.auditRepository.record(database, {
          actorUserId: actor.id,
          action: "order.status_updated",
          entityType: "order",
          entityId: orderId,
          details: {
            orderId,
            previousStatus: order.status,
            status: input.status,
            ...(input.paymentStatus !== undefined
              ? { previousPaymentStatus: order.payment_status, paymentStatus: input.paymentStatus }
              : {}),
            hasComment: Boolean(input.comment),
          },
        });

        let notificationQueued = false;
        if (statusChanged && this.customerStatusNotifications && this.notificationOutboxRepository) {
          const notification = customerStatusNotification(
            { id: order.id, number: order.number, customerEmail: order.customer_email },
            input.status,
          );
          if (notification) {
            await this.notificationOutboxRepository.enqueue(database, notification);
            notificationQueued = true;
          }
        }
        return { status: input.status, previousStatus: order.status, notificationQueued };
      });
    } catch (error) {
      if (isReservationTriggerError(error)) throw reservationExpired();
      throw error;
    }
  }

  /** Payment status: role admin only (managers see it read-only). */
  async updatePaymentStatus(
    actor: AdminOrderActor,
    orderId: string,
    input: UpdatePaymentStatusInput,
  ): Promise<{ paymentStatus: string; changed: boolean }> {
    if (!canChangePaymentStatus(actor.role)) throw paymentStatusForbidden();
    return withTransaction(this.pool, async (database) => {
      const order = await this.adminOrderRepository.lockOrder(database, orderId);
      if (!order) throw orderNotFound();
      if (order.payment_status === input.paymentStatus) {
        return { paymentStatus: order.payment_status, changed: false };
      }
      await this.adminOrderRepository.updatePaymentStatus(database, orderId, input.paymentStatus);
      await this.auditRepository.record(database, {
        actorUserId: actor.id,
        action: "order.payment_status_updated",
        entityType: "order",
        entityId: orderId,
        details: {
          orderId,
          previousPaymentStatus: order.payment_status,
          paymentStatus: input.paymentStatus,
        },
      });
      return { paymentStatus: input.paymentStatus, changed: true };
    });
  }

  /** Internal staff comment; the text is kept only in order_comments (not in the audit log). */
  async addComment(
    actor: AdminOrderActor,
    orderId: string,
    input: CreateOrderCommentInput,
  ): Promise<AdminOrderComment> {
    return withTransaction(this.pool, async (database) => {
      const order = await this.adminOrderRepository.lockOrder(database, orderId);
      if (!order) throw orderNotFound();
      const comment = await this.commentRepository.create(database, {
        orderId,
        authorUserId: actor.id,
        body: input.body,
      });
      await this.auditRepository.record(database, {
        actorUserId: actor.id,
        action: "order.comment_added",
        entityType: "order",
        entityId: orderId,
        details: { orderId, commentId: comment.id, length: input.body.length },
      });
      return toComment(comment);
    });
  }
}

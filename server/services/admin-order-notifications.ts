import type { OrderStatus } from "../../lib/admin/order-statuses";
import type { NotificationOutboxItem } from "../repositories/notification-outbox-repository";

/**
 * Customer email about a staff status change. It is only put into
 * notification_outbox (same transaction as the status change); the
 * notification job delivers it later. Staff comments are internal and are
 * never part of the message.
 */
export const CUSTOMER_ORDER_STATUS_TEMPLATE = "customer-order-status-changed";

/** Statuses the customer needs to know about; "processing" and "completed" are internal steps. */
export const CUSTOMER_NOTIFIED_STATUSES: readonly OrderStatus[] = [
  "confirmed",
  "ready_for_pickup",
  "shipped",
  "cancelled",
];

const CUSTOMER_STATUS_SENTENCES: Partial<Record<OrderStatus, { subject: string; text: string }>> = {
  confirmed: {
    subject: "подтверждён",
    text: "подтверждён. Менеджер свяжется с вами, если потребуется уточнение.",
  },
  ready_for_pickup: { subject: "готов к выдаче", text: "готов к выдаче." },
  shipped: { subject: "передан в доставку", text: "передан в доставку." },
  cancelled: {
    subject: "отменён",
    text: "отменён. Если это ошибка, свяжитесь с магазином.",
  },
};

export function isCustomerNotifiedStatus(status: string): status is OrderStatus {
  return (CUSTOMER_NOTIFIED_STATUSES as readonly string[]).includes(status);
}

/** Outbox entry for a status change, or null when the customer is not notified. */
export function customerStatusNotification(
  order: { id: string; number: string; customerEmail: string | null },
  status: string,
): Omit<NotificationOutboxItem, "id"> | null {
  if (!order.customerEmail || !isCustomerNotifiedStatus(status)) return null;
  return {
    channel: "email",
    template: CUSTOMER_ORDER_STATUS_TEMPLATE,
    recipient: order.customerEmail,
    payload: { orderId: order.id, orderNumber: order.number, status },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Email content of CUSTOMER_ORDER_STATUS_TEMPLATE, for the delivery provider
 * (`yandex-postbox-notification-provider.ts` renders templates by name).
 * Throws on an unknown status like the provider does for unknown templates.
 */
export function renderCustomerOrderStatusNotification(payload: unknown): {
  subject: string;
  text: string;
  html: string;
} {
  const read = (key: string) => {
    if (typeof payload !== "object" || payload === null) return "";
    const value = Reflect.get(payload, key);
    return typeof value === "string" ? value : "";
  };
  const orderNumber = read("orderNumber");
  const sentence = CUSTOMER_STATUS_SENTENCES[read("status") as OrderStatus];
  if (!orderNumber || !sentence) throw new Error("UNSUPPORTED_NOTIFICATION_PAYLOAD");
  return {
    subject: `Заказ ${orderNumber} ${sentence.subject}`,
    text: `Заказ ${orderNumber} ${sentence.text}`,
    html: `<p>Заказ <strong>${escapeHtml(orderNumber)}</strong> ${escapeHtml(sentence.text)}</p>`,
  };
}

/**
 * Order, payment and 1C transfer statuses of the admin order screens, with
 * Russian labels. The value lists are the ones already accepted by the code
 * base (admin status endpoint, 1C order-status sync, orders.integration_status
 * CHECK); server validators import them from here.
 */

export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "processing",
  "ready_for_pickup",
  "shipped",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  processing: "В работе",
  ready_for_pickup: "Готов к выдаче",
  shipped: "Отправлен",
  completed: "Завершён",
  cancelled: "Отменён",
};

/** Statuses a staff member may set while the order reservation has expired (migration 006). */
export const STATUSES_ALLOWED_WITH_EXPIRED_RESERVATION: readonly OrderStatus[] = [
  "new",
  "cancelled",
];

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Ожидает оплаты",
  paid: "Оплачен",
  failed: "Ошибка оплаты",
  refunded: "Возврат оплаты",
};

export const INTEGRATION_STATUSES = ["pending", "processing", "synced", "failed"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  pending: "Ожидает передачи",
  processing: "Передаётся",
  synced: "Передан в 1С",
  failed: "Ошибка передачи",
};

export const DELIVERY_METHOD_LABELS: Record<string, string> = {
  pickup: "Самовывоз",
  courier: "Доставка по городу",
  transport_company: "Транспортная компания",
};

export const RESERVATION_STATE_LABELS = {
  none: "Резерва нет",
  active: "Товар зарезервирован",
  expired: "Резерв истёк",
  released: "Резерв снят",
  consumed: "Списано со склада",
} as const;
export type ReservationState = keyof typeof RESERVATION_STATE_LABELS;

/** Label for a known value, the raw value otherwise (for example a status set by a newer 1C). */
export function statusLabel(labels: Record<string, string>, value: string): string {
  return Object.hasOwn(labels, value) ? labels[value] : value;
}

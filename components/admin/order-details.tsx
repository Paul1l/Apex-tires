"use client";

import { useId, useState } from "react";
import { adminOrderRequest, requestErrorMessage } from "@/lib/admin/order-client";
import { formatStoreDateTime } from "@/lib/admin/order-dates";
import { formatKopecks, formatPhone } from "@/lib/admin/order-format";
import {
  DELIVERY_METHOD_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  RESERVATION_STATE_LABELS,
  statusLabel,
} from "@/lib/admin/order-statuses";
import type { AdminOrderDetails, AdminOrderDetailsResponse } from "@/lib/admin/order-types";
import { OrderComments } from "./order-comments";
import { OrderIntegrationCard } from "./order-integration-card";
import { OrderPaymentForm } from "./order-payment-form";
import { OrderStatusForm } from "./order-status-form";
import styles from "./order-details.module.css";

function statusTone(status: string): string | undefined {
  if (status === "new") return "new";
  if (status === "cancelled") return "cancelled";
  return undefined;
}

function CardHead({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div className="admin-card-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
    </div>
  );
}

function OrderItems({ order }: { order: AdminOrderDetails }) {
  const titleId = useId();
  const { totals } = order;
  return (
    <section className="admin-card" aria-labelledby={titleId}>
      <CardHead id={titleId} eyebrow="Состав" title="Товары в заказе" />
      <div className="admin-table-wrap">
        <table className={`admin-table ${styles.itemsTable}`}>
          <thead>
            <tr>
              <th scope="col">Товар</th>
              <th scope="col">Артикул</th>
              <th scope="col" className={styles.numeric}>Кол-во</th>
              <th scope="col" className={styles.numeric}>Цена</th>
              <th scope="col" className={styles.numeric}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <span className={styles.itemName}>
                    <strong>{item.name}</strong>
                    {item.product?.storefrontPath ? (
                      <a href={item.product.storefrontPath} target="_blank" rel="noopener noreferrer">
                        Открыть на витрине<span className="sr-only"> (в новой вкладке)</span>
                      </a>
                    ) : (
                      <small>{item.product ? "Товар скрыт на витрине" : "Товара больше нет в каталоге"}</small>
                    )}
                  </span>
                </td>
                <td><code>{item.sku}</code></td>
                <td className={styles.numeric}>{item.quantity}</td>
                <td className={styles.numeric}>{formatKopecks(item.unitPriceKopecks)}</td>
                <td className={styles.numeric}><strong>{formatKopecks(item.totalKopecks)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className={styles.totals}>
        <dt>Товары</dt>
        <dd>{formatKopecks(totals.subtotalKopecks)}</dd>
        {totals.discountKopecks > 0 && (
          <>
            <dt>Скидка</dt>
            <dd>−{formatKopecks(totals.discountKopecks)}</dd>
          </>
        )}
        <dt>Доставка</dt>
        <dd>{formatKopecks(totals.deliveryKopecks)}</dd>
        <dt className={styles.grandTotal}>Итого</dt>
        <dd className={styles.grandTotal}>{formatKopecks(totals.totalKopecks)}</dd>
      </dl>
    </section>
  );
}

function StatusHistory({ order }: { order: AdminOrderDetails }) {
  const titleId = useId();
  return (
    <section className="admin-card" aria-labelledby={titleId}>
      <CardHead id={titleId} eyebrow="История" title="История статусов" />
      {order.statusHistory.length === 0 ? (
        <p className={styles.emptyText}>Записей пока нет.</p>
      ) : (
        <ol className={styles.timeline} aria-label="Изменения статуса, новые сверху">
          {order.statusHistory.map((entry) => (
            <li key={entry.id}>
              <div className={styles.entryHead}>
                <strong>{statusLabel(ORDER_STATUS_LABELS, entry.status)}</strong>
                <time dateTime={entry.createdAt}>{formatStoreDateTime(entry.createdAt)}</time>
                <span>
                  {entry.actor ? `Изменил: ${entry.actor.name}` : "Оформление заказа, 1С или система"}
                </span>
              </div>
              {entry.comment && <p className={styles.entryText}>{entry.comment}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CustomerAndDelivery({ order }: { order: AdminOrderDetails }) {
  const customerTitleId = useId();
  const deliveryTitleId = useId();
  const { customer, delivery, reservation } = order;
  return (
    <>
      <section className="admin-card" aria-labelledby={customerTitleId}>
        <CardHead id={customerTitleId} eyebrow="Покупатель" title="Контакты" />
        <div className={styles.cardBody}>
          <dl className={styles.facts}>
            <dt>Имя</dt>
            <dd>{customer.name}</dd>
            <dt>Телефон</dt>
            <dd><a href={`tel:${customer.phone}`}>{formatPhone(customer.phone)}</a></dd>
            <dt>Email</dt>
            <dd>{customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : "не указан"}</dd>
            <dt>Аккаунт</dt>
            <dd>{customer.hasAccount ? "Оформлен из личного кабинета" : "Без входа в аккаунт"}</dd>
          </dl>
        </div>
      </section>
      <section className="admin-card" aria-labelledby={deliveryTitleId}>
        <CardHead id={deliveryTitleId} eyebrow="Получение" title="Доставка и резерв" />
        <div className={styles.cardBody}>
          <dl className={styles.facts}>
            <dt>Способ</dt>
            <dd>{statusLabel(DELIVERY_METHOD_LABELS, delivery.method)}</dd>
            {delivery.address && (
              <>
                <dt>Адрес</dt>
                <dd className={styles.multiline}>{delivery.address}</dd>
              </>
            )}
            <dt>Шиномонтаж</dt>
            <dd>{delivery.requiresTireService ? "Нужен" : "Не нужен"}</dd>
            <dt>Комментарий покупателя</dt>
            <dd className={styles.multiline}>{order.customerComment || "—"}</dd>
            <dt>Резерв</dt>
            <dd>
              {RESERVATION_STATE_LABELS[reservation.state]}
              {reservation.state === "active" && reservation.expiresAt
                ? ` до ${formatStoreDateTime(reservation.expiresAt)}`
                : ""}
            </dd>
          </dl>
        </div>
      </section>
    </>
  );
}

/** Admin order page: everything about one order and the staff actions on it. */
export function OrderDetails({
  initialOrder,
  canChangePaymentStatus,
}: {
  initialOrder: AdminOrderDetails;
  canChangePaymentStatus: boolean;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [refreshError, setRefreshError] = useState("");

  async function refresh(): Promise<void> {
    try {
      const response = await adminOrderRequest<AdminOrderDetailsResponse>(
        `/api/admin/orders/${order.id}`,
        { fallbackMessage: "Не удалось обновить данные заказа." },
      );
      setOrder(response.order);
      setRefreshError("");
    } catch (error) {
      setRefreshError(
        `${requestErrorMessage(error, "Не удалось обновить данные заказа.")} Обновите страницу.`,
      );
    }
  }

  return (
    <>
      <div className="admin-page-intro">
        <div>
          <p className="eyebrow">Заказ</p>
          <h1>Заказ {order.number}</h1>
          <span>
            Создан {formatStoreDateTime(order.createdAt)} · изменён {formatStoreDateTime(order.updatedAt)}{" "}
            (время Барнаула)
          </span>
        </div>
        <div className={styles.introMeta}>
          <span className={styles.badge} data-tone={statusTone(order.status)}>
            {statusLabel(ORDER_STATUS_LABELS, order.status)}
          </span>
          <span className={styles.badge} data-tone="muted">
            Оплата: {statusLabel(PAYMENT_STATUS_LABELS, order.paymentStatus)}
          </span>
        </div>
      </div>
      {refreshError && (
        <p className={`${styles.errorMessage} ${styles.pageMessage}`} role="alert">
          {refreshError}
        </p>
      )}
      <div className={styles.layout}>
        <div className={styles.column}>
          <OrderItems order={order} />
          <StatusHistory order={order} />
          <OrderComments
            orderId={order.id}
            comments={order.comments}
            onAdded={(comment) =>
              setOrder((current) => ({ ...current, comments: [comment, ...current.comments] }))
            }
          />
        </div>
        <div className={styles.column}>
          <OrderStatusForm order={order} onChanged={refresh} />
          <OrderPaymentForm order={order} canChange={canChangePaymentStatus} onChanged={refresh} />
          <CustomerAndDelivery order={order} />
          <OrderIntegrationCard integration={order.integration} onRetried={refresh} />
        </div>
      </div>
    </>
  );
}

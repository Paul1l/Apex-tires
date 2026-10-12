"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, ShoppingCart, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  adminOrderRequest,
  isAbortError,
  requestErrorMessage,
} from "@/lib/admin/order-client";
import { formatStoreDateTime } from "@/lib/admin/order-dates";
import { formatPhone, formatRubles, pluralize } from "@/lib/admin/order-format";
import {
  EMPTY_ORDER_LIST_FILTERS,
  hasActiveOrderFilters,
  orderListQuerySuffix,
  orderListSearchParams,
  type OrderListFilters,
} from "@/lib/admin/order-list-query";
import {
  INTEGRATION_STATUS_LABELS,
  INTEGRATION_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  PAYMENT_STATUS_LABELS,
  statusLabel,
} from "@/lib/admin/order-statuses";
import type {
  AdminOrderListItem,
  AdminOrderListResponse,
  AdminOrderPagination,
} from "@/lib/admin/order-types";
import styles from "./order-list.module.css";

/**
 * Admin order list: search, filters, server-side pagination, quick status
 * change and a link to the order page. Used inside the dashboard and on
 * /admin/orders (syncWithUrl keeps the filters in the address bar there).
 */
export function OrdersSection({
  initialFilters = EMPTY_ORDER_LIST_FILTERS,
  syncWithUrl = false,
}: {
  initialFilters?: OrderListFilters;
  syncWithUrl?: boolean;
}) {
  const [filters, setFilters] = useState<OrderListFilters>(initialFilters);
  const [draft, setDraft] = useState<OrderListFilters>(initialFilters);
  const [orders, setOrders] = useState<AdminOrderListItem[]>([]);
  const [pagination, setPagination] = useState<AdminOrderPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [actionMessage, setActionMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // After «Назад»/«Далее» focus moves to the results (the clicked button may become disabled).
  const resultsRef = useRef<HTMLDivElement>(null);
  const focusResultsAfterLoad = useRef(false);
  const listQuery = orderListSearchParams(filters).toString();
  const detailsSuffix = orderListQuerySuffix(filters);

  useEffect(() => {
    if (!syncWithUrl) return;
    const target = `/admin/orders${listQuery ? `?${listQuery}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [listQuery, syncWithUrl]);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    void adminOrderRequest<AdminOrderListResponse>(
      `/api/admin/orders${listQuery ? `?${listQuery}` : ""}`,
      { signal: abortController.signal, fallbackMessage: "Заказы недоступны." },
    )
      .then((result) => {
        setOrders(result.items);
        setPagination(result.pagination);
        setLoadError("");
        const total = result.pagination.total;
        setAnnouncement(
          total === 0
            ? "Заказы не найдены."
            : `Найдено ${total} ${pluralize(total, ["заказ", "заказа", "заказов"])}, страница ${result.pagination.page} из ${result.pagination.totalPages}.`,
        );
        if (focusResultsAfterLoad.current) {
          focusResultsAfterLoad.current = false;
          requestAnimationFrame(() => resultsRef.current?.focus());
        }
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        const message = requestErrorMessage(error, "Заказы недоступны.");
        setLoadError(message);
        setAnnouncement(message);
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });
    return () => abortController.abort();
  }, [listQuery, reloadToken]);

  function applyFilters(next: OrderListFilters) {
    setDraft(next);
    setFilters(next);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setActionMessage({ text: "Дата «по» не может быть раньше даты «с».", error: true });
      return;
    }
    setActionMessage(null);
    applyFilters({ ...draft, q: draft.q.trim(), page: 1 });
  }

  function goToPage(page: number) {
    focusResultsAfterLoad.current = true;
    applyFilters({ ...filters, page });
  }

  async function updateStatus(order: AdminOrderListItem, status: string) {
    if (
      status === "cancelled" &&
      !window.confirm(`Отменить заказ ${order.number}? Резерв товара будет снят.`)
    ) {
      return;
    }
    setActionMessage(null);
    try {
      await adminOrderRequest(`/api/admin/orders/${order.id}/status`, {
        method: "PATCH",
        body: { status },
        fallbackMessage: "Статус не обновлён.",
      });
      setOrders((current) =>
        current.map((item) => (item.id === order.id ? { ...item, status } : item)),
      );
      setActionMessage({
        text: `Заказ ${order.number}: статус «${statusLabel(ORDER_STATUS_LABELS, status)}».`,
        error: false,
      });
    } catch (error) {
      setActionMessage({ text: requestErrorMessage(error, "Статус не обновлён."), error: true });
    }
  }

  const firstShown = pagination && orders.length > 0 ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const lastShown = pagination ? firstShown + orders.length - Math.min(1, orders.length) : 0;

  return (
    <>
      <div className="admin-page-intro">
        <div>
          <p className="eyebrow">Продажи</p>
          <h1>Заказы</h1>
          <span>Поиск по номеру, телефону, email или имени покупателя. Время — по Барнаулу.</span>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {actionMessage && (
        <p
          className={actionMessage.error ? styles.errorMessage : styles.successMessage}
          role={actionMessage.error ? "alert" : "status"}
        >
          {actionMessage.text}
        </p>
      )}
      <article className="admin-card products-card">
        <form
          className={`admin-products-toolbar ${styles.toolbar}`}
          role="search"
          aria-label="Поиск и фильтры заказов"
          onSubmit={submitSearch}
        >
          <label className="admin-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Номер заказа, телефон, email или имя покупателя</span>
            <input
              type="search"
              value={draft.q}
              maxLength={100}
              placeholder="Номер, телефон, email, имя"
              onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Статус</span>
            <select
              value={draft.status}
              onChange={(event) => applyFilters({ ...draft, status: event.target.value, page: 1 })}
            >
              <option value="">Все статусы</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>{ORDER_STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Передача в 1С</span>
            <select
              value={draft.integrationStatus}
              onChange={(event) =>
                applyFilters({ ...draft, integrationStatus: event.target.value, page: 1 })
              }
            >
              <option value="">Все</option>
              {INTEGRATION_STATUSES.map((status) => (
                <option key={status} value={status}>{INTEGRATION_STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>С даты</span>
            <input
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>По дату</span>
            <input
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>
          <div className={styles.toolbarActions}>
            <button className="admin-primary-button" type="submit">Найти</button>
            {hasActiveOrderFilters(filters) && (
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() => applyFilters({ ...EMPTY_ORDER_LIST_FILTERS })}
              >
                <X size={15} aria-hidden="true" /> Сбросить
              </button>
            )}
          </div>
        </form>

        {loadError ? (
          <div className="admin-empty" role="alert">
            <ShoppingCart aria-hidden="true" />
            <strong>{loadError}</strong>
            <button className="admin-secondary-button" type="button" onClick={() => setReloadToken((value) => value + 1)}>
              Повторить
            </button>
          </div>
        ) : !pagination && loading ? (
          <div className="admin-empty"><ShoppingCart aria-hidden="true" /><strong>Загружаем заказы…</strong></div>
        ) : orders.length === 0 && pagination && pagination.total > 0 ? (
          <div className="admin-empty">
            <ShoppingCart aria-hidden="true" />
            <strong>На этой странице заказов нет</strong>
            <button className="admin-secondary-button" type="button" onClick={() => goToPage(1)}>
              К первой странице
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="admin-empty">
            <ShoppingCart aria-hidden="true" />
            <strong>{hasActiveOrderFilters(filters) ? "По этим условиям заказов нет" : "Заказов пока нет"}</strong>
          </div>
        ) : (
          <div
            className="admin-table-wrap"
            aria-busy={loading}
            aria-label="Список заказов"
            ref={resultsRef}
            role="region"
            tabIndex={-1}
          >
            <table className={`admin-table orders-table ${styles.table}`}>
              <caption className="sr-only">Заказы, новые сверху</caption>
              <thead>
                <tr>
                  <th scope="col">Номер</th>
                  <th scope="col">Дата</th>
                  <th scope="col">Покупатель</th>
                  <th scope="col">Состав</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Оплата</th>
                  <th scope="col">1С</th>
                  <th scope="col">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link className={styles.orderLink} href={`/admin/orders/${order.id}${detailsSuffix}`}>
                        {order.number}
                      </Link>
                    </td>
                    <td>{formatStoreDateTime(order.createdAt)}</td>
                    <td>
                      {order.customerName}
                      <small>{formatPhone(order.customerPhone)}</small>
                    </td>
                    <td className={styles.itemsCell}>
                      {order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}
                    </td>
                    <td>
                      <select
                        className="status-select"
                        aria-label={`Статус заказа ${order.number}`}
                        value={order.status}
                        onChange={(event) => void updateStatus(order, event.target.value)}
                      >
                        {!(ORDER_STATUSES as readonly string[]).includes(order.status) && (
                          <option value={order.status}>{order.status}</option>
                        )}
                        {ORDER_STATUSES.map((status) => (
                          <option key={status} value={status}>{ORDER_STATUS_LABELS[status]}</option>
                        ))}
                      </select>
                    </td>
                    <td>{statusLabel(PAYMENT_STATUS_LABELS, order.paymentStatus)}</td>
                    <td>
                      <span className={order.integrationStatus === "failed" ? styles.integrationFailed : undefined}>
                        {statusLabel(INTEGRATION_STATUS_LABELS, order.integrationStatus)}
                      </span>
                    </td>
                    <td><strong>{formatRubles(order.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination && orders.length > 0 && !loadError && (
          <nav className="admin-table-footer" aria-label="Страницы списка заказов">
            <span>
              Показаны {firstShown}–{lastShown} из {pagination.total}
            </span>
            <div className={styles.pager}>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => goToPage(pagination.page - 1)}
              >
                <ChevronLeft size={15} aria-hidden="true" /> Назад
              </button>
              <span>
                Страница {pagination.page} из {pagination.totalPages}
              </span>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => goToPage(pagination.page + 1)}
              >
                Далее <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
          </nav>
        )}
      </article>
    </>
  );
}

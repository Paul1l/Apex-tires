"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { adminOrderRequest, requestErrorMessage } from "@/lib/admin/order-client";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  STATUSES_ALLOWED_WITH_EXPIRED_RESERVATION,
  statusLabel,
  type OrderStatus,
} from "@/lib/admin/order-statuses";
import type { AdminOrderDetails, AdminOrderStatusUpdateResponse } from "@/lib/admin/order-types";
import styles from "./order-details.module.css";

const COMMENT_LIMIT = 2_000;

/** What the database trigger does to the stock for the selected status (migration 006). */
function sideEffectHint(order: AdminOrderDetails, status: string): string {
  if (status === order.status) return "";
  if (status === "cancelled") {
    return order.reservation.state === "active"
      ? "Резерв товара будет снят, остаток вернётся в продажу."
      : "Заказ будет отменён.";
  }
  if ((status === "shipped" || status === "completed") && order.reservation.state === "active") {
    return "Зарезервированный товар будет списан со склада.";
  }
  if (order.status === "cancelled" && order.reservation.state !== "active") {
    return "Резерв отменённого заказа не восстанавливается: проверьте наличие перед продолжением.";
  }
  return "";
}

export function OrderStatusForm({
  order,
  onChanged,
}: {
  order: AdminOrderDetails;
  onChanged: () => Promise<void>;
}) {
  const statusId = useId();
  const commentId = useId();
  const hintId = useId();
  const confirmId = useId();
  const [status, setStatus] = useState(order.status);
  const [comment, setComment] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setStatus(order.status);
  }, [order.status]);

  useEffect(() => {
    if (confirmingCancel) confirmButtonRef.current?.focus();
  }, [confirmingCancel]);

  const reservationExpired = order.reservation.expired;
  const hint = sideEffectHint(order, status);

  async function save() {
    setPending(true);
    setResult(null);
    try {
      const trimmedComment = comment.trim();
      const response = await adminOrderRequest<AdminOrderStatusUpdateResponse>(
        `/api/admin/orders/${order.id}/status`,
        {
          method: "PATCH",
          body: { status, ...(trimmedComment ? { comment: trimmedComment } : {}) },
          fallbackMessage: "Статус не изменён.",
        },
      );
      setComment("");
      setConfirmingCancel(false);
      setResult({
        text:
          `Статус изменён: «${statusLabel(ORDER_STATUS_LABELS, response.status)}».` +
          (response.notificationQueued ? " Уведомление покупателю поставлено в очередь." : ""),
        error: false,
      });
      await onChanged();
      // The submit button is disabled until another status is chosen.
      selectRef.current?.focus();
    } catch (error) {
      setConfirmingCancel(false);
      setResult({ text: requestErrorMessage(error, "Статус не изменён."), error: true });
      selectRef.current?.focus();
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (status === order.status) {
      setResult({ text: "Выберите новый статус заказа.", error: true });
      return;
    }
    if (status === "cancelled" && !confirmingCancel) {
      setResult(null);
      setConfirmingCancel(true);
      return;
    }
    void save();
  }

  return (
    <section className="admin-card" aria-labelledby={`${statusId}-title`}>
      <div className="admin-card-head">
        <div>
          <p className="eyebrow">Управление</p>
          <h2 id={`${statusId}-title`}>Статус заказа</h2>
        </div>
      </div>
      <form className={`${styles.cardBody} ${styles.form}`} onSubmit={submit} noValidate>
        {reservationExpired && (
          <p className={styles.warning}>
            Резерв истёк: можно только вернуть заказ в «Новый» или отменить. Проверьте наличие и
            оформите новый заказ, если товар нужен покупателю.
          </p>
        )}
        <label className={styles.control} htmlFor={statusId}>
          <span>Новый статус</span>
          <select
            ref={selectRef}
            id={statusId}
            value={status}
            aria-describedby={hint ? hintId : undefined}
            onChange={(event) => {
              setStatus(event.target.value);
              setConfirmingCancel(false);
              setResult(null);
            }}
          >
            {!(ORDER_STATUSES as readonly string[]).includes(order.status) && (
              <option value={order.status}>{order.status} (текущий)</option>
            )}
            {ORDER_STATUSES.map((value) => (
              <option
                key={value}
                value={value}
                disabled={
                  value !== order.status &&
                  reservationExpired &&
                  !STATUSES_ALLOWED_WITH_EXPIRED_RESERVATION.includes(value as OrderStatus)
                }
              >
                {ORDER_STATUS_LABELS[value]}
                {value === order.status ? " (текущий)" : ""}
              </option>
            ))}
          </select>
        </label>
        {hint && (
          <p className={styles.hint} id={hintId}>
            {hint}
          </p>
        )}
        <label className={styles.control} htmlFor={commentId}>
          <span>Комментарий к смене статуса</span>
          <textarea
            id={commentId}
            value={comment}
            maxLength={COMMENT_LIMIT}
            rows={3}
            aria-describedby={`${commentId}-hint`}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
        <p className={styles.hint} id={`${commentId}-hint`}>
          Необязательно. Сохраняется в истории статусов вместе с вашим именем; покупатель его не
          видит. Осталось {COMMENT_LIMIT - comment.length} из {COMMENT_LIMIT} символов.
        </p>
        {confirmingCancel ? (
          <div className={styles.confirm} role="group" aria-labelledby={confirmId}>
            <p id={confirmId}>
              <strong>Отменить заказ {order.number}?</strong> Резерв товара будет снят. Отмена
              попадёт в историю статусов.
            </p>
            <div className={styles.formActions}>
              <button
                ref={confirmButtonRef}
                className={`admin-primary-button ${styles.dangerButton}`}
                type="submit"
                disabled={pending}
              >
                {pending ? "Отменяем…" : "Да, отменить заказ"}
              </button>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirmingCancel(false);
                  submitButtonRef.current?.focus();
                }}
              >
                Не отменять
              </button>
            </div>
          </div>
        ) : null}
        <div className={styles.formActions} hidden={confirmingCancel}>
          <button
            ref={submitButtonRef}
            className="admin-primary-button"
            type="submit"
            disabled={pending || status === order.status}
          >
            {pending ? "Сохраняем…" : "Сменить статус"}
          </button>
        </div>
        <div aria-live="polite" aria-atomic="true">
          {result && (
            <p className={result.error ? styles.errorMessage : styles.successMessage} role={result.error ? "alert" : undefined}>
              {result.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

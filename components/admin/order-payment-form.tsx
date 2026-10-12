"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { adminOrderRequest, requestErrorMessage } from "@/lib/admin/order-client";
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUSES,
  statusLabel,
} from "@/lib/admin/order-statuses";
import type { AdminOrderDetails } from "@/lib/admin/order-types";
import styles from "./order-details.module.css";

/** Payment status: editable by the admin role, read-only for managers. */
export function OrderPaymentForm({
  order,
  canChange,
  onChanged,
}: {
  order: AdminOrderDetails;
  canChange: boolean;
  onChanged: () => Promise<void>;
}) {
  const fieldId = useId();
  const [paymentStatus, setPaymentStatus] = useState(order.paymentStatus);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setPaymentStatus(order.paymentStatus);
  }, [order.paymentStatus]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || paymentStatus === order.paymentStatus) return;
    setPending(true);
    setResult(null);
    try {
      await adminOrderRequest(`/api/admin/orders/${order.id}/payment`, {
        method: "PATCH",
        body: { paymentStatus },
        fallbackMessage: "Статус оплаты не сохранён.",
      });
      setResult({
        text: `Статус оплаты: «${statusLabel(PAYMENT_STATUS_LABELS, paymentStatus)}».`,
        error: false,
      });
      await onChanged();
      // The save button is disabled again once the status is stored.
      selectRef.current?.focus();
    } catch (error) {
      setResult({ text: requestErrorMessage(error, "Статус оплаты не сохранён."), error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="admin-card" aria-labelledby={`${fieldId}-title`}>
      <div className="admin-card-head">
        <div>
          <p className="eyebrow">Оплата</p>
          <h2 id={`${fieldId}-title`}>Статус оплаты</h2>
        </div>
      </div>
      {canChange ? (
        <form className={`${styles.cardBody} ${styles.form}`} onSubmit={submit}>
          <label className={styles.control} htmlFor={fieldId}>
            <span>Оплата</span>
            <select
              ref={selectRef}
              id={fieldId}
              value={paymentStatus}
              onChange={(event) => {
                setPaymentStatus(event.target.value);
                setResult(null);
              }}
            >
              {!(PAYMENT_STATUSES as readonly string[]).includes(order.paymentStatus) && (
                <option value={order.paymentStatus}>{order.paymentStatus}</option>
              )}
              {PAYMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_STATUS_LABELS[value]}
                  {value === order.paymentStatus ? " (текущий)" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.hint}>
            Меняет только администратор. Изменение записывается в журнал действий.
          </p>
          <div className={styles.formActions}>
            <button
              className="admin-secondary-button"
              type="submit"
              disabled={pending || paymentStatus === order.paymentStatus}
            >
              {pending ? "Сохраняем…" : "Сохранить оплату"}
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
      ) : (
        <div className={styles.cardBody}>
          <dl className={styles.facts}>
            <dt>Оплата</dt>
            <dd>{statusLabel(PAYMENT_STATUS_LABELS, order.paymentStatus)}</dd>
          </dl>
          <p className={styles.hint}>Статус оплаты меняет администратор.</p>
        </div>
      )}
    </section>
  );
}

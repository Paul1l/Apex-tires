"use client";

import { RefreshCw } from "lucide-react";
import { useId, useRef, useState } from "react";
import { adminOrderRequest, requestErrorMessage } from "@/lib/admin/order-client";
import { formatStoreDateTime } from "@/lib/admin/order-dates";
import { INTEGRATION_STATUS_LABELS, statusLabel } from "@/lib/admin/order-statuses";
import type { AdminOrderIntegration } from "@/lib/admin/order-types";
import styles from "./order-details.module.css";

/** Transfer of the order to 1C and the retry of failed transfers (same endpoint as «Обмен с 1С»). */
export function OrderIntegrationCard({
  integration,
  onRetried,
}: {
  integration: AdminOrderIntegration;
  onRetried: () => Promise<void>;
}) {
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function retry() {
    setPending(true);
    setResult(null);
    try {
      const response = await adminOrderRequest<{ retried?: number }>(
        "/api/admin/integrations/1c/retry",
        { method: "POST", fallbackMessage: "Повтор не запущен." },
      );
      setResult({ text: `Возвращено в очередь: ${response.retried ?? 0}.`, error: false });
      await onRetried();
      // The retry button disappears once the order is queued again.
      headingRef.current?.focus();
    } catch (error) {
      setResult({ text: requestErrorMessage(error, "Повтор не запущен."), error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="admin-card" aria-labelledby={titleId}>
      <div className="admin-card-head">
        <div>
          <p className="eyebrow">1С</p>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>Передача в 1С</h2>
        </div>
      </div>
      <div className={styles.cardBody}>
        <dl className={styles.facts}>
          <dt>Состояние</dt>
          <dd>
            <span className={styles.badge} data-tone={integration.status === "failed" ? "failed" : "muted"}>
              {statusLabel(INTEGRATION_STATUS_LABELS, integration.status)}
            </span>
          </dd>
          <dt>Попыток с ошибкой</dt>
          <dd>{integration.retryCount}</dd>
          <dt>Последняя попытка</dt>
          <dd>{formatStoreDateTime(integration.lastAttemptAt)}</dd>
          <dt>Передан</dt>
          <dd>{formatStoreDateTime(integration.syncedAt)}</dd>
          {integration.nextAttemptAt && (
            <>
              <dt>Следующая попытка</dt>
              <dd>{formatStoreDateTime(integration.nextAttemptAt)}</dd>
            </>
          )}
          {integration.externalId && (
            <>
              <dt>Номер в 1С</dt>
              <dd>{integration.externalId}</dd>
            </>
          )}
          {integration.lastError && (
            <>
              <dt>Ошибка</dt>
              <dd>{integration.lastError}</dd>
            </>
          )}
        </dl>
        {integration.status === "failed" && (
          <>
            <div className={`${styles.formActions} ${styles.spaced}`}>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={pending}
                aria-describedby={`${titleId}-retry-hint`}
                onClick={() => void retry()}
              >
                <RefreshCw size={15} aria-hidden="true" />
                {pending ? "Возвращаем в очередь…" : "Повторить неудачные отправки"}
              </button>
            </div>
            <p className={styles.hint} id={`${titleId}-retry-hint`}>
              Возвращает в очередь все заказы с ошибкой передачи, не только этот.
            </p>
          </>
        )}
        <div aria-live="polite" aria-atomic="true">
          {result && (
            <p
              className={`${result.error ? styles.errorMessage : styles.successMessage} ${styles.spaced}`}
              role={result.error ? "alert" : undefined}
            >
              {result.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

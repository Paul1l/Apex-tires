"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { adminOrderRequest, requestErrorMessage } from "@/lib/admin/order-client";
import { formatStoreDateTime } from "@/lib/admin/order-dates";
import type { AdminOrderComment, AdminOrderCommentResponse } from "@/lib/admin/order-types";
import styles from "./order-details.module.css";

const COMMENT_LIMIT = 2_000;

/** Internal staff comments: never shown to the customer. */
export function OrderComments({
  orderId,
  comments,
  onAdded,
}: {
  orderId: string;
  comments: AdminOrderComment[];
  onAdded: (comment: AdminOrderComment) => void;
}) {
  const fieldId = useId();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const text = body.trim();
    if (!text) {
      setResult({ text: "Введите текст комментария.", error: true });
      textareaRef.current?.focus();
      return;
    }
    setPending(true);
    setResult(null);
    try {
      const response = await adminOrderRequest<AdminOrderCommentResponse>(
        `/api/admin/orders/${orderId}/comments`,
        { method: "POST", body: { body: text }, fallbackMessage: "Комментарий не сохранён." },
      );
      onAdded(response.comment);
      setBody("");
      setResult({ text: "Комментарий добавлен.", error: false });
    } catch (error) {
      setResult({ text: requestErrorMessage(error, "Комментарий не сохранён."), error: true });
    } finally {
      setPending(false);
      textareaRef.current?.focus();
    }
  }

  return (
    <section className="admin-card" aria-labelledby={`${fieldId}-title`}>
      <div className="admin-card-head">
        <div>
          <p className="eyebrow">Только для сотрудников</p>
          <h2 id={`${fieldId}-title`}>Комментарии сотрудников</h2>
        </div>
      </div>
      <form className={`${styles.cardBody} ${styles.form}`} onSubmit={submit}>
        <label className={styles.control} htmlFor={fieldId}>
          <span>Новый комментарий</span>
          <textarea
            ref={textareaRef}
            id={fieldId}
            value={body}
            maxLength={COMMENT_LIMIT}
            rows={3}
            aria-describedby={`${fieldId}-hint`}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <p className={styles.hint} id={`${fieldId}-hint`}>
          Покупатель не видит эти комментарии. Осталось {COMMENT_LIMIT - body.length} из{" "}
          {COMMENT_LIMIT} символов.
        </p>
        <div className={styles.formActions}>
          <button className="admin-primary-button" type="submit" disabled={pending}>
            {pending ? "Сохраняем…" : "Добавить комментарий"}
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
      {comments.length === 0 ? (
        <p className={styles.emptyText}>Комментариев пока нет.</p>
      ) : (
        <ol className={styles.commentList} aria-label="Комментарии, новые сверху">
          {comments.map((comment) => (
            <li key={comment.id}>
              <div className={styles.entryHead}>
                <strong>{comment.author?.name ?? "Удалённый сотрудник"}</strong>
                <time dateTime={comment.createdAt}>{formatStoreDateTime(comment.createdAt)}</time>
              </div>
              <p className={styles.entryText}>{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

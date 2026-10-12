"use client";

import { useId, useState } from "react";
import { errorMessage } from "@/lib/admin/product-api";
import styles from "./product-editor.module.css";

interface ReferenceItem {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * Select of an existing brand or category with an inline "create" form.
 * Creating returns the stored item (an existing one with the same name is
 * reused by the server) and selects it.
 */
export function ProductReferenceSelect({
  label,
  items,
  value,
  onChange,
  onCreate,
  disabled = false,
  error,
  emptyLabel,
  createLabel,
}: {
  label: string;
  items: readonly ReferenceItem[];
  value: string;
  onChange: (value: string) => void;
  onCreate: (name: string) => Promise<ReferenceItem>;
  disabled?: boolean;
  error?: string;
  emptyLabel: string;
  createLabel: string;
}) {
  const id = useId();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  async function create() {
    if (!name.trim()) {
      setCreateError("Введите название.");
      return;
    }
    setBusy(true);
    setCreateError("");
    try {
      const item = await onCreate(name.trim());
      if (!item.isActive) {
        setCreateError(`«${item.name}» уже есть, но отключён — выбрать его нельзя.`);
        return;
      }
      onChange(item.id);
      setName("");
      setCreating(false);
    } catch (createFailure) {
      setCreateError(errorMessage(createFailure, "Не удалось сохранить."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.field} ${error ? styles.invalid : ""}`}>
      <label htmlFor={id}><span>{label}</span></label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <option value="">{emptyLabel}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id} disabled={!item.isActive && item.id !== value}>
            {item.name}{item.isActive ? "" : " (отключён)"}
          </option>
        ))}
      </select>
      {error && <small id={`${id}-error`} className={styles.fieldError}>{error}</small>}
      {!disabled && !creating && (
        <button type="button" className={styles.linkButton} onClick={() => setCreating(true)}>{createLabel}</button>
      )}
      {!disabled && creating && (
        <div className={styles.inlineCreate}>
          <input
            aria-label={`${createLabel}: название`}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
            }}
            placeholder="Название"
          />
          <button type="button" className={`admin-secondary-button ${styles.smallButton}`} disabled={busy} onClick={() => void create()}>
            {busy ? "Сохраняем…" : "Добавить"}
          </button>
          <button type="button" className={styles.linkButton} onClick={() => { setCreating(false); setCreateError(""); }}>Отмена</button>
        </div>
      )}
      {createError && <small className={styles.fieldError} role="alert">{createError}</small>}
    </div>
  );
}

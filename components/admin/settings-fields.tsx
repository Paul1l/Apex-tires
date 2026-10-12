"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type HTMLAttributes } from "react";
import styles from "./settings-section.module.css";

/** DOM id of the control for a settings path (contacts.email → settings-contacts-email). */
export function settingsFieldId(path: string): string {
  return `settings-${path.replace(/\./g, "-")}`;
}

function describedBy(...ids: Array<string | undefined>): string | undefined {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

function FieldMessages({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint && <p className={styles.hint} id={`${id}-hint`}>{hint}</p>}
      {error && <p className={styles.fieldError} id={`${id}-error`}>{error}</p>}
    </>
  );
}

interface TextFieldProps {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  wide?: boolean;
  type?: "text" | "email" | "tel" | "url";
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}

export function SettingsTextField({
  path,
  label,
  value,
  onChange,
  hint,
  error,
  wide,
  type = "text",
  inputMode,
  maxLength,
  placeholder,
  required,
  autoComplete = "off",
}: TextFieldProps) {
  const id = settingsFieldId(path);
  return (
    <div className={`${styles.field} ${wide ? styles.wide : ""} ${error ? styles.invalid : ""}`}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        className={styles.input}
        type={type}
        inputMode={inputMode}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        spellCheck={type === "text" ? undefined : false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
}

export function SettingsTextAreaField({
  path,
  label,
  value,
  onChange,
  hint,
  error,
  wide,
  maxLength,
  placeholder,
}: Omit<TextFieldProps, "type" | "inputMode" | "required" | "autoComplete">) {
  const id = settingsFieldId(path);
  return (
    <div className={`${styles.field} ${wide ? styles.wide : ""} ${error ? styles.invalid : ""}`}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className={styles.textarea}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
}

export function SettingsSwitchField({
  path,
  label,
  description,
  checked,
  onChange,
  error,
}: {
  path: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
}) {
  const id = settingsFieldId(path);
  return (
    <div className={`${styles.field} ${error ? styles.invalid : ""}`}>
      {/* settings-switch: the toggle look from app/globals.css. */}
      <label className={`${styles.switchRow} settings-switch`} htmlFor={id}>
        <span>
          <strong>{label}</strong>
          {description && <small id={`${id}-hint`}>{description}</small>}
        </span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(description && `${id}-hint`, error && `${id}-error`)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
      {error && <p className={styles.fieldError} id={`${id}-error`}>{error}</p>}
    </div>
  );
}

/**
 * Editable list of short strings (extra phones, other services). Errors come
 * keyed by path: `<path>` for the whole list, `<path>.<index>` for one row.
 */
export function SettingsListField({
  path,
  label,
  itemLabel,
  addLabel,
  emptyText,
  hint,
  items,
  onChange,
  maxItems,
  maxLength,
  errors,
  type = "text",
  inputMode,
  placeholder,
  readOnly,
}: {
  path: string;
  label: string;
  itemLabel: string;
  addLabel: string;
  emptyText: string;
  hint?: string;
  items: string[];
  onChange: (items: string[]) => void;
  maxItems: number;
  maxLength: number;
  errors: Record<string, string>;
  type?: "text" | "tel";
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  readOnly: boolean;
}) {
  const id = settingsFieldId(path);
  const listError = errors[path];
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    if (focusIndex === null) return;
    document.getElementById(settingsFieldId(`${path}.${focusIndex}`))?.focus();
    setFocusIndex(null);
  }, [focusIndex, path]);

  function add() {
    if (items.length >= maxItems) return;
    onChange([...items, ""]);
    setFocusIndex(items.length);
  }

  function remove(index: number) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
    // Focus stays in the list: the next row, or the previous one, or the add button.
    const next = Math.min(index, items.length - 2);
    if (next >= 0) setFocusIndex(next);
    else document.getElementById(`${id}-add`)?.focus();
  }

  return (
    <fieldset
      className={`${styles.fieldset} ${styles.field} ${styles.wide} ${listError ? styles.invalid : ""}`}
      aria-describedby={describedBy(hint && `${id}-hint`, listError && `${id}-error`)}
    >
      <legend className={`${styles.label} ${styles.legend}`}>{label}</legend>
      {items.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item, index) => {
            const itemPath = `${path}.${index}`;
            const itemId = settingsFieldId(itemPath);
            const itemError = errors[itemPath];
            const name = `${itemLabel} ${index + 1}`;
            return (
              // Rows are plain strings without ids; the index is their identity.
              <li className={`${styles.listRow} ${itemError ? styles.invalid : ""}`} key={index}>
                <div className={styles.listControls}>
                  <input
                    id={itemId}
                    className={styles.input}
                    type={type}
                    inputMode={inputMode}
                    value={item}
                    maxLength={maxLength}
                    placeholder={placeholder}
                    autoComplete="off"
                    aria-label={name}
                    aria-invalid={itemError ? true : undefined}
                    aria-describedby={itemError ? `${itemId}-error` : undefined}
                    onChange={(event) =>
                      onChange(items.map((current, itemIndex) => (itemIndex === index ? event.target.value : current)))
                    }
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Удалить: ${name}`}
                      title="Удалить"
                      onClick={() => remove(index)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {itemError && <p className={styles.fieldError} id={`${itemId}-error`}>{itemError}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <button
          id={`${id}-add`}
          type="button"
          className={styles.addButton}
          disabled={items.length >= maxItems}
          onClick={add}
        >
          <Plus size={14} aria-hidden="true" /> {addLabel}
        </button>
      )}
      <FieldMessages id={id} hint={hint} error={listError} />
    </fieldset>
  );
}

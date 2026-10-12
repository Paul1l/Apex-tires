"use client";

import { useId, useRef } from "react";
import { useDialogFocus } from "@/components/use-dialog-focus";
import styles from "./staff-section.module.css";

export interface StaffEnrollmentData {
  otpauthUri: string;
  secret: string;
  qrDataUrl: string;
}

function formatSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * One-time display of a new authenticator key: QR code and the base32 key
 * for manual entry. The key is kept only in this component's props and is
 * gone once the dialog is closed.
 */
export function StaffEnrollmentDialog({
  name,
  email,
  enrollment,
  note,
  onClose,
}: {
  name: string;
  email: string;
  enrollment: StaffEnrollmentData;
  /** Extra notice, e.g. that the current session has ended. */
  note?: string;
  onClose: () => void;
}) {
  const containerReference = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const secretLabelId = useId();
  useDialogFocus(true, containerReference, onClose);

  return (
    <div className={styles.overlay} ref={containerReference}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <p className="eyebrow">Ключ входа в админку</p>
        <h2 id={titleId}>{name}</h2>
        <p id={descriptionId}>
          Отсканируйте в Google Authenticator, Яндекс Ключе или другом приложении; ключ
          показывается один раз.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL generated on the server */}
        <img
          className={styles.qr}
          src={enrollment.qrDataUrl}
          width={240}
          height={240}
          alt={`QR-код для подключения приложения-аутентификатора, учётная запись ${email}`}
        />
        <span className={styles.secretLabel} id={secretLabelId}>
          Ключ для ручного ввода (тип — по времени)
        </span>
        <code className={styles.secret} aria-labelledby={secretLabelId}>
          {formatSecret(enrollment.secret)}
        </code>
        <p className={styles.warning}>
          Передайте ключ только самому сотруднику, не пересылайте его в чатах и почте. Вход:
          страница /admin, email {email} и 6-значный код из приложения.
        </p>
        {note && <p role="status">{note}</p>}
        <div className={styles.dialogActions}>
          <button type="button" className="admin-primary-button" data-autofocus onClick={onClose}>
            Готово, ключ добавлен
          </button>
        </div>
      </section>
    </div>
  );
}

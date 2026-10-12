"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { useStore } from "@/components/store-provider";
import type { UserProfile } from "@/lib/types";

interface LoginResponse {
  ok?: boolean;
  user?: UserProfile;
  message?: string;
}

/**
 * Staff sign-in: work email + 6-digit code from an authenticator app.
 * On success the server sets the session cookie and the /admin page is
 * rendered again with the dashboard.
 */
export function StaffLoginForm() {
  const router = useRouter();
  const { authenticateUser } = useStore();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const hintId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const normalizedCode = code.replace(/[\s-]/g, "");
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError("Код должен состоять из 6 цифр.");
      codeInput.current?.focus();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/staff/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: normalizedCode }),
      });
      const result = (await response.json().catch(() => ({}))) as LoginResponse;
      if (!response.ok || !result.user) {
        throw new Error(result.message || "Не удалось войти. Попробуйте ещё раз.");
      }
      setCode("");
      authenticateUser(result.user);
      router.refresh();
    } catch (loginError) {
      setCode("");
      setError(
        loginError instanceof TypeError
          ? "Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз."
          : loginError instanceof Error
            ? loginError.message
            : "Не удалось войти. Попробуйте ещё раз.",
      );
      codeInput.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <label>
        <span>Рабочий email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          readOnly={submitting}
        />
      </label>
      <label>
        <span>Код из приложения</span>
        <input
          ref={codeInput}
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          required
          maxLength={7}
          placeholder="123456"
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          aria-invalid={error ? true : undefined}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, ""))}
          readOnly={submitting}
        />
      </label>
      <small id={hintId} className="admin-security-note">
        Код обновляется каждые 30 секунд в Google Authenticator, Яндекс Ключе или другом приложении.
      </small>
      {error && (
        <p id={errorId} className="admin-login-message" role="alert">
          {error}
        </p>
      )}
      <button className="admin-primary-button" type="submit" disabled={submitting}>
        {submitting ? "Проверяем…" : "Войти"}
      </button>
    </form>
  );
}

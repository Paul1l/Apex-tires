"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

interface FitmentRequestFormProps {
  initialMake: string;
  initialModel: string;
  initialYear: string;
  initialGeneration: string;
}

function normalizeRussianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits[0] === "9") return `+7${digits}`;
  throw new Error("Введите российский номер в формате +7XXXXXXXXXX.");
}

export function FitmentRequestForm({
  initialMake,
  initialModel,
  initialYear,
  initialGeneration,
}: FitmentRequestFormProps) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/v1/fitment-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          make: String(form.get("make") || ""),
          model: String(form.get("model") || ""),
          year: Number(form.get("year")) || undefined,
          generation: String(form.get("generation") || "") || undefined,
          modification: String(form.get("modification") || "") || undefined,
          customerName: String(form.get("customerName") || ""),
          customerPhone: normalizeRussianPhone(
            String(form.get("customerPhone") || ""),
          ),
          personalDataConsent: form.get("personalDataConsent") === "on",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const result = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok) throw new Error(result?.message || "Заявку не удалось сохранить.");
      setMessage("Заявка сохранена. Менеджер сможет обработать её в админке.");
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Заявку не удалось сохранить.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details className="fitment-request">
      <summary>Не нашли автомобиль?</summary>
      <form onSubmit={submit}>
        <input name="make" defaultValue={initialMake} placeholder="Марка" required />
        <input name="model" defaultValue={initialModel} placeholder="Модель" required />
        <input name="year" defaultValue={initialYear} inputMode="numeric" placeholder="Год" />
        <input name="generation" defaultValue={initialGeneration} placeholder="Поколение" />
        <input name="modification" placeholder="Модификация" />
        <input name="customerName" autoComplete="name" placeholder="Ваше имя" required />
        <input name="customerPhone" autoComplete="tel" inputMode="tel" placeholder="+7 999 000-00-00" required />
        <label className="consent-row"><input name="personalDataConsent" type="checkbox" required /><span>Даю <Link href="/legal/personal-data-consent" target="_blank">согласие на обработку персональных данных</Link>.</span></label>
        <button className="secondary-button" disabled={submitting}>{submitting ? "Сохраняем…" : "Отправить запрос"}</button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}

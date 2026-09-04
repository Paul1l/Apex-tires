"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createOrder } from "@/lib/api/order-client";
import type { UserProfile } from "@/lib/types";

interface CheckoutFormProps {
  user: UserProfile | null;
  items: Array<{ productId: string; quantity: number }>;
  onSuccess: (orderNumber: string) => void;
}

export function CheckoutForm({ user, items, onSuccess }: CheckoutFormProps) {
  const [deliveryMethod, setDeliveryMethod] =
    useState<"pickup" | "courier">("pickup");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const itemsSignature = useMemo(() => JSON.stringify(items), [items]);

  useEffect(() => {
    idempotencyKey.current = crypto.randomUUID();
  }, [itemsSignature]);

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    const formData = new FormData(event.currentTarget);

    try {
      const order = await createOrder({
        idempotencyKey: idempotencyKey.current,
        customer: {
          name: String(formData.get("customerName") || ""),
          phone: String(formData.get("customerPhone") || ""),
          email: String(formData.get("customerEmail") || "") || undefined,
        },
        items,
        delivery: {
          method: deliveryMethod,
          address:
            deliveryMethod === "courier"
              ? String(formData.get("deliveryAddress") || "")
              : undefined,
        },
        comment: String(formData.get("comment") || "") || undefined,
      });
      onSuccess(order.number);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Заказ не удалось сохранить. Попробуйте позже.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="checkout-form" onSubmit={submitOrder}>
      <label>
        <span>Имя</span>
        <input
          name="customerName"
          defaultValue={user?.name || ""}
          autoComplete="name"
          required
        />
      </label>
      <label>
        <span>Телефон</span>
        <input
          name="customerPhone"
          defaultValue={user?.phone || ""}
          inputMode="tel"
          autoComplete="tel"
          placeholder="+7 999 000-00-00"
          required
        />
      </label>
      <label>
        <span>Email</span>
        <input
          name="customerEmail"
          defaultValue={user?.email || ""}
          type="email"
          autoComplete="email"
        />
      </label>
      <label>
        <span>Получение</span>
        <select
          name="deliveryMethod"
          value={deliveryMethod}
          onChange={(event) =>
            setDeliveryMethod(event.target.value as "pickup" | "courier")
          }
        >
          <option value="pickup">Самовывоз в Барнауле</option>
          <option value="courier">Доставка по Барнаулу</option>
        </select>
      </label>
      {deliveryMethod === "courier" && (
        <label>
          <span>Адрес доставки</span>
          <input name="deliveryAddress" autoComplete="street-address" required />
        </label>
      )}
      <label>
        <span>Комментарий</span>
        <textarea name="comment" rows={2} />
      </label>
      <label className="consent-row checkout-consent">
        <input type="checkbox" required />
        <span>
          Принимаю <Link href="/legal/offer" target="_blank">публичную оферту</Link>{" "}
          и <Link href="/legal/delivery-payment-returns" target="_blank">условия доставки и возврата</Link>.
        </span>
      </label>
      <label className="consent-row checkout-consent">
        <input type="checkbox" required />
        <span>
          Даю отдельное <Link href="/legal/personal-data-consent" target="_blank">согласие на обработку персональных данных</Link>.
        </span>
      </label>
      {errorMessage && (
        <p className="checkout-error" role="alert">
          {errorMessage}
        </p>
      )}
      <button className="primary-button full" type="submit" disabled={submitting}>
        {submitting ? "Сохраняем заказ…" : "Оформить заказ"}{" "}
        {!submitting && <ArrowRight size={17} />}
      </button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createOrder } from "@/lib/api/order-client";
import { businessConfig, getEnabledDeliveryMethods } from "@/config/business";
import { useSiteSettings } from "@/components/site-settings-provider";
import type { DeliveryMethod, UserProfile } from "@/lib/types";

interface CheckoutFormProps {
  user: UserProfile | null;
  items: Array<{ productId: string; quantity: number }>;
  onSuccess: (orderNumber: string) => void;
}

type FieldName =
  | "customerName"
  | "customerPhone"
  | "customerEmail"
  | "deliveryAddress"
  | "offerAccepted"
  | "personalDataConsent";

type FieldErrors = Partial<Record<FieldName, string>>;

/** Form order: focus goes to the first field with an error. */
const FIELD_ORDER: FieldName[] = [
  "customerName",
  "customerPhone",
  "customerEmail",
  "deliveryAddress",
  "offerAccepted",
  "personalDataConsent",
];

const VALIDATION_SUMMARY = "Заказ не отправлен: проверьте поля, отмеченные ниже.";

// Close to the e-mail check of the server (zod), which is stricter than the
// browser's type="email" check (for example, it requires a domain zone).
const EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/**
 * Accepts the numbers that lib/api/order-client.ts converts to +7XXXXXXXXXX,
 * the only format the server takes (server/validators/order-schemas.ts).
 */
function isRussianPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return (
    (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) ||
    (digits.length === 10 && digits[0] === "9")
  );
}

function validateCheckout(form: HTMLFormElement, deliveryMethod: DeliveryMethod | ""): FieldErrors {
  const data = new FormData(form);
  const errors: FieldErrors = {};
  const name = String(data.get("customerName") || "").trim();
  if (!name) errors.customerName = "Укажите имя.";
  else if (name.length < 2) errors.customerName = "Имя должно содержать от 2 до 150 символов.";
  const phone = String(data.get("customerPhone") || "").trim();
  if (!phone) errors.customerPhone = "Укажите телефон.";
  else if (!isRussianPhone(phone)) {
    errors.customerPhone = "Введите российский номер, например +7 999 000-00-00.";
  }
  const email = String(data.get("customerEmail") || "").trim();
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.customerEmail = "Проверьте адрес почты или оставьте поле пустым.";
  }
  if (deliveryMethod === "courier" || deliveryMethod === "transport_company") {
    if (!String(data.get("deliveryAddress") || "").trim()) {
      errors.deliveryAddress = "Укажите адрес доставки.";
    }
  }
  if (data.get("offerAccepted") !== "on") {
    errors.offerAccepted = "Примите публичную оферту и условия доставки и возврата.";
  }
  if (data.get("personalDataConsent") !== "on") {
    errors.personalDataConsent = "Без согласия на обработку персональных данных заказ не оформить.";
  }
  return errors;
}

/** Visual mark of a required field; `required` already tells assistive technology. */
function RequiredMark() {
  return <span className="required-mark" aria-hidden="true">*</span>;
}

export function CheckoutForm({ user, items, onSuccess }: CheckoutFormProps) {
  // Delivery options and services from the settings saved in the admin; the
  // server checks the order against the same settings.
  const { delivery, services } = useSiteSettings();
  const enabledDeliveryMethods = getEnabledDeliveryMethods({ delivery });
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | "">(
    enabledDeliveryMethods[0] ?? "",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const itemsSignature = useMemo(() => JSON.stringify(items), [items]);
  const formId = useId();
  const labelId = (field: FieldName) => `${formId}-${field}-label`;
  const errorId = (field: FieldName) => `${formId}-${field}-error`;
  const deliveryNoticeId = `${formId}-delivery-notice`;

  useEffect(() => {
    idempotencyKey.current = crypto.randomUUID();
  }, [itemsSignature]);

  /** Accessible name from the caption, error linked as the description. */
  function fieldAttributes(field: FieldName) {
    return {
      name: field,
      "aria-labelledby": labelId(field),
      "aria-invalid": fieldErrors[field] ? true : undefined,
      "aria-describedby": fieldErrors[field] ? errorId(field) : undefined,
    } as const;
  }

  function fieldError(field: FieldName) {
    return fieldErrors[field] ? (
      <small className="checkout-error" id={errorId(field)}>
        {fieldErrors[field]}
      </small>
    ) : null;
  }

  /** A corrected field loses its error; the summary goes with the last one. */
  function clearFieldError(field: string) {
    if (!(field in fieldErrors)) return;
    const remaining = { ...fieldErrors };
    delete remaining[field as FieldName];
    setFieldErrors(remaining);
    if (Object.keys(remaining).length === 0 && errorMessage === VALIDATION_SUMMARY) {
      setErrorMessage("");
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;

    if (!deliveryMethod) {
      setErrorMessage("Способы получения еще не настроены владельцем магазина.");
      return;
    }

    const errors = validateCheckout(formElement, deliveryMethod);
    setFieldErrors(errors);
    const firstInvalidField = FIELD_ORDER.find((field) => errors[field]);
    if (firstInvalidField) {
      setErrorMessage(VALIDATION_SUMMARY);
      const control = formElement.elements.namedItem(firstInvalidField);
      if (control instanceof HTMLElement) control.focus();
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    const formData = new FormData(formElement);
    try {
      const order = await createOrder({
        idempotencyKey: idempotencyKey.current,
        customer: {
          name: String(formData.get("customerName") || "").trim(),
          phone: String(formData.get("customerPhone") || ""),
          email: String(formData.get("customerEmail") || "").trim() || undefined,
        },
        items,
        delivery: {
          method: deliveryMethod,
          address:
            deliveryMethod !== "pickup"
              ? String(formData.get("deliveryAddress") || "")
              : undefined,
        },
        requiresTireService:
          formData.get("requiresTireService") === "on",
        offerAccepted: true,
        personalDataConsent: true,
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
    <form
      className="checkout-form"
      onSubmit={submitOrder}
      onChange={(event) => {
        const control: EventTarget = event.target;
        if (control instanceof HTMLInputElement) clearFieldError(control.name);
      }}
      // Errors are shown next to the fields and linked to them (aria-describedby)
      // instead of the browser bubbles, which disappear and are not announced.
      noValidate
    >
      <p className="summary-hint">
        Поля, отмеченные <span className="required-mark" aria-hidden="true">*</span>
        <span className="sr-only">звёздочкой</span>, обязательны.
      </p>
      <label>
        <span id={labelId("customerName")}>Имя<RequiredMark /></span>
        <input
          {...fieldAttributes("customerName")}
          defaultValue={user?.name || ""}
          autoComplete="name"
          maxLength={150}
          required
        />
        {fieldError("customerName")}
      </label>
      <label>
        <span id={labelId("customerPhone")}>Телефон<RequiredMark /></span>
        <input
          {...fieldAttributes("customerPhone")}
          defaultValue={user?.phone || ""}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+7 999 000-00-00"
          maxLength={20}
          required
        />
        {fieldError("customerPhone")}
      </label>
      <label>
        <span id={labelId("customerEmail")}>Email</span>
        <input
          {...fieldAttributes("customerEmail")}
          defaultValue={user?.email || ""}
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
        />
        {fieldError("customerEmail")}
      </label>
      <label>
        <span>Получение</span>
        {enabledDeliveryMethods.length > 0 ? (
          <select
            name="deliveryMethod"
            value={deliveryMethod}
            onChange={(event) =>
              setDeliveryMethod(event.target.value as DeliveryMethod)
            }
          >
            {delivery.pickup.enabled && <option value="pickup">Самовывоз</option>}
            {delivery.cityDelivery.enabled && <option value="courier">Доставка по {businessConfig.location.cityDative}</option>}
            {delivery.regionalDelivery.enabled && <option value="transport_company">Доставка транспортной компанией</option>}
          </select>
        ) : (
          <small className="checkout-error" id={deliveryNoticeId}>Получение заказов будет включено после согласования условий.</small>
        )}
      </label>
      {(deliveryMethod === "courier" || deliveryMethod === "transport_company") && (
        <label>
          <span id={labelId("deliveryAddress")}>Адрес доставки<RequiredMark /></span>
          <input
            {...fieldAttributes("deliveryAddress")}
            autoComplete="street-address"
            maxLength={500}
            required
          />
          {fieldError("deliveryAddress")}
        </label>
      )}
      {services.tireService && (
        <label className="consent-row checkout-consent">
          <input name="requiresTireService" type="checkbox" />
          <span>Нужен шиномонтаж — условия и время согласует менеджер.</span>
        </label>
      )}
      <label>
        <span>Комментарий</span>
        <textarea name="comment" rows={2} maxLength={1000} />
      </label>
      <label className="consent-row checkout-consent">
        <input type="checkbox" required {...fieldAttributes("offerAccepted")} />
        <span id={labelId("offerAccepted")}>
          Принимаю <Link href="/legal/offer" target="_blank">публичную оферту</Link>{" "}
          и <Link href="/legal/delivery-payment-returns" target="_blank">условия доставки и возврата</Link>.<RequiredMark />
        </span>
        {fieldError("offerAccepted")}
      </label>
      <label className="consent-row checkout-consent">
        <input type="checkbox" required {...fieldAttributes("personalDataConsent")} />
        <span id={labelId("personalDataConsent")}>
          Даю отдельное <Link href="/legal/personal-data-consent" target="_blank">согласие на обработку персональных данных</Link>.<RequiredMark />
        </span>
        {fieldError("personalDataConsent")}
      </label>
      {errorMessage && (
        <p className="checkout-error" role="alert">
          {errorMessage}
        </p>
      )}
      <button
        className="primary-button full"
        type="submit"
        disabled={submitting || !deliveryMethod}
        aria-describedby={!deliveryMethod ? deliveryNoticeId : undefined}
      >
        {submitting ? "Сохраняем заказ…" : "Оформить заказ"}{" "}
        {!submitting && <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </form>
  );
}

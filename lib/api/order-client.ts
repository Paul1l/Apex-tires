import type { DeliveryMethod } from "@/lib/types";

interface CreateOrderInput {
  idempotencyKey: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
  };
  items: Array<{ productId: string; quantity: number }>;
  delivery: {
    method: DeliveryMethod;
    address?: string;
  };
  requiresTireService: boolean;
  comment?: string;
}

interface CreatedOrder {
  id: string;
  number: string;
}

function normalizeRussianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith("9")) return `+7${digits}`;
  throw new Error("Введите российский номер телефона в формате +7XXXXXXXXXX.");
}

export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const response = await fetch("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      customer: {
        ...input.customer,
        phone: normalizeRussianPhone(input.customer.phone),
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const result = (await response.json().catch(() => null)) as
    | { order?: CreatedOrder; message?: string }
    | null;

  if (!response.ok || !result?.order) {
    throw new Error(
      result?.message || "Заказ не удалось сохранить. Проверьте данные и попробуйте снова.",
    );
  }
  return result.order;
}

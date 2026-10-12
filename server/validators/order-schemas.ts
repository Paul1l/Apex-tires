import { z } from "zod";

/** Maximum quantity of one product per order (per line and after merging duplicate lines). */
export const MAXIMUM_ORDER_PRODUCT_QUANTITY = 20;
const MAXIMUM_ORDER_LINES = 50;

const productQuantityMessage = `Количество одного товара — от 1 до ${MAXIMUM_ORDER_PRODUCT_QUANTITY} шт.`;

export const createOrderSchema = z.object({
  idempotencyKey: z
    .string({ error: "Обновите страницу и оформите заказ ещё раз." })
    .trim()
    .min(16, "Обновите страницу и оформите заказ ещё раз.")
    .max(200, "Обновите страницу и оформите заказ ещё раз."),
  customer: z.object(
    {
      name: z
        .string({ error: "Укажите имя." })
        .trim()
        .min(2, "Имя должно содержать от 2 до 150 символов.")
        .max(150, "Имя должно содержать от 2 до 150 символов."),
      phone: z
        .string({ error: "Укажите телефон." })
        .trim()
        .regex(/^\+7\d{10}$/, "Телефон должен быть в формате +7XXXXXXXXXX"),
      email: z
        .email({ error: "Укажите корректный email или оставьте поле пустым." })
        .max(254, "Email не должен быть длиннее 254 символов.")
        .optional(),
    },
    { error: "Укажите контактные данные." },
  ),
  items: z
    .array(
      z.object(
        {
          productId: z.uuid({ error: "Один из товаров корзины не найден. Обновите корзину." }),
          quantity: z
            .number({ error: productQuantityMessage })
            .int(productQuantityMessage)
            .min(1, productQuantityMessage)
            .max(MAXIMUM_ORDER_PRODUCT_QUANTITY, productQuantityMessage),
        },
        { error: "Проверьте состав заказа." },
      ),
      { error: "Проверьте состав заказа." },
    )
    .min(1, "Корзина пуста: добавьте товары.")
    .max(MAXIMUM_ORDER_LINES, `В заказе может быть не больше ${MAXIMUM_ORDER_LINES} позиций.`)
    .superRefine((items, context) => {
      // Duplicate lines of one product are merged at checkout, so the per-line
      // maximum must also hold for the merged quantity (50 x 20 is not 1000).
      const quantityByProductId = new Map<string, number>();
      items.forEach((item, index) => {
        const previousQuantity = quantityByProductId.get(item.productId) ?? 0;
        const quantity = previousQuantity + item.quantity;
        quantityByProductId.set(item.productId, quantity);
        // Reported once, at the duplicate line that crosses the limit; a single
        // oversized line already has its own issue.
        if (
          previousQuantity > 0 &&
          previousQuantity <= MAXIMUM_ORDER_PRODUCT_QUANTITY &&
          quantity > MAXIMUM_ORDER_PRODUCT_QUANTITY
        ) {
          context.addIssue({
            code: "custom",
            path: [index, "quantity"],
            message: `Одного товара в заказе может быть не больше ${MAXIMUM_ORDER_PRODUCT_QUANTITY} шт.`,
          });
        }
      });
    }),
  delivery: z.object(
    {
      method: z.enum(["pickup", "courier", "transport_company"], {
        error: "Выберите способ получения.",
      }),
      address: z
        .string({ error: "Укажите адрес доставки." })
        .trim()
        .max(500, "Адрес не должен быть длиннее 500 символов.")
        .optional(),
    },
    { error: "Выберите способ получения." },
  ),
  requiresTireService: z.boolean({ error: "Уточните, нужен ли шиномонтаж." }).default(false),
  offerAccepted: z.literal(true, { error: "Примите условия оферты." }),
  personalDataConsent: z.literal(true, {
    error: "Дайте согласие на обработку персональных данных.",
  }),
  comment: z
    .string({ error: "Комментарий должен быть текстом." })
    .trim()
    .max(1_000, "Комментарий не должен быть длиннее 1000 символов.")
    .optional(),
}, { error: "Проверьте данные заказа." }).refine(
  (order) =>
    order.delivery.method === "pickup" || Boolean(order.delivery.address),
  {
    path: ["delivery", "address"],
    message: "Для доставки курьером укажите адрес.",
  },
);

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// Fallback for anything not covered by the messages above.
const russianErrorMap = z.locales.ru().localeError;

export interface OrderValidationResult {
  success: boolean;
  data?: CreateOrderInput;
  /** Customer-facing summary for the `message` field of the 422 response. */
  message: string;
  details: Array<{ path: string; message: string }>;
}

const CONTACT_DATA_MESSAGE = "Проверьте контактные данные:";

/**
 * Validates a checkout payload with Russian messages. `message` names the
 * concrete problem (for example the quantity limit); contact data errors keep
 * the "check your contact data" wording followed by the exact field message.
 */
export function validateCreateOrder(payload: unknown): OrderValidationResult {
  const result = createOrderSchema.safeParse(payload, { error: russianErrorMap });
  if (result.success) {
    return { success: true, data: result.data, message: "", details: [] };
  }
  const details = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  const firstIssue =
    result.error.issues.find((issue) => issue.path[0] !== "customer") ?? result.error.issues[0];
  const message =
    firstIssue.path[0] === "customer"
      ? `${CONTACT_DATA_MESSAGE} ${firstIssue.message.replace(/\.$/, "")}.`
      : firstIssue.message;
  return { success: false, message, details };
}

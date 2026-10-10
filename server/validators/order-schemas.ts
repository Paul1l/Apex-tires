import { z } from "zod";

/** Maximum quantity of one product per order (per line and after merging duplicate lines). */
export const MAXIMUM_ORDER_PRODUCT_QUANTITY = 20;

export const createOrderSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(200),
  customer: z.object({
    name: z.string().trim().min(2).max(150),
    phone: z
      .string()
      .trim()
      .regex(/^\+7\d{10}$/, "Телефон должен быть в формате +7XXXXXXXXXX"),
    email: z.email().max(254).optional(),
  }),
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(MAXIMUM_ORDER_PRODUCT_QUANTITY),
      }),
    )
    .min(1)
    .max(50)
    .superRefine((items, context) => {
      // Duplicate lines of one product are merged at checkout, so the per-line
      // maximum must also hold for the merged quantity (50 x 20 is not 1000).
      const quantityByProductId = new Map<string, number>();
      items.forEach((item, index) => {
        const quantity = (quantityByProductId.get(item.productId) ?? 0) + item.quantity;
        quantityByProductId.set(item.productId, quantity);
        if (
          quantity > MAXIMUM_ORDER_PRODUCT_QUANTITY &&
          quantity - item.quantity <= MAXIMUM_ORDER_PRODUCT_QUANTITY
        ) {
          context.addIssue({
            code: "custom",
            path: [index, "quantity"],
            message: `Одного товара в заказе может быть не больше ${MAXIMUM_ORDER_PRODUCT_QUANTITY} шт.`,
          });
        }
      });
    }),
  delivery: z.object({
    method: z.enum(["pickup", "courier", "transport_company"]),
    address: z.string().trim().max(500).optional(),
  }),
  requiresTireService: z.boolean().default(false),
  offerAccepted: z.literal(true),
  personalDataConsent: z.literal(true),
  comment: z.string().trim().max(1_000).optional(),
}).refine(
  (order) =>
    order.delivery.method === "pickup" || Boolean(order.delivery.address),
  {
    path: ["delivery", "address"],
    message: "Для доставки курьером укажите адрес.",
  },
);

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

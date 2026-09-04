import { z } from "zod";

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
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(50),
  delivery: z.object({
    method: z.enum(["pickup", "courier", "transport_company"]),
    address: z.string().trim().max(500).optional(),
  }),
  requiresTireService: z.boolean().default(false),
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

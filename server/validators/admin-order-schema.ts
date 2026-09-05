import { z } from "zod";

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    "new",
    "confirmed",
    "processing",
    "ready_for_pickup",
    "shipped",
    "completed",
    "cancelled",
  ]),
  paymentStatus: z
    .enum(["pending", "paid", "failed", "refunded"])
    .optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

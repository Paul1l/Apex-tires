import { z } from "zod";

export const cartLinesSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .max(200),
});

export type CartLinesInput = z.infer<typeof cartLinesSchema>;

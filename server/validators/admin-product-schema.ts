import { z } from "zod";

export const bulkProductSchema = z.object({
  productIds: z.array(z.uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
  action: z.enum(["activate", "deactivate", "change_category", "change_brand"]),
  targetId: z.uuid().optional(),
  confirmed: z.literal(true),
}).refine((input) => !["change_category", "change_brand"].includes(input.action) || Boolean(input.targetId), { path: ["targetId"], message: "Выберите существующую категорию или бренд." });

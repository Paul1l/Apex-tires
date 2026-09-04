import { z } from "zod";

export const createFitmentRequestSchema = z.object({
  make: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(160),
  year: z.number().int().min(1900).max(2200).optional(),
  generation: z.string().trim().max(120).optional(),
  modification: z.string().trim().max(200).optional(),
  customerName: z.string().trim().min(2).max(150),
  customerPhone: z
    .string()
    .trim()
    .regex(/^\+7\d{10}$/, "Телефон должен быть в формате +7XXXXXXXXXX"),
  personalDataConsent: z.literal(true),
});

export type CreateFitmentRequestInput = z.infer<
  typeof createFitmentRequestSchema
>;

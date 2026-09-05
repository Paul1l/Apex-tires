import { z } from "zod";

const externalIdSchema = z.string().trim().min(1).max(150);
const skuSchema = z.string().trim().min(1).max(100);
const isoTimestampSchema = z.iso.datetime({ offset: true });

export const batchEnvelopeSchema = z.object({
  apiVersion: z.literal("1.0"),
  idempotencyKey: z.string().trim().min(8).max(200),
  mode: z.enum(["full", "incremental"]).default("incremental"),
  changedSince: isoTimestampSchema.optional(),
  cursor: z.string().trim().max(300).optional(),
  items: z.array(z.unknown()).min(1).max(5_000),
});

export const productSchema = z.object({
  externalId: externalIdSchema,
  sku: skuSchema,
  article: z.string().trim().max(100).optional(),
  name: z.string().trim().min(1).max(300),
  brand: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(160),
  category: z.string().trim().max(120).default(""),
  description: z.string().trim().max(20_000).default(""),
  kind: z.enum(["tire", "wheel"]),
  condition: z.enum(["new", "used"]).default("new"),
  width: z.number().int().min(0).max(500).default(0),
  profile: z.number().int().min(0).max(100).default(0),
  diameter: z.number().int().min(8).max(40),
  season: z.enum(["summer", "winter", "all-season", "none"]).default("none"),
  studded: z.boolean().default(false),
  runflat: z.boolean().default(false),
  xl: z.boolean().default(false),
  loadIndex: z.string().trim().max(20).optional(),
  speedIndex: z.string().trim().max(20).optional(),
  modelYear: z.number().int().min(1900).max(2200).optional(),
  wheelType: z.enum(["alloy", "steel", "other"]).optional(),
  wheelWidth: z.number().min(3).max(20).optional(),
  boltCount: z.number().int().min(3).max(10).optional(),
  pcdNumber: z.number().min(70).max(250).optional(),
  pcd: z.string().trim().max(30).optional(),
  offset: z.number().int().min(-100).max(200).optional(),
  centerBore: z.number().min(20).max(200).optional(),
  color: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  specifications: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  images: z
    .array(
      z.object({
        externalId: z.string().trim().max(150).optional(),
        url: z.url().max(2_000),
        alt: z.string().trim().max(300).default(""),
        position: z.number().int().min(0).max(100).default(0),
      }),
    )
    .max(20)
    .default([]),
  isActive: z.boolean().default(true),
  sourceUpdatedAt: isoTimestampSchema.optional(),
}).superRefine((product, context) => {
  if (product.kind === "tire") {
    if (product.width < 80) context.addIssue({ code: "custom", path: ["width"], message: "Ширина шины должна быть от 80 до 500 мм." });
    if (product.profile < 20) context.addIssue({ code: "custom", path: ["profile"], message: "Профиль шины должен быть от 20 до 100." });
    if (product.season === "none") context.addIssue({ code: "custom", path: ["season"], message: "Укажите сезон шины." });
  } else {
    for (const field of ["wheelWidth", "boltCount", "pcdNumber"] as const) {
      if (product[field] === undefined) context.addIssue({ code: "custom", path: [field], message: "Обязательный параметр диска." });
    }
    if (product.centerBore !== undefined && product.centerBore < 40) context.addIssue({ code: "custom", path: ["centerBore"], message: "DIA должен быть не менее 40 мм." });
  }
});

export const priceSchema = z.object({
  externalId: externalIdSchema,
  priceType: z.string().trim().min(1).max(80).default("retail"),
  price: z.number().nonnegative().max(100_000_000).multipleOf(0.01),
  oldPrice: z.number().nonnegative().max(100_000_000).multipleOf(0.01).optional(),
  discount: z.number().min(0).max(100).multipleOf(0.01).optional(),
  currency: z.literal("RUB").default("RUB"),
  sourceUpdatedAt: isoTimestampSchema.optional(),
});

export const stockSchema = z
  .object({
    externalId: externalIdSchema,
    warehouseExternalId: externalIdSchema,
    warehouseCode: z.string().trim().min(1).max(80),
    warehouseName: z.string().trim().min(1).max(200),
    quantity: z.number().int().nonnegative().max(10_000_000),
    reserved: z.number().int().nonnegative().max(10_000_000).default(0),
    sourceUpdatedAt: isoTimestampSchema.optional(),
  })
  .refine((stock) => stock.reserved <= stock.quantity, {
    path: ["reserved"],
    message: "reserved не может превышать quantity",
  });

export const fitmentSchema = z
  .object({
    make: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(160),
    generation: z.string().trim().max(120).optional(),
    modification: z.string().trim().max(160).optional(),
    yearFrom: z.number().int().min(1900).max(2200).optional(),
    yearTo: z.number().int().min(1900).max(2200).optional(),
    isOem: z.boolean().default(false),
    source: z.enum(["manual", "import", "external_api"]).default("import"),
    verified: z.boolean().default(false),
    verifiedAt: isoTimestampSchema.optional(),
    notes: z.string().trim().max(2_000).optional(),
  })
  .refine(
    (fitment) =>
      fitment.yearFrom === undefined ||
      fitment.yearTo === undefined ||
      fitment.yearFrom <= fitment.yearTo,
    { path: ["yearTo"], message: "yearTo не может быть меньше yearFrom" },
  );

export const productFitmentsSchema = z.object({
  externalId: externalIdSchema,
  fitments: z.array(fitmentSchema).max(2_000),
});

export const orderStatusSchema = z.object({
  externalOrderId: externalIdSchema,
  siteOrderId: z.uuid(),
  status: z.enum([
    "new",
    "confirmed",
    "processing",
    "ready_for_pickup",
    "shipped",
    "completed",
    "cancelled",
  ]),
  paymentStatus: z.enum(["pending", "paid", "failed", "refunded"]),
  sourceUpdatedAt: isoTimestampSchema,
});

export type BatchEnvelope = z.infer<typeof batchEnvelopeSchema>;
export type ProductSyncItem = z.infer<typeof productSchema>;
export type PriceSyncItem = z.infer<typeof priceSchema>;
export type StockSyncItem = z.infer<typeof stockSchema>;
export type ProductFitmentsSyncItem = z.infer<typeof productFitmentsSchema>;
export type OrderStatusSyncItem = z.infer<typeof orderStatusSchema>;

export function formatValidationIssues(error: z.ZodError): Array<{
  path: string;
  message: string;
}> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

import { z } from "zod";

export const normalizedFitmentImportSchema = z
  .object({
    make: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(160),
    generation: z.string().trim().min(1).max(120),
    yearFrom: z.number().int().min(1900).max(2200).optional(),
    yearTo: z.number().int().min(1900).max(2200).optional(),
    modification: z.string().trim().max(160).optional(),
    engine: z.string().trim().max(100).optional(),
    productType: z.enum(["tire", "wheel"]),
    axle: z.enum(["all", "front", "rear"]).default("all"),
    fitmentType: z.enum(["factory", "alternative", "tuning"]).default("factory"),
    tireWidth: z.number().int().min(80).max(500).optional(),
    tireProfile: z.number().int().min(20).max(100).optional(),
    tireDiameter: z.number().min(8).max(40).optional(),
    wheelDiameter: z.number().min(8).max(40).optional(),
    wheelWidth: z.number().min(3).max(20).optional(),
    boltCount: z.number().int().min(3).max(10).optional(),
    pcd: z.number().min(70).max(250).optional(),
    dia: z.number().min(40).max(200).optional(),
    etMin: z.number().min(-100).max(200).optional(),
    etMax: z.number().min(-100).max(200).optional(),
    source: z.enum(["manual", "import", "external_api"]).default("import"),
    verified: z.boolean(),
    verifiedAt: z.iso.datetime({ offset: true }).optional(),
    notes: z.string().trim().max(2_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.yearFrom && value.yearTo && value.yearFrom > value.yearTo) {
      context.addIssue({ code: "custom", path: ["yearTo"], message: "year_to меньше year_from" });
    }
    if (value.etMin !== undefined && value.etMax !== undefined && value.etMin > value.etMax) {
      context.addIssue({ code: "custom", path: ["etMax"], message: "et_max меньше et_min" });
    }
    if (value.productType === "tire" &&
      (value.tireWidth === undefined || value.tireProfile === undefined || value.tireDiameter === undefined)) {
      context.addIssue({ code: "custom", path: ["tireWidth"], message: "Для шины обязательны width/profile/diameter" });
    }
    if (value.productType === "wheel" &&
      (value.wheelDiameter === undefined || value.wheelWidth === undefined || value.boltCount === undefined || value.pcd === undefined)) {
      context.addIssue({ code: "custom", path: ["wheelDiameter"], message: "Для диска обязательны diameter/width/bolt_count/pcd" });
    }
  });

export type NormalizedFitmentImport = z.infer<typeof normalizedFitmentImportSchema>;

import { z } from "zod";

const optionalInteger = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum).optional();

const optionalDecimal = (minimum: number, maximum: number) =>
  z.coerce.number().min(minimum).max(maximum).optional();

const booleanQuery = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

export const catalogQuerySchema = z.object({
  type: z.enum(["all", "tire", "wheel"]).default("all"),
  brand: z.string().trim().max(500).optional(),
  season: z.string().regex(/^(summer|winter|all-season)(,(summer|winter|all-season))*$/).optional(),
  width: optionalDecimal(3, 500),
  profile: optionalInteger(20, 100),
  diameter: optionalDecimal(8, 40),
  boltCount: optionalInteger(3, 10),
  pcd: optionalDecimal(70, 250),
  et: optionalDecimal(-100, 200),
  dia: optionalDecimal(40, 200),
  minPrice: optionalInteger(0, 100_000_000),
  maxPrice: optionalInteger(0, 100_000_000),
  inStock: booleanQuery,
  studded: booleanQuery,
  runflat: booleanQuery,
  search: z.string().trim().max(120).optional(),
  sort: z
    .enum(["price_asc", "price_desc", "name", "newest"])
    .default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().refine(
    (value) => [24, 48, 96].includes(value),
    "Допустимый размер страницы: 24, 48 или 96.",
  ).default(24),
  vehicleMake: z.string().trim().max(100).optional(),
  vehicleModel: z.string().trim().max(100).optional(),
  vehicleGeneration: z.string().trim().max(120).optional(),
  vehicleModification: z.string().trim().max(160).optional(),
  sourceSystem: z.enum(["manual", "csv", "1c"]).optional(),
  active: booleanQuery,
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export function parseCatalogQuery(searchParams: URLSearchParams): CatalogQuery {
  return catalogQuerySchema.parse(Object.fromEntries(searchParams.entries()));
}

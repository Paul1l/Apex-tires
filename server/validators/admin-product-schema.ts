import { z } from "zod";
import { productImageUrlSchema } from "./image-url";

export const bulkProductSchema = z.object({
  productIds: z.array(z.uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
  action: z.enum(["activate", "deactivate", "change_category", "change_brand"]),
  targetId: z.uuid().optional(),
  confirmed: z.literal(true),
}).refine((input) => !["change_category", "change_brand"].includes(input.action) || Boolean(input.targetId), { path: ["targetId"], message: "Выберите существующую категорию или бренд." });

/** 100 000 000 ₽ — the same ceiling as the 1C and CSV price contracts. */
export const MAXIMUM_PRICE_KOPECKS = 10_000_000_000;
export const MAXIMUM_STOCK_QUANTITY = 10_000_000;
export const MAXIMUM_IMAGE_ALT_LENGTH = 300;

// C0 controls and DEL; single-line values must not contain them at all.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
// Multi-line text keeps tab, line feed and carriage return.
const CONTROL_CHARACTERS_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function line(label: string, maximum: number, minimum = 0) {
  const schema = z
    .string({ message: `${label}: укажите текст.` })
    .trim()
    .max(maximum, `${label}: не длиннее ${maximum} символов.`)
    .refine((value) => !CONTROL_CHARACTERS.test(value), `${label}: недопустимые символы.`);
  return minimum > 0 ? schema.refine((value) => value.length >= minimum, `${label}: заполните поле.`) : schema;
}

/** Optional single-line text: an empty string is stored as NULL. */
function nullableLine(label: string, maximum: number) {
  return line(label, maximum)
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value));
}

function integer(label: string, minimum: number, maximum: number) {
  return z
    .number({ message: `${label}: укажите число.` })
    .int(`${label}: укажите целое число.`)
    .min(minimum, `${label}: от ${minimum} до ${maximum}.`)
    .max(maximum, `${label}: от ${minimum} до ${maximum}.`);
}

function hasAtMostDecimals(value: number, digits: number): boolean {
  const scaled = value * 10 ** digits;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

function decimal(label: string, minimum: number, maximum: number, digits: number) {
  return z
    .number({ message: `${label}: укажите число.` })
    .min(minimum, `${label}: от ${minimum} до ${maximum}.`)
    .max(maximum, `${label}: от ${minimum} до ${maximum}.`)
    .refine((value) => hasAtMostDecimals(value, digits), `${label}: не больше ${digits} знаков после запятой.`);
}

function flag(label: string) {
  return z.boolean({ message: `${label}: да или нет.` });
}

/** Object without extra keys; the refusal names the keys in Russian. */
function strictObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? `Лишние поля: ${issue.keys.join(", ")}.` : undefined),
  });
}

const productCardFields = {
  sku: line("SKU", 100, 1),
  article: nullableLine("Артикул", 100),
  name: line("Название", 300, 1),
  brandId: z.uuid({ message: "Выберите бренд из списка." }).nullable(),
  model: line("Модель", 160, 1),
  categoryId: z.uuid({ message: "Выберите категорию из списка." }).nullable(),
  description: z
    .string({ message: "Описание: укажите текст." })
    .trim()
    .max(20_000, "Описание: не длиннее 20 000 символов.")
    .refine((value) => !CONTROL_CHARACTERS_EXCEPT_WHITESPACE.test(value), "Описание: недопустимые символы."),
  country: nullableLine("Страна производства", 100),
  isActive: flag("Показывать на сайте"),
  diameter: integer("Посадочный диаметр", 8, 40).nullable(),
  width: integer("Ширина профиля", 80, 500).nullable(),
  profile: integer("Высота профиля", 20, 100).nullable(),
  season: z.enum(["summer", "winter", "all-season"], { message: "Выберите сезон." }).nullable(),
  studded: flag("Шипы"),
  runflat: flag("RunFlat"),
  xl: flag("Усиленная (XL)"),
  loadIndex: nullableLine("Индекс нагрузки", 20),
  speedIndex: nullableLine("Индекс скорости", 20),
  wheelWidth: decimal("Ширина диска", 3, 20, 1).nullable(),
  boltCount: integer("Количество отверстий", 3, 10).nullable(),
  pcd: decimal("PCD (диаметр расположения отверстий)", 70, 250, 2).nullable(),
  offset: integer("Вылет (ET)", -100, 200).nullable(),
  centerBore: decimal("Центральное отверстие (DIA)", 40, 200, 2).nullable(),
  wheelType: z.enum(["alloy", "steel", "other"], { message: "Выберите тип диска." }).nullable(),
  color: nullableLine("Цвет", 100),
};

/** Full card of a new product. Kind-specific required fields: validateCompleteCard. */
export const productCardSchema = strictObject({
  kind: z.enum(["tire", "wheel"], { message: "Выберите тип товара: шина или диск." }),
  ...productCardFields,
});

/** Changed fields of an existing product; the kind is fixed after creation. */
export const productCardPatchSchema = strictObject(productCardFields).partial();

export const productPriceSchema = strictObject({
  amountKopecks: z
    .number({ message: "Укажите цену." })
    .int("Цена: не больше двух знаков после запятой.")
    .min(1, "Цена должна быть больше нуля.")
    .max(MAXIMUM_PRICE_KOPECKS, "Цена слишком большая."),
  oldAmountKopecks: z
    .number({ message: "Старая цена: укажите число." })
    .int("Старая цена: не больше двух знаков после запятой.")
    .min(1, "Старая цена должна быть больше нуля.")
    .max(MAXIMUM_PRICE_KOPECKS, "Старая цена слишком большая.")
    .nullable(),
})
  .refine(
    (price) => price.oldAmountKopecks === null || price.oldAmountKopecks > price.amountKopecks,
    { path: ["oldAmountKopecks"], message: "Старая цена должна быть больше текущей (иначе оставьте поле пустым)." },
  );

export const productStockSchema = z
  .array(
    strictObject({
      warehouseId: z.uuid({ message: "Некорректный склад." }),
      quantity: integer("Остаток", 0, MAXIMUM_STOCK_QUANTITY),
    }),
  )
  .max(200)
  .refine((rows) => new Set(rows.map((row) => row.warehouseId)).size === rows.length, "Склад указан дважды.");

export const createProductSchema = strictObject({
  card: productCardSchema,
  price: productPriceSchema.nullable().optional(),
  stock: productStockSchema.optional(),
});

export const updateProductSchema = strictObject({
  version: z.string().regex(/^\d{1,20}$/, "Обновите страницу: нет версии товара."),
  card: productCardPatchSchema.optional(),
  price: productPriceSchema.optional(),
  stock: productStockSchema.optional(),
});

export const imageAltSchema = line("Подпись к фото", MAXIMUM_IMAGE_ALT_LENGTH);

export const addImageUrlSchema = strictObject({
  url: productImageUrlSchema.refine(
    (value) => value.startsWith("https://"),
    "Укажите адрес фото, начинающийся с https://.",
  ),
  alt: imageAltSchema.default(""),
});

export const updateImagesSchema = strictObject({
  images: z
    .array(strictObject({ id: z.uuid(), alt: imageAltSchema }))
    .min(1)
    .max(50)
    .refine((images) => new Set(images.map((image) => image.id)).size === images.length, "Фото указано дважды."),
});

export const addFitmentSchema = strictObject({
  generationId: z.uuid({ message: "Выберите поколение автомобиля." }),
  modificationId: z.uuid({ message: "Некорректная модификация." }).nullable().default(null),
  axle: z.enum(["all", "front", "rear"], { message: "Выберите ось: обе, передняя или задняя." }).default("all"),
  fitmentType: z.enum(["factory", "alternative", "tuning"], { message: "Выберите тип применимости." }).default("factory"),
  etMin: decimal("ET от", -100, 200, 2).nullable().default(null),
  etMax: decimal("ET до", -100, 200, 2).nullable().default(null),
  dia: decimal("DIA ступицы", 40, 200, 2).nullable().default(null),
})
  .refine(
    (fitment) => fitment.etMin === null || fitment.etMax === null || fitment.etMin <= fitment.etMax,
    { path: ["etMax"], message: "«ET до» не может быть меньше «ET от»." },
  );

export const createBrandSchema = strictObject({ name: line("Название бренда", 120, 1) });

export const createCategorySchema = strictObject({
  name: line("Название категории", 120, 1),
  parentId: z.uuid({ message: "Некорректная родительская категория." }).nullable().default(null),
});

export const adminProductListQuerySchema = z.object({
  search: z.string().trim().max(120, "Поиск: не длиннее 120 символов.").optional(),
  type: z.enum(["all", "tire", "wheel"]).default("all"),
  active: z.enum(["true", "false", "all"]).default("true"),
  sourceSystem: z.enum(["manual", "csv", "1c"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const vehicleReferenceQuerySchema = z
  .object({
    level: z.enum(["makes", "models", "generations", "modifications"]),
    parentId: z.uuid().optional(),
  })
  .refine((query) => query.level === "makes" || Boolean(query.parentId), {
    path: ["parentId"],
    message: "Не выбран родительский элемент справочника.",
  });

export type ProductCardInput = z.infer<typeof productCardSchema>;
export type ProductCardPatch = z.infer<typeof productCardPatchSchema>;
export type ProductPriceInput = z.infer<typeof productPriceSchema>;
export type ProductStockInput = z.infer<typeof productStockSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AddImageUrlInput = z.infer<typeof addImageUrlSchema>;
export type UpdateImagesInput = z.infer<typeof updateImagesSchema>;
export type AddFitmentInput = z.infer<typeof addFitmentSchema>;
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;
export type VehicleReferenceQuery = z.infer<typeof vehicleReferenceQuerySchema>;

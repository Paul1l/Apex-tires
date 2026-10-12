import type {
  AdminProductCard,
  AdminProductCardField,
  AdminProductStockRow,
} from "../../lib/admin/product-types";
import { missingRequiredFields } from "../../lib/admin/product-rules";
import { ApplicationError } from "../utils/errors";
import {
  createProductSchema,
  type CreateProductInput,
  type ProductPriceInput,
  type ProductStockInput,
} from "../validators/admin-product-schema";

/**
 * Card fields that the 1C exchange writes for a product with
 * source_system = '1c' (ProductRepository.upsertFromExternalSystem: the whole
 * card, specs, activity and its own photos; upsertPrice; upsertStock). The
 * next exchange would overwrite a manual change, so the editor closes them,
 * and the server rejects a change with PRODUCT_SOURCE_CONFLICT.
 * Not owned by 1C: photos added on the site (source_system <> '1c') and the
 * vehicle fitment table (fitments), which 1C does not fill.
 */
export const ONE_C_OWNED_CARD_FIELDS: readonly AdminProductCardField[] = [
  "kind", "sku", "article", "name", "brandId", "model", "categoryId", "description",
  "country", "isActive", "diameter", "width", "profile", "season", "studded", "runflat",
  "xl", "loadIndex", "speedIndex", "wheelWidth", "boltCount", "pcd", "offset",
  "centerBore", "wheelType", "color",
];

/** Price and stock of a 1C product come only from the exchange. */
export const ONE_C_OWNED_SECTIONS = ["price", "stock"] as const;

export const CARD_FIELD_LABELS: Record<AdminProductCardField, string> = {
  kind: "Тип товара",
  sku: "SKU",
  article: "Артикул",
  name: "Название",
  brandId: "Бренд",
  model: "Модель",
  categoryId: "Категория",
  description: "Описание",
  country: "Страна производства",
  isActive: "Показывать на сайте",
  diameter: "Посадочный диаметр",
  width: "Ширина профиля",
  profile: "Высота профиля",
  season: "Сезон",
  studded: "Шипы",
  runflat: "RunFlat",
  xl: "Усиленная (XL)",
  loadIndex: "Индекс нагрузки",
  speedIndex: "Индекс скорости",
  wheelWidth: "Ширина диска",
  boltCount: "Количество отверстий",
  pcd: "PCD",
  offset: "Вылет (ET)",
  centerBore: "Центральное отверстие (DIA)",
  wheelType: "Тип диска",
  color: "Цвет",
};

const CARD_FIELDS = Object.keys(CARD_FIELD_LABELS) as AdminProductCardField[];

export function isOneCProduct(source: string): boolean {
  return source === "1c";
}

/** Fields and sections closed for editing for a product of this source. */
export function lockedFieldsForSource(source: string): string[] {
  return isOneCProduct(source) ? [...ONE_C_OWNED_CARD_FIELDS, ...ONE_C_OWNED_SECTIONS] : [];
}

/** A photo delivered by 1C is replaced by the next exchange: read-only here. */
export function isImageLocked(productSource: string, imageSource: string): boolean {
  return isOneCProduct(productSource) && imageSource === "1c";
}

/** Clears the fields of the other kind, so a tire never keeps wheel data and vice versa. */
export function normalizeCardForKind(card: AdminProductCard): AdminProductCard {
  if (card.kind === "tire") {
    return {
      ...card,
      wheelWidth: null,
      boltCount: null,
      pcd: null,
      offset: null,
      centerBore: null,
      wheelType: null,
      color: null,
    };
  }
  return {
    ...card,
    width: null,
    profile: null,
    season: null,
    studded: false,
    runflat: false,
    xl: false,
    loadIndex: null,
    speedIndex: null,
  };
}

export function changedCardFields(
  before: AdminProductCard,
  after: AdminProductCard,
): AdminProductCardField[] {
  return CARD_FIELDS.filter((field) => before[field] !== after[field]);
}

export interface FieldIssue {
  field: string;
  message: string;
}

/** All missing required fields of a merged card (common and kind-specific) at once. */
export function validateCompleteCard(card: AdminProductCard): FieldIssue[] {
  return missingRequiredFields(card as unknown as Record<string, unknown>, card.kind)
    .map((issue) => ({ field: `card.${issue.field}`, message: issue.message }));
}

/**
 * Parses a create request and reports every problem in one 422: schema issues
 * (types, lengths, ranges) plus required fields missing from the raw card,
 * so the editor never learns about missing sizes only after the next save.
 */
export function parseCreateProductInput(raw: unknown): CreateProductInput {
  const result = createProductSchema.safeParse(raw);
  if (result.success) {
    throwValidationIssues(validateCompleteCard(normalizeCardForKind(result.data.card)));
    return result.data;
  }
  const issues: FieldIssue[] = result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
  const rawCard = raw !== null && typeof raw === "object" ? Reflect.get(raw, "card") : undefined;
  if (rawCard !== null && typeof rawCard === "object") {
    const reported = new Set(issues.map((issue) => issue.field));
    for (const missing of missingRequiredFields(rawCard as Record<string, unknown>, Reflect.get(rawCard, "kind"))) {
      const field = `card.${missing.field}`;
      if (!reported.has(field)) issues.push({ field, message: missing.message });
    }
  }
  throw validationError(issues);
}

/** 422 with field details, in the same shape as schema errors (toSafeError). */
export function validationError(issues: FieldIssue[]): ApplicationError {
  return new ApplicationError({
    code: "VALIDATION_ERROR",
    message: "Проверьте введённые параметры.",
    statusCode: 422,
    details: issues,
  });
}

export function throwValidationIssues(issues: FieldIssue[]): void {
  if (issues.length > 0) throw validationError(issues);
}

export interface SourceChangeSet {
  cardFields: readonly AdminProductCardField[];
  price: boolean;
  stock: boolean;
}

/**
 * Server-side 1C lock: a 1C product may be saved only without changes to the
 * fields 1C owns. A save that repeats the current values passes.
 */
export function assertSourceAllowsChanges(source: string, changes: SourceChangeSet): void {
  if (!isOneCProduct(source)) return;
  const locked = [
    ...changes.cardFields.filter((field) => ONE_C_OWNED_CARD_FIELDS.includes(field)).map((field) => CARD_FIELD_LABELS[field]),
    ...(changes.price ? ["Цена"] : []),
    ...(changes.stock ? ["Остатки"] : []),
  ];
  if (locked.length === 0) return;
  throw new ApplicationError({
    code: "PRODUCT_SOURCE_CONFLICT",
    message: `Товар управляется 1С, эти данные меняются только в учётной системе: ${locked.join(", ")}.`,
    statusCode: 409,
    details: { fields: locked },
  });
}

export function priceChanged(
  current: { amountKopecks: number; oldAmountKopecks: number | null } | null,
  next: ProductPriceInput | undefined,
): boolean {
  if (!next) return false;
  return !current || current.amountKopecks !== next.amountKopecks || current.oldAmountKopecks !== next.oldAmountKopecks;
}

export interface StockChange {
  warehouseId: string;
  warehouseName: string;
  from: number;
  to: number;
  reserved: number;
}

/**
 * Compares the requested quantities with the stored rows (active warehouses).
 * A quantity below the reserve is refused: reserved units belong to orders.
 */
export function planStockChanges(
  current: readonly AdminProductStockRow[],
  requested: ProductStockInput | undefined,
): StockChange[] {
  if (!requested) return [];
  const byWarehouse = new Map(current.map((row) => [row.warehouseId, row]));
  const issues: FieldIssue[] = [];
  const changes: StockChange[] = [];
  requested.forEach((row, index) => {
    const stored = byWarehouse.get(row.warehouseId);
    if (!stored) {
      issues.push({ field: `stock.${index}.warehouseId`, message: "Склад не найден или отключён. Обновите страницу." });
      return;
    }
    if (row.quantity === stored.quantity) return;
    if (row.quantity < stored.reserved) {
      issues.push({
        field: `stock.${index}.quantity`,
        message: `Склад «${stored.warehouseName}»: остаток не может быть меньше резерва (${stored.reserved} шт.) — эти единицы уже в заказах.`,
      });
      return;
    }
    changes.push({
      warehouseId: row.warehouseId,
      warehouseName: stored.warehouseName,
      from: stored.quantity,
      to: row.quantity,
      reserved: stored.reserved,
    });
  });
  if (issues.length > 0) {
    throw new ApplicationError({
      code: "STOCK_BELOW_RESERVED",
      message: issues[0].message,
      statusCode: 422,
      details: issues,
    });
  }
  return changes;
}

/** Text PCD shown on the storefront: "5x112", "5x114.3". */
export function formatWheelPcd(boltCount: number, pcd: number): string {
  return `${boltCount}x${Number(pcd.toFixed(2))}`;
}

/** Size the fitments are matched by; null while the size is incomplete. */
export function productSizeLabel(card: AdminProductCard): string | null {
  if (card.kind === "tire") {
    return card.width && card.profile && card.diameter ? `${card.width}/${card.profile} R${card.diameter}` : null;
  }
  return card.diameter && card.wheelWidth && card.boltCount && card.pcd
    ? `${card.wheelWidth}J R${card.diameter} ${formatWheelPcd(card.boltCount, card.pcd)}`
    : null;
}

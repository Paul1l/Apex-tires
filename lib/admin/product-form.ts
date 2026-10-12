import type {
  AdminProductCard,
  AdminProductKind,
  AdminProductPrice,
  AdminProductStockRow,
  AdminTireSeason,
  AdminWheelType,
} from "./product-types";

/**
 * Form state of the product editor: inputs keep the text the manager typed
 * (prices in rubles with a comma, decimals), conversion to the API shape
 * (kopecks, numbers, null for empty) happens on save.
 */
export interface ProductFormState {
  kind: AdminProductKind;
  sku: string;
  article: string;
  name: string;
  brandId: string;
  model: string;
  categoryId: string;
  description: string;
  country: string;
  isActive: boolean;
  diameter: string;
  width: string;
  profile: string;
  season: AdminTireSeason | "";
  studded: boolean;
  runflat: boolean;
  xl: boolean;
  loadIndex: string;
  speedIndex: string;
  wheelWidth: string;
  boltCount: string;
  pcd: string;
  offset: string;
  centerBore: string;
  wheelType: AdminWheelType | "";
  color: string;
  price: string;
  oldPrice: string;
  /** Quantity text by warehouse id. */
  stock: Record<string, string>;
}

export interface FormFieldError {
  /** Same paths as the API validation details: card.width, price.amountKopecks, stock.0.quantity. */
  field: string;
  message: string;
}

const numberText = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));

/** "1234567" kopecks → "12345,67"; whole rubles without the fraction. */
export function formatKopecksForInput(kopecks: number | null): string {
  if (kopecks === null) return "";
  const rubles = Math.trunc(kopecks / 100);
  const rest = Math.abs(kopecks % 100);
  return rest === 0 ? String(rubles) : `${rubles},${String(rest).padStart(2, "0")}`;
}

/** Display format: "12 345,67 ₽". */
export function formatKopecks(kopecks: number | null): string {
  if (kopecks === null) return "—";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(kopecks / 100);
}

/**
 * Rubles typed by a person ("12 345,5", "12345.50", "12 345 ₽") → kopecks.
 * null for an empty field; "invalid" for anything else than a non-negative
 * amount with at most two decimals.
 */
export function parseRublesToKopecks(text: string): number | null | "invalid" {
  const compact = text.replace(/[\s  ₽]/g, "").replace(/(руб\.?|р\.?)$/i, "");
  if (compact === "") return null;
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(compact);
  if (!match) return "invalid";
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Decimal number with a comma or a dot; null for empty, NaN when invalid. */
export function parseDecimalInput(text: string): number | null {
  const compact = text.replace(/[\s ]/g, "").replace(",", ".");
  if (compact === "") return null;
  return /^-?\d+(\.\d+)?$/.test(compact) ? Number(compact) : Number.NaN;
}

export function emptyProductForm(kind: AdminProductKind = "tire"): ProductFormState {
  return {
    kind, sku: "", article: "", name: "", brandId: "", model: "", categoryId: "", description: "",
    country: "", isActive: true, diameter: "", width: "", profile: "", season: "", studded: false,
    runflat: false, xl: false, loadIndex: "", speedIndex: "", wheelWidth: "", boltCount: "", pcd: "",
    offset: "", centerBore: "", wheelType: "", color: "", price: "", oldPrice: "", stock: {},
  };
}

export function productFormFromData(
  card: AdminProductCard,
  price: AdminProductPrice | null,
  stock: readonly AdminProductStockRow[],
): ProductFormState {
  return {
    kind: card.kind,
    sku: card.sku,
    article: card.article ?? "",
    name: card.name,
    brandId: card.brandId ?? "",
    model: card.model,
    categoryId: card.categoryId ?? "",
    description: card.description,
    country: card.country ?? "",
    isActive: card.isActive,
    diameter: numberText(card.diameter),
    width: numberText(card.width),
    profile: numberText(card.profile),
    season: card.season ?? "",
    studded: card.studded,
    runflat: card.runflat,
    xl: card.xl,
    loadIndex: card.loadIndex ?? "",
    speedIndex: card.speedIndex ?? "",
    wheelWidth: numberText(card.wheelWidth),
    boltCount: numberText(card.boltCount),
    pcd: numberText(card.pcd),
    offset: numberText(card.offset),
    centerBore: numberText(card.centerBore),
    wheelType: card.wheelType ?? "",
    color: card.color ?? "",
    price: formatKopecksForInput(price?.amountKopecks ?? null),
    oldPrice: formatKopecksForInput(price?.oldAmountKopecks ?? null),
    stock: Object.fromEntries(stock.map((row) => [row.warehouseId, String(row.quantity)])),
  };
}

const optionalText = (value: string) => (value.trim() === "" ? null : value.trim());

/** Card for the API; number fields that cannot be read are reported, not sent. */
export function productCardFromForm(state: ProductFormState): { card: AdminProductCard; errors: FormFieldError[] } {
  const errors: FormFieldError[] = [];
  const number = (field: keyof AdminProductCard, text: string, label: string): number | null => {
    const value = parseDecimalInput(text);
    if (value !== null && Number.isNaN(value)) {
      errors.push({ field: `card.${field}`, message: `${label}: укажите число.` });
      return null;
    }
    return value;
  };
  const isTire = state.kind === "tire";
  const card: AdminProductCard = {
    kind: state.kind,
    sku: state.sku.trim(),
    article: optionalText(state.article),
    name: state.name.trim(),
    brandId: state.brandId || null,
    model: state.model.trim(),
    categoryId: state.categoryId || null,
    description: state.description.trim(),
    country: optionalText(state.country),
    isActive: state.isActive,
    diameter: number("diameter", state.diameter, "Посадочный диаметр"),
    width: isTire ? number("width", state.width, "Ширина профиля") : null,
    profile: isTire ? number("profile", state.profile, "Высота профиля") : null,
    season: isTire && state.season ? state.season : null,
    studded: isTire && state.studded,
    runflat: isTire && state.runflat,
    xl: isTire && state.xl,
    loadIndex: isTire ? optionalText(state.loadIndex) : null,
    speedIndex: isTire ? optionalText(state.speedIndex) : null,
    wheelWidth: isTire ? null : number("wheelWidth", state.wheelWidth, "Ширина диска"),
    boltCount: isTire ? null : number("boltCount", state.boltCount, "Количество отверстий"),
    pcd: isTire ? null : number("pcd", state.pcd, "PCD"),
    offset: isTire ? null : number("offset", state.offset, "Вылет (ET)"),
    centerBore: isTire ? null : number("centerBore", state.centerBore, "DIA"),
    wheelType: isTire || !state.wheelType ? null : state.wheelType,
    color: isTire ? null : optionalText(state.color),
  };
  return { card, errors };
}

/** Price for the API: null when both fields are empty. */
export function productPriceFromForm(state: ProductFormState): { price: AdminProductPrice | null; errors: FormFieldError[] } {
  const amount = parseRublesToKopecks(state.price);
  const oldAmount = parseRublesToKopecks(state.oldPrice);
  const errors: FormFieldError[] = [];
  if (amount === "invalid") errors.push({ field: "price.amountKopecks", message: "Цена: укажите сумму в рублях, например 12 990 или 12 990,50." });
  if (oldAmount === "invalid") errors.push({ field: "price.oldAmountKopecks", message: "Старая цена: укажите сумму в рублях." });
  if (errors.length > 0) return { price: null, errors };
  if (amount === null) {
    if (oldAmount !== null) errors.push({ field: "price.amountKopecks", message: "Укажите текущую цену или очистите старую цену." });
    return { price: null, errors };
  }
  return { price: { amountKopecks: amount as number, oldAmountKopecks: oldAmount as number | null }, errors };
}

export function productStockFromForm(
  state: ProductFormState,
  rows: readonly Pick<AdminProductStockRow, "warehouseId">[],
): { stock: Array<{ warehouseId: string; quantity: number }>; errors: FormFieldError[] } {
  const errors: FormFieldError[] = [];
  const stock: Array<{ warehouseId: string; quantity: number }> = [];
  rows.forEach((row, index) => {
    const text = (state.stock[row.warehouseId] ?? "").trim();
    const quantity = text === "" ? 0 : Number(text);
    if (!Number.isInteger(quantity) || quantity < 0) {
      errors.push({ field: `stock.${index}.quantity`, message: "Остаток: целое число не меньше нуля." });
      return;
    }
    stock.push({ warehouseId: row.warehouseId, quantity });
  });
  return { stock, errors };
}

/** Fields that differ: only these are sent when an existing product is saved. */
export function changedCardValues(initial: AdminProductCard, next: AdminProductCard): Partial<AdminProductCard> {
  const changes: Partial<AdminProductCard> = {};
  for (const key of Object.keys(next) as Array<keyof AdminProductCard>) {
    if (key === "kind") continue;
    if (initial[key] !== next[key]) Object.assign(changes, { [key]: next[key] });
  }
  return changes;
}

const seasonWords: Record<AdminTireSeason, string> = {
  summer: "летняя",
  winter: "зимняя",
  "all-season": "всесезонная",
};

/** Suggested product name: brand, model and size, as products are named in the catalog. */
export function suggestProductName(state: ProductFormState, brandName: string): string {
  const head = [brandName, state.model.trim()].filter(Boolean).join(" ");
  if (state.kind === "tire") {
    const size = state.width && state.profile && state.diameter ? `${state.width}/${state.profile} R${state.diameter}` : "";
    const indexes = `${state.loadIndex.trim()}${state.speedIndex.trim()}`;
    const extra = [state.xl ? "XL" : "", state.runflat ? "RunFlat" : "", state.season ? seasonWords[state.season] : "", state.studded ? "шипованная" : ""];
    return ["Шина", head, size, indexes, ...extra].filter(Boolean).join(" ");
  }
  const size = [state.wheelWidth ? `${state.wheelWidth}J` : "", state.diameter ? `R${state.diameter}` : "",
    state.boltCount && state.pcd ? `${state.boltCount}x${state.pcd}` : "", state.offset ? `ET${state.offset}` : "",
    state.centerBore ? `DIA${state.centerBore}` : ""];
  return ["Диск", head, ...size, state.color.trim()].filter(Boolean).join(" ");
}

export const productSourceLabels: Record<string, string> = {
  manual: "Вручную",
  csv: "CSV",
  "1c": "1С",
};

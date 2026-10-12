/**
 * Required fields of a product card, shared by the editor (checked before
 * sending) and the API (checked on the merged card). Each check returns every
 * missing field at once, so the manager fixes them in one round.
 */

type RequiredField = readonly [field: string, message: string];

const COMMON_REQUIRED_FIELDS: readonly RequiredField[] = [
  ["sku", "Укажите SKU."],
  ["name", "Укажите название."],
  ["brandId", "Выберите бренд."],
  ["model", "Укажите модель."],
  ["diameter", "Укажите посадочный диаметр."],
];

const TIRE_REQUIRED_FIELDS: readonly RequiredField[] = [
  ["width", "Укажите ширину профиля шины."],
  ["profile", "Укажите высоту профиля шины."],
  ["season", "Выберите сезон шины."],
];

const WHEEL_REQUIRED_FIELDS: readonly RequiredField[] = [
  ["wheelWidth", "Укажите ширину диска."],
  ["boltCount", "Укажите количество крепёжных отверстий."],
  ["pcd", "Укажите PCD (диаметр расположения отверстий)."],
];

export interface MissingField {
  /** Card field name without a prefix: sku, width, pcd… */
  field: string;
  message: string;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Missing required fields of a card-like object (API card, raw JSON or the
 * editor form state). The kind decides the size fields; an unknown kind
 * checks only the common fields.
 */
export function missingRequiredFields(values: Readonly<Record<string, unknown>>, kind: unknown): MissingField[] {
  const required = [
    ...COMMON_REQUIRED_FIELDS,
    ...(kind === "tire" ? TIRE_REQUIRED_FIELDS : kind === "wheel" ? WHEEL_REQUIRED_FIELDS : []),
  ];
  return required.filter(([field]) => isBlank(values[field])).map(([field, message]) => ({ field, message }));
}

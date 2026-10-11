export type VehicleYearParameter =
  | { valid: true; year: number | undefined }
  | { valid: false };

/**
 * Model year of a vehicle reference query. An absent, empty or blank value
 * means "year not specified" (the storefront sends `year=` for «Не уточнять
 * год»); otherwise it must be a four-digit year within the given range.
 */
export function parseOptionalVehicleYear(
  value: string | null,
  minimum: number,
  maximum: number,
): VehicleYearParameter {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return { valid: true, year: undefined };
  if (!/^\d{4}$/.test(trimmed)) return { valid: false };
  const year = Number(trimmed);
  return year >= minimum && year <= maximum ? { valid: true, year } : { valid: false };
}

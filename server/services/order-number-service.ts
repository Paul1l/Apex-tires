export function formatOrderNumber(sequence: number | string, date = new Date()): string {
  const prefix = process.env.ORDER_NUMBER_PREFIX || "AW";
  if (!/^[A-Z0-9]{1,10}$/.test(prefix)) throw new Error("Invalid ORDER_NUMBER_PREFIX");
  return `${prefix}-${date.getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
}

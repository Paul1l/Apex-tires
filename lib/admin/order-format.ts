const amountFormatter = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 1234567 kopecks → "12 345,67 ₽"; whole rubles without decimals. */
export function formatKopecks(kopecks: number): string {
  return `${amountFormatter.format(kopecks / 100)} ₽`;
}

/** Rubles (list API) → "12 345 ₽". */
export function formatRubles(rubles: number): string {
  return `${amountFormatter.format(rubles)} ₽`;
}

/** "+79131234567" → "+7 913 123-45-67"; other values unchanged. */
export function formatPhone(phone: string): string {
  const match = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+7 ${match[1]} ${match[2]}-${match[3]}-${match[4]}` : phone;
}

/** Russian plural: pluralize(5, ["заказ", "заказа", "заказов"]) → "заказов". */
export function pluralize(count: number, forms: [string, string, string]): string {
  const remainder100 = Math.abs(count) % 100;
  const remainder10 = remainder100 % 10;
  if (remainder100 > 10 && remainder100 < 20) return forms[2];
  if (remainder10 === 1) return forms[0];
  if (remainder10 >= 2 && remainder10 <= 4) return forms[1];
  return forms[2];
}

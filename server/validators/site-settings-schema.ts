import { z } from "zod";
import type { SiteSettings } from "../../lib/site-settings";

/**
 * Validation of store data edited in the admin (lib/site-settings.ts).
 * Empty strings become null; links must be https; texts are bounded.
 */
const optionalText = (maximum: number, label: string) =>
  z
    .string()
    .trim()
    .max(maximum, `${label}: не длиннее ${maximum} символов.`)
    .transform((value) => (value === "" ? null : value))
    .nullable();

const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s()-]{7,24}$/, "Телефон: цифры, пробелы, скобки и дефисы, например +7 (3852) 00-00-00.");

const optionalPhone = z
  .union([z.literal(""), phone])
  .transform((value) => (value === "" ? null : value))
  .nullable();

const optionalEmail = z
  .union([z.literal(""), z.email("Укажите корректный email.").max(254)])
  .transform((value) => (value === "" ? null : value))
  .nullable();

const httpsUrl = (label: string) =>
  z
    .url({ protocol: /^https$/, error: `${label}: ссылка должна начинаться с https://` })
    .max(500, `${label}: ссылка не длиннее 500 символов.`);

const optionalHttpsUrl = (label: string) =>
  z
    .union([z.literal(""), httpsUrl(label)])
    .transform((value) => (value === "" ? null : value))
    .nullable();

const deliveryOption = z.object({
  enabled: z.boolean(),
  rules: optionalText(1_000, "Условия"),
});

export const siteSettingsSchema = z.object({
  contacts: z.object({
    phone: optionalPhone,
    additionalPhones: z.array(phone).max(5, "Не больше 5 дополнительных телефонов."),
    email: optionalEmail,
    supportEmail: optionalEmail,
    whatsapp: optionalHttpsUrl("WhatsApp"),
    telegram: optionalHttpsUrl("Telegram"),
    vk: optionalHttpsUrl("ВКонтакте"),
  }),
  location: z.object({
    address: optionalText(300, "Адрес"),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    twoGisUrl: httpsUrl("2ГИС"),
  }),
  workingHours: optionalText(200, "Часы работы"),
  delivery: z.object({
    pickup: deliveryOption,
    cityDelivery: deliveryOption,
    regionalDelivery: deliveryOption,
  }),
  services: z.object({
    tireService: z.boolean(),
    tireStorage: z.boolean(),
    balancing: z.boolean(),
    installation: z.boolean(),
    other: z
      .array(z.string().trim().min(1).max(80, "Название услуги не длиннее 80 символов."))
      .max(10, "Не больше 10 дополнительных услуг."),
  }),
}) satisfies z.ZodType<SiteSettings, unknown>;

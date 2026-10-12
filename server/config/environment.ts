import { z } from "zod";

const optionalString = (schema: z.ZodString) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_MODE: z.enum(["disable", "require"]).default("require"),
  OTP_CODE_PEPPER: optionalString(z.string().min(32)),
  YANDEX_POSTBOX_ACCESS_KEY_ID: optionalString(z.string().min(1)),
  YANDEX_POSTBOX_SECRET_ACCESS_KEY: optionalString(z.string().min(1)),
  YANDEX_POSTBOX_FROM_EMAIL: optionalString(z.string().email()),
  YANDEX_POSTBOX_FROM_NAME: optionalString(z.string().min(1).max(100)),
  INTERNAL_JOB_SECRET: optionalString(z.string().min(32)),
  INTEGRATION_API_KEY: optionalString(z.string().min(32)),
  ONEC_BASE_URL: optionalString(z.string().url()),
  ONEC_API_KEY: optionalString(z.string().min(1)),
  ONEC_API_KEY_HEADER: z.string().min(1).default("X-API-Key"),
  ONEC_USERNAME: optionalString(z.string().min(1)),
  ONEC_PASSWORD: optionalString(z.string().min(1)),
  ONEC_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8_000),
  ONEC_SAFE_RETRY_COUNT: z.coerce.number().int().min(0).max(5).default(2),
});

export type ServerEnvironment = z.infer<typeof environmentSchema> & {
  databaseSsl: false | { rejectUnauthorized: true };
};

export function readEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): ServerEnvironment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const invalidVariables = result.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");
    throw new Error(`Некорректная конфигурация backend: ${invalidVariables}`);
  }

  const values = result.data;
  return {
    ...values,
    databaseSsl:
      values.DATABASE_SSL_MODE === "require"
        ? { rejectUnauthorized: true }
        : false,
  };
}

/** Product photo limits used when the variables are empty (docs/ADMIN_CATALOG.md). */
export const DEFAULT_PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_PRODUCT_IMAGE_MAX_COUNT = 10;

/**
 * Photo upload settings, read separately from the backend environment: a
 * wrong value here disables photo uploads with a message in the admin
 * instead of stopping the catalog, orders and sign-in. Each variable is
 * checked on its own: a wrong limit stops new uploads only, while files in a
 * valid UPLOADS_DIR are still served and deleted.
 */
const uploadVariableSchemas = {
  UPLOADS_DIR: z
    .string()
    .max(1_024)
    .refine((value) => value.startsWith("/") && !value.includes("\0"), "нужен абсолютный путь"),
  PRODUCT_IMAGE_MAX_BYTES: z.coerce.number().int().min(100_000).max(20_000_000),
  PRODUCT_IMAGE_MAX_COUNT: z.coerce.number().int().min(1).max(30),
} as const;

export interface UploadEnvironment {
  /**
   * Valid absolute UPLOADS_DIR, or null when it is empty or invalid. Stored
   * photos are served and deleted whenever it is set.
   */
  uploadsDirectory: string | null;
  productImageMaxBytes: number;
  productImageMaxCount: number;
  /**
   * Why new uploads are refused although UPLOADS_DIR may be set: names the
   * invalid variables (never their values). null when the settings are valid.
   */
  problem: string | null;
}

/** True when new photos may be uploaded (valid directory and limits). */
export function uploadsAreEnabled(environment: UploadEnvironment): boolean {
  return environment.uploadsDirectory !== null && environment.problem === null;
}

export function readUploadEnvironment(
  source: Record<string, string | undefined> = process.env,
): UploadEnvironment {
  const invalid: string[] = [];
  const read = <Name extends keyof typeof uploadVariableSchemas>(name: Name) => {
    const value = source[name];
    if (value === undefined || value === "") return undefined;
    const result = uploadVariableSchemas[name].safeParse(value);
    if (!result.success) {
      invalid.push(name);
      return undefined;
    }
    return result.data as z.infer<(typeof uploadVariableSchemas)[Name]>;
  };
  const uploadsDirectory = read("UPLOADS_DIR") ?? null;
  const productImageMaxBytes = read("PRODUCT_IMAGE_MAX_BYTES") ?? DEFAULT_PRODUCT_IMAGE_MAX_BYTES;
  const productImageMaxCount = read("PRODUCT_IMAGE_MAX_COUNT") ?? DEFAULT_PRODUCT_IMAGE_MAX_COUNT;
  return {
    uploadsDirectory,
    productImageMaxBytes,
    productImageMaxCount,
    problem: invalid.length === 0
      ? null
      : `Загрузка фото отключена: некорректная настройка ${invalid.join(", ")} на сервере.` +
        (invalid.includes("UPLOADS_DIR")
          ? " Загруженные ранее фото не отдаются, пока UPLOADS_DIR не исправлен."
          : " Загруженные ранее фото продолжают показываться."),
  };
}

export function oneCConnectionIsConfigured(
  environment: Pick<
    ServerEnvironment,
    "ONEC_BASE_URL" | "ONEC_API_KEY" | "ONEC_USERNAME" | "ONEC_PASSWORD"
  >,
): boolean {
  const hasApiKey = Boolean(environment.ONEC_API_KEY);
  const hasBasicCredentials = Boolean(
    environment.ONEC_USERNAME && environment.ONEC_PASSWORD,
  );

  return Boolean(environment.ONEC_BASE_URL && (hasApiKey || hasBasicCredentials));
}

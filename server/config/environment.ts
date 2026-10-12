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

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

/**
 * Photo upload settings, read separately from the backend environment: a
 * wrong value here disables photo uploads with a message in the admin
 * instead of stopping the catalog, orders and sign-in.
 */
const uploadEnvironmentSchema = z.object({
  UPLOADS_DIR: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(1_024)
      .refine((value) => value.startsWith("/") && !value.includes("\0"), "нужен абсолютный путь")
      .optional(),
  ),
  PRODUCT_IMAGE_MAX_BYTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(100_000).max(20_000_000).default(DEFAULT_PRODUCT_IMAGE_MAX_BYTES),
  ),
  PRODUCT_IMAGE_MAX_COUNT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(30).default(DEFAULT_PRODUCT_IMAGE_MAX_COUNT),
  ),
});

export interface UploadEnvironment {
  /** Absolute directory for uploaded files; null — uploads are disabled. */
  uploadsDirectory: string | null;
  productImageMaxBytes: number;
  productImageMaxCount: number;
  /** Names the invalid variables (never their values) when the settings are rejected. */
  problem: string | null;
}

export function readUploadEnvironment(
  source: Record<string, string | undefined> = process.env,
): UploadEnvironment {
  const result = uploadEnvironmentSchema.safeParse({
    UPLOADS_DIR: source.UPLOADS_DIR,
    PRODUCT_IMAGE_MAX_BYTES: source.PRODUCT_IMAGE_MAX_BYTES,
    PRODUCT_IMAGE_MAX_COUNT: source.PRODUCT_IMAGE_MAX_COUNT,
  });
  if (!result.success) {
    const variables = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    return {
      uploadsDirectory: null,
      productImageMaxBytes: DEFAULT_PRODUCT_IMAGE_MAX_BYTES,
      productImageMaxCount: DEFAULT_PRODUCT_IMAGE_MAX_COUNT,
      problem: `Некорректная настройка загрузки фото: ${variables}`,
    };
  }
  return {
    uploadsDirectory: result.data.UPLOADS_DIR ?? null,
    productImageMaxBytes: result.data.PRODUCT_IMAGE_MAX_BYTES,
    productImageMaxCount: result.data.PRODUCT_IMAGE_MAX_COUNT,
    problem: null,
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

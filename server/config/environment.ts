import { z } from "zod";

const optionalString = (schema: z.ZodString) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_MODE: z.enum(["disable", "require"]).default("require"),
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

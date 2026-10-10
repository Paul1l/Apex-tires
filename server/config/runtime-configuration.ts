import { readEnvironment } from "./environment";
import { readSecurityLimits } from "./security-limits";
import { readTrustedProxyMode } from "../security/client-ip";

export interface ConfigurationProblem {
  severity: "error" | "warning";
  variable: string;
  message: string;
}

type EnvironmentSource = Record<string, string | undefined>;

function errorMessage(error: unknown): string {
  // Validation errors list variable names only, never values.
  return error instanceof Error ? error.message : "Некорректная конфигурация.";
}

/**
 * Finds misconfigurations that otherwise surface only as 503 responses
 * (cart, sign-in, sessions) or 500 on the first request. Preview builds
 * without a database report nothing.
 *
 * `catalogDataMode` is NEXT_PUBLIC_CATALOG_DATA_MODE as baked into the build.
 */
export function findRuntimeConfigurationProblems(
  source: EnvironmentSource = process.env,
  catalogDataMode: string | undefined = process.env.NEXT_PUBLIC_CATALOG_DATA_MODE,
): ConfigurationProblem[] {
  const problems: ConfigurationProblem[] = [];
  const hasDatabase = Boolean(source.DATABASE_URL);
  const databaseMode = hasDatabase || catalogDataMode === "database";
  if (!databaseMode) return problems;

  if (!hasDatabase) {
    problems.push({
      severity: "error",
      variable: "DATABASE_URL",
      message:
        "Сборка в режиме database, но DATABASE_URL не задан: каталог, заказы, корзина и вход недоступны.",
    });
  }
  if (!source.OTP_CODE_PEPPER) {
    problems.push({
      severity: "error",
      variable: "OTP_CODE_PEPPER",
      message:
        "OTP_CODE_PEPPER не задан: гостевая корзина, вход и сессии отвечают 503 " +
        "(CART_SECURITY_NOT_CONFIGURED, AUTH_INFRASTRUCTURE_NOT_CONFIGURED). " +
        "Задайте случайную строку не короче 32 символов.",
    });
  }
  if (hasDatabase) {
    try {
      readEnvironment(source as NodeJS.ProcessEnv);
    } catch (error) {
      problems.push({ severity: "error", variable: "backend", message: errorMessage(error) });
    }
  }
  try {
    readSecurityLimits(source);
  } catch (error) {
    problems.push({ severity: "error", variable: "rate limits", message: errorMessage(error) });
  }
  try {
    if (readTrustedProxyMode(source) === "none" && source.NODE_ENV === "production") {
      problems.push({
        severity: "warning",
        variable: "TRUSTED_PROXY",
        message:
          "TRUSTED_PROXY не задан: IP клиента неизвестен, лимиты по IP отключены. На VDS за nginx задайте TRUSTED_PROXY=nginx.",
      });
    }
  } catch (error) {
    problems.push({ severity: "error", variable: "TRUSTED_PROXY", message: errorMessage(error) });
  }
  return problems;
}

/**
 * Logs configuration problems once per process: at server start
 * (instrumentation.ts) and, as a fallback for runtimes without the
 * instrumentation hook, on the first database-backed request.
 */
export function reportRuntimeConfigurationOnce(
  source: EnvironmentSource = process.env,
  logger: Pick<Console, "error" | "warn"> = console,
): ConfigurationProblem[] {
  const state = globalThis as { apexRuntimeConfigurationReported?: boolean };
  if (state.apexRuntimeConfigurationReported) return [];
  state.apexRuntimeConfigurationReported = true;
  const problems = findRuntimeConfigurationProblems(source);
  for (const problem of problems) {
    const line = `[config] ${problem.severity === "error" ? "ОШИБКА" : "Предупреждение"} (${problem.variable}): ${problem.message}`;
    if (problem.severity === "error") logger.error(line);
    else logger.warn(line);
  }
  return problems;
}

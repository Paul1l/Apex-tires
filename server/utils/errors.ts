import { ZodError } from "zod";

export class ApplicationError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor({
    code,
    message,
    statusCode = 400,
    details,
  }: {
    code: string;
    message: string;
    statusCode?: number;
    details?: unknown;
  }) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Socket errors meaning the database server cannot be reached. */
const UNREACHABLE_SOCKET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

/**
 * PostgreSQL SQLSTATE codes for an unavailable server: class 08 (connection
 * exception), 57P01–57P03 (shutdown, crash, starting up), 53300 (too many
 * connections).
 */
const UNAVAILABLE_SQLSTATE = /^(08[0-9A-Z]{3}|57P0[123]|53300)$/;

/** Messages of node-postgres for a lost or impossible connection (no code). */
const UNAVAILABLE_MESSAGES = [
  "Connection terminated",
  "timeout exceeded when trying to connect",
  "Client has encountered a connection error and is not queryable",
  "Client was closed and is not queryable",
];

/**
 * True when the error means "PostgreSQL is unreachable right now" (stopped,
 * restarting, network, pool timeout), not a bug or invalid data.
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = Reflect.get(error, "code");
  if (typeof code === "string" && (UNREACHABLE_SOCKET_CODES.has(code) || UNAVAILABLE_SQLSTATE.test(code))) {
    return true;
  }
  return UNAVAILABLE_MESSAGES.some((message) => error.message.startsWith(message));
}

export function toSafeError(error: unknown): {
  statusCode: number;
  body: {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
  };
} {
  if (error instanceof ZodError) return { statusCode: 422, body: {
    ok: false, code: "VALIDATION_ERROR", message: "Проверьте введённые параметры.",
    details: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
  } };
  if (error instanceof ApplicationError) {
    return {
      statusCode: error.statusCode,
      body: {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  if (isDatabaseUnavailableError(error)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Сервис временно недоступен. Повторите попытку через несколько минут.",
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Сервис временно не может обработать запрос. Повторите попытку позже.",
    },
  };
}

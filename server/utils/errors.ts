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

export function toSafeError(error: unknown): {
  statusCode: number;
  body: {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
  };
} {
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

  return {
    statusCode: 500,
    body: {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Сервис временно не может обработать запрос. Повторите попытку позже.",
    },
  };
}

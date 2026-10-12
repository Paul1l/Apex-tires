/** Browser calls of the admin catalog API (same-origin session cookie). */

export interface AdminApiIssue {
  field: string;
  message: string;
}

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly issues: AdminApiIssue[],
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

function readIssues(details: unknown): AdminApiIssue[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((item) =>
    item && typeof item === "object" && typeof item.field === "string" && typeof item.message === "string"
      ? [{ field: item.field, message: item.message }]
      : [],
  );
}

/**
 * JSON request to /api/admin/...; throws AdminApiError with the server's
 * Russian message, code and field issues for any non-2xx answer.
 */
export async function adminApi<Result>(
  url: string,
  options: { method?: string; json?: unknown; form?: FormData; signal?: AbortSignal } = {},
): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (options.json !== undefined || options.form ? "POST" : "GET"),
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
      headers: options.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.form ?? (options.json !== undefined ? JSON.stringify(options.json) : undefined),
    });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw error;
    throw new AdminApiError("Нет связи с сервером. Проверьте подключение и повторите.", 0, "NETWORK_ERROR", []);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON answer (proxy error page): reported below by status.
  }
  if (!response.ok) {
    const message = typeof body.message === "string"
      ? body.message
      : response.status === 413
        ? "Файл или запрос слишком большой."
        : "Сервер не смог выполнить действие. Повторите позже.";
    throw new AdminApiError(message, response.status, typeof body.code === "string" ? body.code : "HTTP_ERROR", readIssues(body.details));
  }
  return body as Result;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

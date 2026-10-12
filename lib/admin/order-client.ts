/**
 * Browser calls of the admin order API. Errors carry the Russian message of
 * the API (or a fallback) so components can show and announce it.
 */
import type { AdminApiErrorBody } from "./order-types";

export class AdminOrderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AdminOrderRequestError";
  }
}

const SESSION_MESSAGE = "Сессия сотрудника завершилась. Обновите страницу и войдите снова.";

export async function adminOrderRequest<Result>(
  url: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; signal?: AbortSignal; fallbackMessage: string },
): Promise<Result> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const body = (payload ?? {}) as AdminApiErrorBody;
    const message =
      response.status === 401 ? SESSION_MESSAGE : body.message || options.fallbackMessage;
    throw new AdminOrderRequestError(message, response.status, body.code);
  }
  return payload as Result;
}

export function requestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

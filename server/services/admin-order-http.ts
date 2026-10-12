import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { databaseIsConfigured } from "../bootstrap/application-services";
import { applicationLogger } from "../types/common";
import { ApplicationError, toSafeError } from "../utils/errors";
import { firstValidationMessage, orderIdSchema } from "../validators/admin-order-schema";

/** Shared pieces of the /api/admin/orders/** route handlers. */

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/** 503 before anything else when PostgreSQL orders are not configured (same code as before T21c). */
export function requireOrderStorage(): void {
  if (!databaseIsConfigured()) {
    throw new ApplicationError({
      code: "ORDER_STORAGE_NOT_CONFIGURED",
      message: "PostgreSQL-заказы пока не подключены.",
      statusCode: 503,
    });
  }
}

export async function readOrderIdParameter(
  params: Promise<{ orderId: string }>,
): Promise<string> {
  const { orderId } = await params;
  const validation = orderIdSchema.safeParse(orderId);
  if (!validation.success) {
    throw new ApplicationError({
      code: "INVALID_ORDER_ID",
      message: "Некорректный идентификатор заказа.",
      statusCode: 422,
    });
  }
  return validation.data.toLowerCase();
}

export function validationFailed(error: ZodError, fallback: string): ApplicationError {
  return new ApplicationError({
    code: "VALIDATION_ERROR",
    message: firstValidationMessage(error, fallback),
    statusCode: 422,
  });
}

/** Logs a sanitized error (no personal data) and returns the safe JSON error. */
export function adminOrderErrorResponse(error: unknown, logMessage: string): NextResponse {
  applicationLogger.error({ error }, logMessage);
  const safeError = toSafeError(error);
  return NextResponse.json(safeError.body, {
    status: safeError.statusCode,
    headers: NO_STORE_HEADERS,
  });
}

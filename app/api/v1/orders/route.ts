import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { createOrderSchema } from "@/server/validators/order-schemas";
import { formatValidationIssues } from "@/server/validators/one-c-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "ORDER_STORAGE_NOT_CONFIGURED",
        message:
          "Приём реальных заказов пока не подключён. Позвоните менеджеру или попробуйте позже.",
        statusCode: 503,
      });
    }

    const validationResult = createOrderSchema.safeParse(
      await readJsonRequest(request, 100_000),
    );
    if (!validationResult.success) {
      throw new ApplicationError({
        code: "VALIDATION_ERROR",
        message: "Проверьте контактные данные, способ получения и состав заказа.",
        statusCode: 422,
        details: formatValidationIssues(validationResult.error),
      });
    }

    const order = await createApplicationServices().orderService.createOrder(
      validationResult.data,
    );
    return NextResponse.json(
      {
        ok: true,
        order: {
          id: order.id,
          number: order.number,
          duplicate: order.duplicate ?? false,
        },
      },
      { status: order.duplicate ? 200 : 201 },
    );
  } catch (error) {
    applicationLogger.error({ error }, "Order creation failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

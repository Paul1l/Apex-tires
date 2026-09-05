import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { updateOrderStatusSchema } from "@/server/validators/admin-order-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "ORDER_STORAGE_NOT_CONFIGURED",
        message: "PostgreSQL-заказы пока не подключены.",
        statusCode: 503,
      });
    }
    const user = await requireUserRole(request, ["manager", "admin"]);
    const { orderId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      throw new ApplicationError({
        code: "INVALID_ORDER_ID",
        message: "Некорректный идентификатор заказа.",
        statusCode: 422,
      });
    }
    const validation = updateOrderStatusSchema.safeParse(
      await readJsonRequest(request, 20_000),
    );
    if (!validation.success) {
      throw new ApplicationError({
        code: "VALIDATION_ERROR",
        message: "Выберите допустимый статус заказа.",
        statusCode: 422,
      });
    }
    await createApplicationServices().adminOrderService.updateStatus(
      user.id,
      orderId,
      validation.data,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    applicationLogger.error({ error }, "Administrative order status update failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

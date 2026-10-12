import { NextResponse } from "next/server";
import { requireUserRole } from "@/server/security/request-auth";
import { createAdminOrderService } from "@/server/services/admin-order-factory";
import {
  adminOrderErrorResponse,
  NO_STORE_HEADERS,
  readOrderIdParameter,
  requireOrderStorage,
} from "@/server/services/admin-order-http";
import { ApplicationError } from "@/server/utils/errors";
import { canChangePaymentStatus } from "@/server/validators/admin-order-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Full order for staff: items, customer, delivery, totals, history, 1C state, staff comments. */
export async function GET(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    requireOrderStorage();
    const user = await requireUserRole(request, ["manager", "admin"]);
    const orderId = await readOrderIdParameter(context.params);
    const order = await createAdminOrderService().getOrderDetails(orderId);
    if (!order) {
      throw new ApplicationError({
        code: "ORDER_NOT_FOUND",
        message: "Заказ не найден.",
        statusCode: 404,
      });
    }
    return NextResponse.json(
      {
        ok: true,
        order,
        permissions: { canChangePaymentStatus: canChangePaymentStatus(user.role) },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return adminOrderErrorResponse(error, "Administrative order details request failed");
  }
}

import { NextResponse } from "next/server";
import { requireUserRole } from "@/server/security/request-auth";
import { createAdminOrderService } from "@/server/services/admin-order-factory";
import {
  adminOrderErrorResponse,
  NO_STORE_HEADERS,
  readOrderIdParameter,
  requireOrderStorage,
  validationFailed,
} from "@/server/services/admin-order-http";
import { readJsonRequest } from "@/server/utils/http";
import { updateOrderStatusSchema } from "@/server/validators/admin-order-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Body: { status, comment?, paymentStatus? }. paymentStatus is accepted only
 * from the admin role (403 otherwise); the comment is saved with the actor in
 * the order status history.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    requireOrderStorage();
    const user = await requireUserRole(request, ["manager", "admin"]);
    const orderId = await readOrderIdParameter(context.params);
    const validation = updateOrderStatusSchema.safeParse(
      await readJsonRequest(request, 20_000),
    );
    if (!validation.success) {
      throw validationFailed(validation.error, "Выберите допустимый статус заказа.");
    }
    const result = await createAdminOrderService().updateStatus(
      { id: user.id, role: user.role },
      orderId,
      validation.data,
    );
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return adminOrderErrorResponse(error, "Administrative order status update failed");
  }
}

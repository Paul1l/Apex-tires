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
import { updatePaymentStatusSchema } from "@/server/validators/admin-order-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Payment status of an order; role admin only. Body: { paymentStatus }. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    requireOrderStorage();
    const user = await requireUserRole(request, ["admin"]);
    const orderId = await readOrderIdParameter(context.params);
    const validation = updatePaymentStatusSchema.safeParse(
      await readJsonRequest(request, 2_000),
    );
    if (!validation.success) {
      throw validationFailed(validation.error, "Выберите допустимый статус оплаты.");
    }
    const result = await createAdminOrderService().updatePaymentStatus(
      { id: user.id, role: user.role },
      orderId,
      validation.data,
    );
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return adminOrderErrorResponse(error, "Administrative order payment status update failed");
  }
}

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
import { createOrderCommentSchema } from "@/server/validators/admin-order-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Internal staff comment on an order. Body: { body } (1-2000 characters). */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    requireOrderStorage();
    const user = await requireUserRole(request, ["manager", "admin"]);
    const orderId = await readOrderIdParameter(context.params);
    const validation = createOrderCommentSchema.safeParse(
      await readJsonRequest(request, 20_000),
    );
    if (!validation.success) {
      throw validationFailed(validation.error, "Проверьте текст комментария.");
    }
    const comment = await createAdminOrderService().addComment(
      { id: user.id, role: user.role },
      orderId,
      validation.data,
    );
    return NextResponse.json({ ok: true, comment }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    return adminOrderErrorResponse(error, "Administrative order comment failed");
  }
}

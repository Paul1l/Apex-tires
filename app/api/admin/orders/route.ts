import { NextResponse } from "next/server";
import { requireUserRole } from "@/server/security/request-auth";
import { createAdminOrderService } from "@/server/services/admin-order-factory";
import {
  adminOrderErrorResponse,
  NO_STORE_HEADERS,
  requireOrderStorage,
  validationFailed,
} from "@/server/services/admin-order-http";
import { parseAdminOrderListQuery } from "@/server/validators/admin-order-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin order list: ?q= (number, phone digits, email, customer name),
 * status, integrationStatus, from/to (YYYY-MM-DD, Barnaul days), page,
 * pageSize (1-100, default 25). Without parameters: the newest 25 orders.
 */
export async function GET(request: Request) {
  try {
    requireOrderStorage();
    await requireUserRole(request, ["manager", "admin"]);
    const query = parseAdminOrderListQuery(new URL(request.url).searchParams);
    if (!query.success) throw validationFailed(query.error, "Проверьте параметры поиска заказов.");
    const result = await createAdminOrderService().listOrders(query.data);
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return adminOrderErrorResponse(error, "Administrative orders request failed");
  }
}

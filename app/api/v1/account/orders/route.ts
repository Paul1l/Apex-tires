import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "ORDER_STORAGE_NOT_CONFIGURED",
        message: "История заказов пока не подключена.",
        statusCode: 503,
      });
    }
    const user = await requireUserRole(request, ["customer", "manager", "admin"]);
    const orders = await createApplicationServices().orderService.getOrdersForUser(
      user.id,
    );
    return NextResponse.json(
      { ok: true, items: orders },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    applicationLogger.error({ error }, "Account order history request failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

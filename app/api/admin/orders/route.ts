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
        message: "PostgreSQL-заказы пока не подключены.",
        statusCode: 503,
      });
    }
    await requireUserRole(request, ["manager", "admin"]);
    const orders =
      await createApplicationServices().orderService.getOrdersForAdministration();
    return NextResponse.json(
      { ok: true, items: orders },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    applicationLogger.error({ error }, "Administrative orders request failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

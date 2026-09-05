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

export async function POST(request: Request) {
  try {
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "DATABASE_NOT_CONFIGURED",
        message: "PostgreSQL пока не подключён.",
        statusCode: 503,
      });
    }
    await requireUserRole(request, ["manager", "admin"]);
    const retried =
      await createApplicationServices().orderIntegrationService.retryFailedOrders();
    return NextResponse.json({ ok: true, retried });
  } catch (error) {
    applicationLogger.error({ error }, "Failed 1C orders retry request failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

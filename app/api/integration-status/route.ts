import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { requireUserRole } from "@/server/security/request-auth";
import { toSafeError } from "@/server/utils/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const emptySynchronizationSummary = {
  last_success_at: null,
  products_processed_24h: 0,
  error_runs: 0,
  recentErrors: [],
};

const emptyOrderSummary = {
  pending: 0,
  processing: 0,
  synced: 0,
  failed: 0,
};

export async function GET(request: Request) {
  if (!databaseIsConfigured()) {
    return NextResponse.json(
      {
        ok: true,
        site: "healthy",
        database: "not_configured",
        oneC: "not_configured",
        timestamp: new Date().toISOString(),
        synchronization: emptySynchronizationSummary,
        orders: emptyOrderSummary,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    await requireUserRole(request, ["manager", "admin"]);
    const status = await createApplicationServices().integrationStatusService.getAdminStatus();
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    applicationLogger.error({ error }, "Integration status request failed");
    const safeError = toSafeError(error);
    if (safeError.statusCode === 401 || safeError.statusCode === 403) {
      return NextResponse.json(safeError.body, { status: safeError.statusCode });
    }
    return NextResponse.json(
      {
        ok: false,
        site: "degraded",
        database: "unavailable",
        oneC: "not_configured",
        timestamp: new Date().toISOString(),
        synchronization: emptySynchronizationSummary,
        orders: emptyOrderSummary,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

import { NextResponse } from "next/server";
import { createApplicationServices } from "@/server/bootstrap/application-services";
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

/**
 * Detailed status for staff (manager/admin). Anonymous requests get 401 in
 * every mode, including a site without a database (no sessions there, so
 * nobody can sign in); the anonymous liveness check is /api/health.
 */
export async function GET(request: Request) {
  try {
    await requireUserRole(request, ["manager", "admin"]);
    const status = await createApplicationServices().integrationStatusService.getAdminStatus();
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const safeError = toSafeError(error);
    if (safeError.statusCode === 401 || safeError.statusCode === 403) {
      return NextResponse.json(safeError.body, {
        status: safeError.statusCode,
        headers: { "Cache-Control": "no-store" },
      });
    }
    applicationLogger.error({ error }, "Integration status request failed");
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

import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";

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

export async function GET() {
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
    const status = await createApplicationServices().integrationStatusService.getAdminStatus();
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
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

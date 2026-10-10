import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import {
  CachedDatabaseProbe,
  createPublicHealthReport,
  type DatabaseHealth,
} from "@/server/services/health-check";
import { applicationLogger } from "@/server/types/common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

declare global {
  var apexDatabaseHealthProbe: CachedDatabaseProbe | undefined;
}

async function databaseHealth(): Promise<DatabaseHealth> {
  if (!databaseIsConfigured()) return "not_configured";
  globalThis.apexDatabaseHealthProbe ??= new CachedDatabaseProbe({
    query: async () => createApplicationServices().pool.query("SELECT 1"),
    logger: applicationLogger,
  });
  return globalThis.apexDatabaseHealthProbe.check();
}

/**
 * Anonymous liveness check for monitoring: overall status and whether
 * PostgreSQL answers. 503 when the configured database is unavailable.
 * Versions and configuration are not reported (details for staff:
 * /api/integration-status).
 */
export async function GET() {
  const report = createPublicHealthReport(await databaseHealth());
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

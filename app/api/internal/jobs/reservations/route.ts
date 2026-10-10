import { NextResponse } from "next/server";
import { createApplicationServices } from "@/server/bootstrap/application-services";
import { requestHasValidApiKey } from "@/server/utils/authentication";
import { releaseExpiredReservations } from "@/server/services/reservation-cleanup-service";
import { pruneExpiredRateLimitBuckets } from "@/server/security/postgres-rate-limiter";
import { applicationLogger } from "@/server/types/common";
import { toSafeError } from "@/server/utils/errors";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!process.env.INTERNAL_JOB_SECRET || !requestHasValidApiKey(request,process.env.INTERNAL_JOB_SECRET,"X-Job-Key")) {
    return NextResponse.json({ok:false,message:"Неверный ключ задания."},{status:401});
  }
  try {
    const pool = createApplicationServices().pool;
    const releasedOrders = await releaseExpiredReservations(pool);
    // Housekeeping for the rate limiter; a failure must not fail the reservation job.
    await pruneExpiredRateLimitBuckets(pool, 5_000).catch((error: unknown) =>
      applicationLogger.warn({ error }, "Rate limit bucket cleanup failed"),
    );
    return NextResponse.json({ok:true,releasedOrders});
  } catch(error) { const safe=toSafeError(error); return NextResponse.json(safe.body,{status:safe.statusCode}); }
}

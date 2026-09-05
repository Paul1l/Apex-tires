import { NextResponse } from "next/server";
import { createApplicationServices } from "@/server/bootstrap/application-services";
import { requestHasValidApiKey } from "@/server/utils/authentication";
import { releaseExpiredReservations } from "@/server/services/reservation-cleanup-service";
import { toSafeError } from "@/server/utils/errors";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!process.env.INTERNAL_JOB_SECRET || !requestHasValidApiKey(request,process.env.INTERNAL_JOB_SECRET,"X-Job-Key")) {
    return NextResponse.json({ok:false,message:"Неверный ключ задания."},{status:401});
  }
  try {
    return NextResponse.json({ok:true,releasedOrders:await releaseExpiredReservations(createApplicationServices().pool)});
  } catch(error) { const safe=toSafeError(error); return NextResponse.json(safe.body,{status:safe.statusCode}); }
}

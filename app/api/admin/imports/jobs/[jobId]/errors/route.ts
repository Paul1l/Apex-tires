import { NextResponse } from "next/server";
import { z } from "zod";
import { createApplicationServices } from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { toSafeError } from "@/server/utils/errors";
import { encodeCsvCell } from "@/server/utils/csv-cell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireUserRole(request, ["manager", "admin"]);
    const { jobId } = await params;
    if (!z.uuid().safeParse(jobId).success) return NextResponse.json({ message: "Некорректное задание." }, { status: 422 });
    const { pool } = createApplicationServices();
    let offset = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (offset === 0) controller.enqueue(encoder.encode("\uFEFFrow,sku,field,code,message\r\n"));
          const result = await pool.query<{ row_number: number; sku: string; field: string; error_code: string; message: string }>(
            "SELECT row_number,sku,field,error_code,message FROM import_job_errors WHERE job_id=$1 ORDER BY row_number,id LIMIT 1000 OFFSET $2", [jobId, offset],
          );
          for (const row of result.rows) controller.enqueue(encoder.encode([row.row_number,row.sku,row.field,row.error_code,row.message].map(encodeCsvCell).join(",") + "\r\n"));
          offset += result.rows.length;
          if (result.rows.length < 1000) controller.close();
        } catch (error) { controller.error(error); }
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="import-${jobId}-errors.csv"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    const safe = toSafeError(error);
    return NextResponse.json(safe.body, { status: safe.statusCode });
  }
}

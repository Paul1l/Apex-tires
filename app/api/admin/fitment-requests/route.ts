import { NextResponse } from "next/server";
import { z } from "zod";
import { createApplicationServices } from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { toSafeError } from "@/server/utils/errors";
import { withTransaction } from "@/server/database/postgres-client";
import { AdminAuditRepository } from "@/server/repositories/admin-audit-repository";
import { readJsonRequest } from "@/server/utils/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const updateSchema = z.object({ id: z.uuid(), status: z.enum(["new", "in_progress", "resolved", "closed"]) });

export async function GET(request: Request) {
  try {
    await requireUserRole(request, ["manager", "admin"]);
    const page = z.coerce.number().int().min(1).max(10000).safeParse(new URL(request.url).searchParams.get("page") || 1);
    if (!page.success) return NextResponse.json({ message: "Некорректная страница." }, { status: 422 });
    const result = await createApplicationServices().pool.query(
      `SELECT id,make,model,model_year,generation,modification,customer_name,customer_phone,status,created_at
       FROM vehicle_fitment_requests ORDER BY created_at DESC,id LIMIT 51 OFFSET $1`, [(page.data - 1) * 50],
    );
    return NextResponse.json({ items: result.rows.slice(0,50), hasNextPage: result.rows.length > 50 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { const safe = toSafeError(error); return NextResponse.json(safe.body, { status: safe.statusCode }); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const parsed = updateSchema.safeParse(await readJsonRequest(request, 10000));
    if (!parsed.success) return NextResponse.json({ message: "Проверьте заявку и статус." }, { status: 422 });
    const changed = await withTransaction(createApplicationServices().pool, async (database) => {
      const result = await database.query("UPDATE vehicle_fitment_requests SET status=$2,updated_at=NOW() WHERE id=$1", [parsed.data.id, parsed.data.status]);
      if (result.rowCount) await new AdminAuditRepository().record(database, { actorUserId: actor.id, action: "fitment_request.status_updated", entityType: "vehicle_fitment_requests", entityId: parsed.data.id, details: { status: parsed.data.status } });
      return Boolean(result.rowCount);
    });
    return NextResponse.json({ ok: changed }, { status: changed ? 200 : 404 });
  } catch (error) { const safe = toSafeError(error); return NextResponse.json(safe.body, { status: safe.statusCode }); }
}

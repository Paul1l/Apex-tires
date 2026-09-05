import { NextResponse } from "next/server";
import { createApplicationServices } from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { bulkProductSchema } from "@/server/validators/admin-product-schema";
import { updateSelectedProducts } from "@/server/services/admin-product-service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const actor = await requireUserRole(request, ["admin"]);
    const input = bulkProductSchema.parse(await readJsonRequest(request, 20000));
    const updated = await updateSelectedProducts(createApplicationServices().pool, actor.id, input);
    return NextResponse.json({ ok: true, updated });
  } catch (error) { const safe = toSafeError(error); return NextResponse.json(safe.body, { status: safe.statusCode }); }
}

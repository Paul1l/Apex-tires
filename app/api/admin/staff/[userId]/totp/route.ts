import { NextResponse } from "next/server";
import { requireUserRole } from "@/server/security/request-auth";
import { getStaffServices } from "@/server/services/staff-service-factory";
import { applicationLogger } from "@/server/types/common";
import { toSafeError } from "@/server/utils/errors";
import { staffUserIdSchema } from "@/server/validators/staff-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * New authenticator key for a staff member (lost or new phone). The old key
 * stops working and all sessions of that person end. The response holds the
 * one-time key. Administrators only.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const actor = await requireUserRole(request, ["admin"]);
    const userId = staffUserIdSchema.parse((await context.params).userId);
    const result = await getStaffServices().management.reissueKey(actor.id, userId);
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    applicationLogger.error({ error }, "Staff key reissue failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode, headers: NO_STORE });
  }
}

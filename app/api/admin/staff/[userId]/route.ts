import { NextResponse } from "next/server";
import { requireUserRole } from "@/server/security/request-auth";
import { getStaffServices } from "@/server/services/staff-service-factory";
import { applicationLogger } from "@/server/types/common";
import { toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { staffUserIdSchema, updateStaffSchema } from "@/server/validators/staff-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Role (`manager`, `admin`, or `customer` to revoke staff rights) and status
 * (`active`, `blocked`) of a staff member. Administrators only; not for the
 * own account and not for the last active administrator.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const actor = await requireUserRole(request, ["admin"]);
    const userId = staffUserIdSchema.parse((await context.params).userId);
    const changes = updateStaffSchema.parse(await readJsonRequest(request, 4_000));
    const member = await getStaffServices().management.updateStaff(actor.id, userId, changes);
    return NextResponse.json({ ok: true, member }, { headers: NO_STORE });
  } catch (error) {
    applicationLogger.error({ error }, "Staff update failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode, headers: NO_STORE });
  }
}

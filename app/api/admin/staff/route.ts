import { NextResponse } from "next/server";
import { requireUserRole } from "@/server/security/request-auth";
import { getStaffServices } from "@/server/services/staff-service-factory";
import { applicationLogger } from "@/server/types/common";
import { toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { createStaffSchema } from "@/server/validators/staff-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(error: unknown, logMessage: string) {
  applicationLogger.error({ error }, logMessage);
  const safeError = toSafeError(error);
  return NextResponse.json(safeError.body, { status: safeError.statusCode, headers: NO_STORE });
}

/** Staff list (administrators only). */
export async function GET(request: Request) {
  try {
    await requireUserRole(request, ["admin"]);
    const items = await getStaffServices().management.listStaff();
    return NextResponse.json({ ok: true, items }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Staff list failed");
  }
}

/**
 * Adds a staff member or gives the role to an existing customer account.
 * The response holds the one-time key (QR code, otpauth URI, base32).
 */
export async function POST(request: Request) {
  try {
    const actor = await requireUserRole(request, ["admin"]);
    const input = createStaffSchema.parse(await readJsonRequest(request, 4_000));
    const result = await getStaffServices().management.createStaff(actor.id, input);
    return NextResponse.json({ ok: true, ...result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Staff creation failed");
  }
}

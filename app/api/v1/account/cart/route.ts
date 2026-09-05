import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { cartLinesSchema } from "@/server/validators/cart-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(operation: (userId: string) => Promise<unknown>, request: Request) {
  try {
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "CART_STORAGE_NOT_CONFIGURED",
        message: "Хранение корзины пока не подключено.",
        statusCode: 503,
      });
    }
    const user = await requireUserRole(request, ["customer", "manager", "admin"]);
    return NextResponse.json({ ok: true, items: await operation(user.id) });
  } catch (error) {
    applicationLogger.error({ error }, "Account cart request failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

export async function GET(request: Request) {
  return handle(
    (userId) => createApplicationServices().cartService.getCart(userId),
    request,
  );
}

export async function PUT(request: Request) {
  let payload: unknown;
  try {
    payload = await readJsonRequest(request, 100_000);
  } catch (error) {
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
  const validation = cartLinesSchema.safeParse(payload);
  if (!validation.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_ERROR", message: "Проверьте состав корзины." },
      { status: 422 },
    );
  }
  return handle(
    (userId) =>
      createApplicationServices().cartService.replaceCart(
        userId,
        validation.data.items,
      ),
    request,
  );
}

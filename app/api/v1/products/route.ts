import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "CATALOG_STORAGE_NOT_CONFIGURED",
        message: "Рабочий каталог пока не подключён.",
        statusCode: 503,
      });
    }
    const products =
      await createApplicationServices().catalogService.getActiveProducts();
    return NextResponse.json({ ok: true, items: products });
  } catch (error) {
    applicationLogger.error({ error }, "Catalog loading failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

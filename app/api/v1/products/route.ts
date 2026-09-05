import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { parseCatalogQuery } from "@/server/validators/catalog-query-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "CATALOG_STORAGE_NOT_CONFIGURED",
        message: "Рабочий каталог пока не подключён.",
        statusCode: 503,
      });
    }
    const publicParameters = new URL(request.url).searchParams;
    publicParameters.delete("active");
    publicParameters.delete("sourceSystem");
    const query = parseCatalogQuery(publicParameters);
    const result = await createApplicationServices().catalogService.getCatalogPage(query);
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
    });
  } catch (error) {
    applicationLogger.error({ error }, "Catalog loading failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

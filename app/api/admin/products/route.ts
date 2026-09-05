import { NextResponse } from "next/server";
import { createApplicationServices, databaseIsConfigured } from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { parseCatalogQuery } from "@/server/validators/catalog-query-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!databaseIsConfigured()) throw new ApplicationError({
      code: "CATALOG_STORAGE_NOT_CONFIGURED", message: "PostgreSQL-каталог пока не подключён.", statusCode: 503,
    });
    await requireUserRole(request, ["manager", "admin"]);
    const query = parseCatalogQuery(new URL(request.url).searchParams);
    const result = await createApplicationServices().catalogService.getCatalogPage(query);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const safe = toSafeError(error);
    return NextResponse.json(safe.body, { status: safe.statusCode });
  }
}

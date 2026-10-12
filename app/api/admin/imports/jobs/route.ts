import { NextResponse } from "next/server";
import { createApplicationServices, databaseIsConfigured } from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { ImportJobRepository } from "@/server/repositories/import-job-repository";
import { failStaleImportJobs } from "@/server/services/catalog-import-service";
import { ApplicationError, toSafeError } from "@/server/utils/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!databaseIsConfigured()) throw new ApplicationError({
      code: "CATALOG_STORAGE_NOT_CONFIGURED", message: "PostgreSQL-каталог пока не подключён.", statusCode: 503,
    });
    await requireUserRole(request, ["manager", "admin"]);
    const services = createApplicationServices();
    const repository = new ImportJobRepository();
    // A job whose process died (or whose final status could not be saved)
    // is shown as failed instead of "processing" forever.
    await failStaleImportJobs(services.pool, repository);
    const items = await repository.list(services.pool, 50);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    const safe = toSafeError(error);
    return NextResponse.json(safe.body, { status: safe.statusCode });
  }
}

import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readCsvUpload } from "@/server/utils/csv-upload";
import { revalidateStorefrontCatalog } from "@/server/cache/storefront-revalidation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "CATALOG_STORAGE_NOT_CONFIGURED",
        message: "PostgreSQL-каталог пока не подключён.",
        statusCode: 503,
      });
    }
    const user = await requireUserRole(request, ["manager", "admin"]);
    const upload = await readCsvUpload(request);
    let report;
    try {
      report =
        await createApplicationServices().catalogImportService.importProductsCsvStream(
          upload.stream,
          upload.filename,
          upload.mode,
          user.id,
        );
    } finally {
      // Batches are committed as they go, so even an interrupted import may
      // have changed products, prices or stock shown on the cached pages.
      revalidateStorefrontCatalog("products-csv-import");
    }
    return NextResponse.json({ ok: report.ok, report }, { status: report.ok ? 200 : 207 });
  } catch (error) {
    applicationLogger.error({ error }, "Product CSV import failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

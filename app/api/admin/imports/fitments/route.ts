import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { requireUserRole } from "@/server/security/request-auth";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readCsvUpload } from "@/server/utils/csv-upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "FITMENT_STORAGE_NOT_CONFIGURED",
        message: "PostgreSQL-база применяемости пока не подключена.",
        statusCode: 503,
      });
    }
    const user = await requireUserRole(request, ["manager", "admin"]);
    const upload = await readCsvUpload(request);
    const report =
      await createApplicationServices().catalogImportService.importFitmentsCsvStream(
        upload.stream,
        upload.filename,
        user.id,
      );
    return NextResponse.json({ ok: report.ok, report }, { status: report.ok ? 200 : 207 });
  } catch (error) {
    applicationLogger.error({ error }, "Fitment CSV import failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

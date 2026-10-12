import { NextResponse } from "next/server";
import { revalidateWholeSite } from "@/server/cache/storefront-revalidation";
import { requestHasValidApiKey } from "@/server/utils/authentication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal job: resets the cache of every page (QA-42). Run once after each
 * deployment: the Docker build has no database, so prerendered pages carry
 * build-time contacts, delivery options and no initial catalog until they are
 * regenerated. Protected like the other internal jobs (X-Job-Key =
 * INTERNAL_JOB_SECRET); without the secret configured the endpoint is disabled.
 */
export async function POST(request: Request) {
  if (
    !process.env.INTERNAL_JOB_SECRET ||
    !requestHasValidApiKey(request, process.env.INTERNAL_JOB_SECRET, "X-Job-Key")
  ) {
    return NextResponse.json({ ok: false, message: "Неверный ключ задания." }, { status: 401 });
  }
  const revalidated = revalidateWholeSite("internal-job");
  return NextResponse.json(
    { ok: revalidated },
    { status: revalidated ? 200 : 500, headers: { "Cache-Control": "no-store" } },
  );
}

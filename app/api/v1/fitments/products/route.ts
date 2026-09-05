import { NextRequest, NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { catalogQuerySchema } from "@/server/validators/catalog-query-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const make = request.nextUrl.searchParams.get("make")?.trim() ?? "";
  const model = request.nextUrl.searchParams.get("model")?.trim() ?? "";
  const generation = request.nextUrl.searchParams.get("generation")?.trim() || undefined;
  const modification = request.nextUrl.searchParams.get("modification")?.trim() || undefined;
  const rawYear = request.nextUrl.searchParams.get("year");
  const year = rawYear ? Number(rawYear) : undefined;
  if (
    !make ||
    !model || !generation ||
    make.length > 120 ||
    model.length > 160 ||
    (generation && generation.length > 120) ||
    (modification && modification.length > 160) ||
    (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > 2200))
  ) {
    return NextResponse.json(
      { ok: false, code: "INVALID_VEHICLE", message: "Проверьте параметры автомобиля." },
      { status: 422 },
    );
  }
  if (!databaseIsConfigured()) {
    return NextResponse.json(
      { ok: false, code: "FITMENT_STORAGE_NOT_CONFIGURED", message: "База применяемости пока не подключена." },
      { status: 503 },
    );
  }
  try {
    const validation = catalogQuerySchema.safeParse({
      type: request.nextUrl.searchParams.get("type") || "all",
      page: request.nextUrl.searchParams.get("page") || 1,
      pageSize: request.nextUrl.searchParams.get("pageSize") || 24,
      vehicleMake: make, vehicleModel: model, vehicleGeneration: generation,
      vehicleModification: modification,
    });
    if (!validation.success) return NextResponse.json({ ok: false, message: "Проверьте параметры каталога." }, { status: 422 });
    const services = createApplicationServices();
    const [result, fitments] = await Promise.all([
      services.catalogService.getCatalogPage(validation.data),
      services.fitmentProvider.getFitments({ make, model, generation, modification, year }),
    ]);
    return NextResponse.json({ ok: true, ...result, fitments });
  } catch (error) {
    applicationLogger.error({ error }, "Vehicle fitment lookup failed");
    return NextResponse.json(
      { ok: false, code: "FITMENT_LOOKUP_UNAVAILABLE", message: "Подбор временно недоступен." },
      { status: 503 },
    );
  }
}

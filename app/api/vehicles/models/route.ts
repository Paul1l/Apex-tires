import { NextRequest, NextResponse } from "next/server";
import { applicationLogger } from "@/server/types/common";
import { sortVehicleModels } from "@/lib/vehicle-catalog";
import { businessConfig } from "@/config/business";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import {
  VEHICLE_CACHE_CONTROL,
  getVehicleReferenceService,
  vehicleReferenceCacheControl,
} from "@/server/services/vehicle-reference-service";
import { parseOptionalVehicleYear } from "@/server/validators/vehicle-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns model names for a selected make and, optionally, model year: an
 * absent or empty `year` («Не уточнять год») lists models of all years and
 * the response has `year: null`. Database catalog: models with verified
 * fitments. Preview: vPIC (reliable from 1995) merged with the regional list,
 * served from the server cache; `source` is "regional-fallback" when vPIC is
 * unavailable or has no such models.
 */
export async function GET(request: NextRequest) {
  const makeName = request.nextUrl.searchParams.get("make")?.trim() ?? "";
  const yearParameter = parseOptionalVehicleYear(
    request.nextUrl.searchParams.get("year"),
    1950,
    new Date().getUTCFullYear() + 1,
  );

  if (!makeName || makeName.length > 100) {
    return NextResponse.json(
      { ok: false, code: "INVALID_MAKE", message: "Укажите марку автомобиля." },
      { status: 422 },
    );
  }
  if (!yearParameter.valid) {
    return NextResponse.json(
      { ok: false, code: "INVALID_YEAR", message: "Укажите корректный год." },
      { status: 422 },
    );
  }
  const requestedYear = yearParameter.year;

  if (businessConfig.catalog.dataMode === "database") {
    if (!databaseIsConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          code: "FITMENT_STORAGE_NOT_CONFIGURED",
          message: "База применяемости пока не подключена.",
        },
        { status: 503, headers: { "Cache-Control": VEHICLE_CACHE_CONTROL.error } },
      );
    }
    try {
      const models = await createApplicationServices().fitmentProvider.listModels(
        makeName,
        requestedYear,
      );
      return NextResponse.json(
        {
          ok: true,
          source: "postgresql",
          make: makeName,
          year: requestedYear ?? null,
          items: sortVehicleModels(
            models.map((name) => ({ id: name.toLocaleLowerCase("ru"), name })),
          ),
        },
        { headers: { "Cache-Control": VEHICLE_CACHE_CONTROL.database } },
      );
    } catch (error) {
      applicationLogger.error({ error }, "PostgreSQL vehicle models request failed");
      return NextResponse.json(
        {
          ok: false,
          code: "FITMENT_STORAGE_UNAVAILABLE",
          message: "Модели автомобилей временно недоступны.",
        },
        { status: 503, headers: { "Cache-Control": VEHICLE_CACHE_CONTROL.error } },
      );
    }
  }

  const result = await getVehicleReferenceService(applicationLogger).getModels(
    makeName,
    requestedYear,
  );
  return NextResponse.json(
    {
      ok: true,
      source: result.source,
      make: makeName,
      year: requestedYear ?? null,
      items: result.items,
    },
    {
      headers: {
        "Cache-Control": vehicleReferenceCacheControl("models", result),
        "X-Vehicle-Cache": result.cache,
      },
    },
  );
}

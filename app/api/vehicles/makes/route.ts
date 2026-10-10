import { NextResponse } from "next/server";
import { applicationLogger } from "@/server/types/common";
import { normalizeVehicleMakeName, sortVehicleMakes } from "@/lib/vehicle-catalog";
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vehicle makes. Database catalog: makes with verified fitments. Preview:
 * passenger-car, MPV and light-truck makes from the official vPIC catalog
 * merged with brands relevant to the Russian market, served from the server
 * cache (see server/services/vehicle-reference-service.ts); `source` is
 * "regional-fallback" when vPIC is unavailable.
 */
export async function GET() {
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
      const makes = await createApplicationServices().fitmentProvider.listMakes();
      return NextResponse.json(
        {
          ok: true,
          source: "postgresql",
          items: sortVehicleMakes(
            makes.map((name) => ({ id: normalizeVehicleMakeName(name), name })),
          ),
        },
        { headers: { "Cache-Control": VEHICLE_CACHE_CONTROL.database } },
      );
    } catch (error) {
      applicationLogger.error({ error }, "PostgreSQL vehicle makes request failed");
      return NextResponse.json(
        {
          ok: false,
          code: "FITMENT_STORAGE_UNAVAILABLE",
          message: "Справочник автомобилей временно недоступен.",
        },
        { status: 503, headers: { "Cache-Control": VEHICLE_CACHE_CONTROL.error } },
      );
    }
  }

  const result = await getVehicleReferenceService(applicationLogger).getMakes();
  return NextResponse.json(
    { ok: true, source: result.source, items: result.items },
    {
      headers: {
        "Cache-Control": vehicleReferenceCacheControl("makes", result),
        "X-Vehicle-Cache": result.cache,
      },
    },
  );
}

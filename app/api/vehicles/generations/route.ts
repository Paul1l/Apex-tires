import { NextRequest, NextResponse } from "next/server";
import { applicationLogger } from "@/server/types/common";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { VEHICLE_CACHE_CONTROL } from "@/server/services/vehicle-reference-service";
import { parseOptionalVehicleYear } from "@/server/validators/vehicle-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const make = request.nextUrl.searchParams.get("make")?.trim() ?? "";
  const model = request.nextUrl.searchParams.get("model")?.trim() ?? "";
  // Absent or empty year («Не уточнять год») means generations of all years.
  const yearParameter = parseOptionalVehicleYear(request.nextUrl.searchParams.get("year"), 1900, 2200);
  if (
    !make ||
    !model ||
    make.length > 120 ||
    model.length > 160 ||
    !yearParameter.valid
  ) {
    return NextResponse.json(
      { ok: false, code: "INVALID_VEHICLE", message: "Проверьте марку, модель и год." },
      { status: 422 },
    );
  }
  if (!databaseIsConfigured()) {
    return NextResponse.json(
      { ok: false, code: "FITMENT_STORAGE_NOT_CONFIGURED", message: "База применяемости пока не подключена." },
      { status: 503, headers: { "Cache-Control": VEHICLE_CACHE_CONTROL.error } },
    );
  }
  try {
    const generations =
      await createApplicationServices().fitmentProvider.listGenerations({
        make,
        model,
        year: yearParameter.year,
      });
    return NextResponse.json(
      {
        ok: true,
        source: "postgresql",
        items: generations.map((name) => ({ id: name.toLocaleLowerCase("ru"), name })),
      },
      { headers: { "Cache-Control": VEHICLE_CACHE_CONTROL.database } },
    );
  } catch (error) {
    applicationLogger.error({ error }, "Vehicle generation lookup failed");
    return NextResponse.json(
      { ok: false, code: "FITMENT_STORAGE_UNAVAILABLE", message: "Поколения временно недоступны." },
      { status: 503, headers: { "Cache-Control": VEHICLE_CACHE_CONTROL.error } },
    );
  }
}

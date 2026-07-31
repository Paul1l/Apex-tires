import { NextRequest, NextResponse } from "next/server";
import {
  getSupplementalModelsForMake,
  normalizeVehicleMakeName,
  type VehicleModel,
} from "@/lib/vehicle-catalog";

export const dynamic = "force-dynamic";

const VPIC_API_ORIGIN = "https://vpic.nhtsa.dot.gov/api/vehicles";

interface VpicModel {
  Make_ID: number;
  Make_Name: string;
  Model_ID: number;
  Model_Name: string;
}

interface VpicResponse {
  Results?: VpicModel[];
}

function mergeVehicleModels(
  firstModels: VehicleModel[],
  secondModels: VehicleModel[],
): VehicleModel[] {
  const uniqueModels = new Map<string, VehicleModel>();
  for (const model of [...firstModels, ...secondModels]) {
    const normalizedName = model.name.trim().toLocaleLowerCase("ru");
    uniqueModels.set(normalizedName, model);
  }
  return Array.from(uniqueModels.values()).sort((firstModel, secondModel) =>
    firstModel.name.localeCompare(secondModel.name, "ru", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

/**
 * Returns model names for a selected make and model year. vPIC has its most
 * reliable coverage from 1995; regional fallback models keep Russian-market
 * brands searchable when the US catalog has no matching record.
 */
export async function GET(request: NextRequest) {
  const makeName = request.nextUrl.searchParams.get("make")?.trim() ?? "";
  const requestedYear = Number(request.nextUrl.searchParams.get("year"));
  const maximumYear = new Date().getUTCFullYear() + 1;

  if (!makeName || makeName.length > 100) {
    return NextResponse.json(
      { ok: false, code: "INVALID_MAKE", message: "Укажите марку автомобиля." },
      { status: 422 },
    );
  }
  if (
    !Number.isInteger(requestedYear) ||
    requestedYear < 1950 ||
    requestedYear > maximumYear
  ) {
    return NextResponse.json(
      { ok: false, code: "INVALID_YEAR", message: "Укажите корректный год." },
      { status: 422 },
    );
  }

  const supplementalModels = getSupplementalModelsForMake(makeName);
  const encodedMakeName = encodeURIComponent(makeName);
  const remotePath =
    requestedYear >= 1995
      ? `GetModelsForMakeYear/make/${encodedMakeName}/modelyear/${requestedYear}`
      : `GetModelsForMake/${encodedMakeName}`;

  try {
    const response = await fetch(`${VPIC_API_ORIGIN}/${remotePath}?format=json`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`vPIC models request returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as VpicResponse;
    const remoteModels = (payload.Results ?? [])
      .filter(
        (model) =>
          normalizeVehicleMakeName(model.Make_Name) ===
          normalizeVehicleMakeName(makeName),
      )
      .map((model) => ({
        id: String(model.Model_ID),
        name: model.Model_Name.trim(),
      }))
      .filter((model) => model.name);
    const models = mergeVehicleModels(supplementalModels, remoteModels);

    return NextResponse.json(
      {
        ok: true,
        source:
          remoteModels.length > 0
            ? supplementalModels.length > 0
              ? "vpic+regional"
              : "vpic"
            : "regional-fallback",
        make: makeName,
        year: requestedYear,
        items: models,
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (error) {
    console.error("Vehicle models catalog request failed", error);
    return NextResponse.json(
      {
        ok: true,
        source: "regional-fallback",
        make: makeName,
        year: requestedYear,
        items: supplementalModels,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400",
        },
      },
    );
  }
}

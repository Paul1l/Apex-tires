import { NextResponse } from "next/server";
import {
  formatVehicleMakeName,
  getSupplementalVehicleMakes,
  normalizeVehicleMakeName,
  sortVehicleMakes,
  type VehicleMake,
} from "@/lib/vehicle-catalog";
import { businessConfig } from "@/config/business";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";

export const dynamic = "force-dynamic";

const VPIC_API_ORIGIN = "https://vpic.nhtsa.dot.gov/api/vehicles";
const PASSENGER_VEHICLE_TYPES = [
  "Passenger%20Car",
  "Multipurpose%20Passenger%20Vehicle%20(MPV)",
  "Truck",
];

interface VpicMake {
  MakeId: number;
  MakeName: string;
}

interface VpicResponse {
  Results?: VpicMake[];
}

async function fetchMakesForVehicleType(
  encodedVehicleType: string,
): Promise<VpicMake[]> {
  const response = await fetch(
    `${VPIC_API_ORIGIN}/GetMakesForVehicleType/${encodedVehicleType}?format=json`,
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) {
    throw new Error(`vPIC makes request returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as VpicResponse;
  return payload.Results ?? [];
}

/**
 * Returns passenger-car, MPV and light-truck makes from the official vPIC
 * catalog, supplemented with brands relevant to the Russian market.
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
        { status: 503, headers: { "Cache-Control": "no-store" } },
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
        { headers: { "Cache-Control": "public, s-maxage=300" } },
      );
    } catch (error) {
      console.error("PostgreSQL vehicle makes request failed", error);
      return NextResponse.json(
        {
          ok: false,
          code: "FITMENT_STORAGE_UNAVAILABLE",
          message: "Справочник автомобилей временно недоступен.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const supplementalMakes = getSupplementalVehicleMakes();

  try {
    const remoteGroups = await Promise.all(
      PASSENGER_VEHICLE_TYPES.map(fetchMakesForVehicleType),
    );
    const uniqueMakes = new Map<string, VehicleMake>();

    for (const make of supplementalMakes) {
      uniqueMakes.set(normalizeVehicleMakeName(make.name), make);
    }
    for (const remoteMake of remoteGroups.flat()) {
      const normalizedName = normalizeVehicleMakeName(remoteMake.MakeName);
      uniqueMakes.set(normalizedName, {
        id: String(remoteMake.MakeId),
        name: formatVehicleMakeName(remoteMake.MakeName),
      });
    }

    return NextResponse.json(
      {
        ok: true,
        source: "vpic+regional",
        items: sortVehicleMakes(Array.from(uniqueMakes.values())),
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (error) {
    console.error("Vehicle makes catalog request failed", error);
    return NextResponse.json(
      {
        ok: true,
        source: "regional-fallback",
        items: sortVehicleMakes(supplementalMakes),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400",
        },
      },
    );
  }
}

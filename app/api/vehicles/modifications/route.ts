import { NextResponse } from "next/server";
import { createApplicationServices, databaseIsConfigured } from "@/server/bootstrap/application-services";
import { ApplicationError, toSafeError } from "@/server/utils/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!databaseIsConfigured()) return NextResponse.json({ items: [] });
    const parameters = new URL(request.url).searchParams;
    const make = parameters.get("make")?.trim();
    const model = parameters.get("model")?.trim();
    const generation = parameters.get("generation")?.trim();
    if (!make || !model || !generation || make.length > 120 || model.length > 160 || generation.length > 120) {
      throw new ApplicationError({ code: "VEHICLE_REQUIRED", message: "Выберите марку, модель и поколение.", statusCode: 422 });
    }
    const items = await createApplicationServices().fitmentProvider.listModifications({ make, model, generation });
    return NextResponse.json({ items });
  } catch (error) {
    const safe = toSafeError(error);
    return NextResponse.json(safe.body, { status: safe.statusCode });
  }
}

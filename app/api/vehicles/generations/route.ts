import { NextRequest, NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const make = request.nextUrl.searchParams.get("make")?.trim() ?? "";
  const model = request.nextUrl.searchParams.get("model")?.trim() ?? "";
  const rawYear = request.nextUrl.searchParams.get("year");
  const year = rawYear ? Number(rawYear) : undefined;
  if (
    !make ||
    !model ||
    make.length > 120 ||
    model.length > 160 ||
    (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > 2200))
  ) {
    return NextResponse.json(
      { ok: false, code: "INVALID_VEHICLE", message: "Проверьте марку, модель и год." },
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
    const generations =
      await createApplicationServices().fitmentProvider.listGenerations({
        make,
        model,
        year,
      });
    return NextResponse.json({
      ok: true,
      source: "postgresql",
      items: generations.map((name) => ({ id: name.toLocaleLowerCase("ru"), name })),
    });
  } catch (error) {
    console.error("Vehicle generation lookup failed", error);
    return NextResponse.json(
      { ok: false, code: "FITMENT_STORAGE_UNAVAILABLE", message: "Поколения временно недоступны." },
      { status: 503 },
    );
  }
}

import { NextResponse } from "next/server";
import { readYandexMetrikaCounterId } from "@/server/config/public-runtime-config";

export const dynamic = "force-dynamic";

/**
 * Returns non-secret runtime settings that client components are allowed to use.
 */
export async function GET() {
  return NextResponse.json(
    {
      yandexMetrikaCounterId: readYandexMetrikaCounterId(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

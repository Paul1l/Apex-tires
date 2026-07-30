import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "apex-wheels",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
}

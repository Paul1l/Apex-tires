import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function readYandexMetrikaCounterId(): Promise<number | null> {
  let configuredCounterId: string | undefined;

  try {
    const { env } = await getCloudflareContext({ async: true });
    configuredCounterId = (env as CloudflareEnv).YANDEX_METRIKA_COUNTER_ID;
  } catch {
    configuredCounterId = process.env.YANDEX_METRIKA_COUNTER_ID;
  }

  if (!configuredCounterId || !/^\d+$/.test(configuredCounterId)) {
    return null;
  }

  return Number(configuredCounterId);
}

/**
 * Returns non-secret runtime settings that client components are allowed to use.
 */
export async function GET() {
  return NextResponse.json(
    {
      yandexMetrikaCounterId: await readYandexMetrikaCounterId(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

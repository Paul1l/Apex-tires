import { getCloudflareContext } from "@opennextjs/cloudflare";

type PublicRuntimeVariable = "YANDEX_METRIKA_COUNTER_ID";

/**
 * Cloudflare Workers: vars/secrets come from the request context set by the
 * OpenNext worker (`next dev` gets wrangler's context from next.config.ts).
 * Node.js (`next start` on the VDS): there is no Cloudflare context and the
 * value comes from the container environment.
 *
 * Only the synchronous getCloudflareContext() is used: it reads an existing
 * context and never starts anything. The async variant must not be used in
 * code that also runs under `next start`: in the Node.js runtime it launches
 * wrangler/workerd and returns wrangler's env instead of process.env.
 */
export function readRuntimeVariable(
  name: PublicRuntimeVariable,
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  try {
    const value = (getCloudflareContext().env as unknown as Record<string, unknown>)[name];
    if (typeof value === "string" && value) return value;
  } catch {
    // No Cloudflare context: Node.js runtime.
  }
  return source[name];
}

export function readYandexMetrikaCounterId(
  source: Record<string, string | undefined> = process.env,
): number | null {
  const configuredCounterId = readRuntimeVariable("YANDEX_METRIKA_COUNTER_ID", source)?.trim();
  if (!configuredCounterId || !/^\d{1,15}$/.test(configuredCounterId)) {
    return null;
  }
  return Number(configuredCounterId);
}

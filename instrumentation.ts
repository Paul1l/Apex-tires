/**
 * Runs once when a server instance starts (`next start`, `next dev`).
 * Reports missing or invalid backend configuration (for example a database
 * build without OTP_CODE_PEPPER) in the log right away instead of letting
 * the cart and sign-in fail with 503 later. It never throws: preview builds,
 * the Cloudflare demo and `next build` (Docker image without env) keep working.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { reportRuntimeConfigurationOnce } = await import("./server/config/runtime-configuration");
    reportRuntimeConfigurationOnce();
  } catch (error) {
    console.error("[config] Не удалось проверить конфигурацию backend при старте.", error instanceof Error ? error.message : error);
  }
}

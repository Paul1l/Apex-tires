import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Reads Cloudflare bindings in production and process variables during local
 * Next.js development.
 */
export async function getAuthenticationEnvironment(): Promise<CloudflareEnv> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env as CloudflareEnv;
  } catch {
    return {
      OTP_CODE_PEPPER: process.env.OTP_CODE_PEPPER,
      YANDEX_POSTBOX_ACCESS_KEY_ID:
        process.env.YANDEX_POSTBOX_ACCESS_KEY_ID,
      YANDEX_POSTBOX_SECRET_ACCESS_KEY:
        process.env.YANDEX_POSTBOX_SECRET_ACCESS_KEY,
      YANDEX_POSTBOX_FROM_EMAIL: process.env.YANDEX_POSTBOX_FROM_EMAIL,
      YANDEX_POSTBOX_FROM_NAME: process.env.YANDEX_POSTBOX_FROM_NAME,
    } as unknown as CloudflareEnv;
  }
}

export function authenticationInfrastructureIsConfigured(
  environment: CloudflareEnv,
): environment is CloudflareEnv & {
  DB: NonNullable<CloudflareEnv["DB"]>;
  OTP_CODE_PEPPER: string;
} {
  return Boolean(environment.DB && environment.OTP_CODE_PEPPER);
}

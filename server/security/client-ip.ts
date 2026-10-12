import { isIP } from "node:net";

/**
 * Which reverse proxy is allowed to tell the application the client address.
 *
 * - `nginx`: the VDS contour. Nginx overwrites `X-Real-IP` with `$remote_addr`,
 *   so only that header is read.
 * - `cloudflare`: Cloudflare Workers. Cloudflare always overwrites
 *   `CF-Connecting-IP`, so only that header is read.
 * - `none`: no trusted proxy (local development, unknown hosting). Client
 *   headers are never trusted and the address is unknown.
 *
 * `X-Forwarded-For` is never read: its left-most value is controlled by the
 * client in every contour.
 */
export type TrustedProxyMode = "nginx" | "cloudflare" | "none";

const TRUSTED_PROXY_MODES: readonly TrustedProxyMode[] = ["nginx", "cloudflare", "none"];
const MAXIMUM_ADDRESS_LENGTH = 45;
let warnedAboutUnknownProxy = false;

export function readTrustedProxyMode(
  source: Record<string, string | undefined> = process.env,
): TrustedProxyMode {
  const value = source.TRUSTED_PROXY?.trim().toLowerCase();
  if (!value) return "none";
  if ((TRUSTED_PROXY_MODES as readonly string[]).includes(value)) {
    return value as TrustedProxyMode;
  }
  throw new Error("Некорректная конфигурация backend: TRUSTED_PROXY");
}

function normalizeAddress(value: string | null): string | null {
  if (!value) return null;
  const address = value.trim();
  // A proxy sets a single address; lists, zone identifiers and garbage are rejected.
  if (address.length === 0 || address.length > MAXIMUM_ADDRESS_LENGTH || address.includes("%")) {
    return null;
  }
  return isIP(address) ? address : null;
}

/**
 * Returns the client IP address reported by the trusted proxy, or `null` when
 * it is unknown. Never falls back to client-controlled headers.
 */
export function getClientIp(
  request: Request,
  mode: TrustedProxyMode = readTrustedProxyMode(),
): string | null {
  if (mode === "none" && process.env.NODE_ENV === "production" && !warnedAboutUnknownProxy) {
    warnedAboutUnknownProxy = true;
    console.warn(
      "TRUSTED_PROXY is not set: client IP is unknown, per-IP rate limits are disabled.",
    );
  }
  switch (mode) {
    case "nginx":
      return normalizeAddress(request.headers.get("x-real-ip"));
    case "cloudflare":
      return normalizeAddress(request.headers.get("cf-connecting-ip"));
    default:
      return null;
  }
}

function expandIpv6(address: string): number[] | null {
  let source = address.toLowerCase();
  const embeddedIpv4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(source);
  if (embeddedIpv4) {
    const octets = embeddedIpv4[1].split(".").map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    source =
      source.slice(0, -embeddedIpv4[1].length) +
      ((octets[0] << 8) | octets[1]).toString(16) +
      ":" +
      ((octets[2] << 8) | octets[3]).toString(16);
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const values = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  return values.some(Number.isNaN) ? null : values;
}

/**
 * Key for per-address rate limits. IPv6 clients usually control a whole /64,
 * so the limit is applied to the /64 prefix instead of the single address.
 * IPv4-mapped IPv6 addresses are reduced to the IPv4 address.
 */
export function clientIpRateLimitKey(address: string | null): string | null {
  if (!address) return null;
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;
  const groups = expandIpv6(address);
  if (!groups) return null;
  const isIpv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isIpv4Mapped) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

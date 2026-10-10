import { ApplicationError } from "../utils/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readAllowedOrigins(request: Request): Set<string> {
  const origins = new Set<string>();
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredSiteUrl) {
    try {
      origins.add(new URL(configuredSiteUrl).origin);
    } catch {
      // An invalid configured URL allows nothing in production (fail closed).
    }
  }
  // Without a configured site URL, and always outside production (next dev on
  // localhost / 127.0.0.1), the origin the request was addressed to is trusted.
  if (!configuredSiteUrl || process.env.NODE_ENV !== "production") {
    origins.add(new URL(request.url).origin);
  }
  return origins;
}

function rejectUntrustedOrigin(): never {
  throw new ApplicationError({
    code: "UNTRUSTED_ORIGIN",
    message: "Отправьте запрос со страницы магазина.",
    statusCode: 403,
  });
}

/**
 * CSRF guard for state-changing browser requests (cookie-authenticated or
 * anonymous storefront forms). A mutating request must prove it comes from a
 * store page: either an `Origin` equal to the store origin, or — when a
 * browser omits `Origin` — `Sec-Fetch-Site: same-origin`. Requests with
 * neither header (scripts, cross-site `text/plain` forms in old browsers) are
 * rejected.
 *
 * Not used by machine-to-machine endpoints (1C exchange, internal jobs): they
 * authenticate with keys and do not send browser headers.
 */
export function requireSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") rejectUntrustedOrigin();

  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (!readAllowedOrigins(request).has(origin)) rejectUntrustedOrigin();
    return;
  }
  if (fetchSite === "same-origin") return;
  rejectUntrustedOrigin();
}

import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function secretsAreEqual(
  expectedSecret: string | undefined,
  providedSecret: string | undefined,
): boolean {
  if (!expectedSecret || !providedSecret) return false;
  return timingSafeEqual(digest(expectedSecret), digest(providedSecret));
}

export function requestHasValidApiKey(
  request: Request,
  expectedSecret: string,
  headerName = "X-Integration-Key",
): boolean {
  return secretsAreEqual(expectedSecret, request.headers.get(headerName) ?? undefined);
}

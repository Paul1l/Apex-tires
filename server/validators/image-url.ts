import { z } from "zod";

export const MAXIMUM_IMAGE_URL_LENGTH = 2_000;

// C0 controls, DEL and backslash: browsers strip tabs/newlines inside URLs and
// treat "\" like "/", which turns "/\evil.example" into "//evil.example".
function containsUnsafeUrlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Product images may only be absolute `https:` URLs without credentials or
 * site-relative paths (`/assets/...`). Rejects `javascript:`, `data:`,
 * `file:`, `http:` and protocol-relative `//host` URLs.
 */
export function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAXIMUM_IMAGE_URL_LENGTH) return false;
  if (value !== value.trim() || containsUnsafeUrlCharacter(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.length > 0 &&
    parsed.username === "" &&
    parsed.password === ""
  );
}

/** Drops unsafe stored URLs (records saved before validation was tightened). */
export function toSafeImageUrl(value: string | null | undefined): string | null {
  return isSafeImageUrl(value) ? value : null;
}

export const productImageUrlSchema = z
  .string()
  .trim()
  .max(MAXIMUM_IMAGE_URL_LENGTH)
  .refine(isSafeImageUrl, {
    message: "Разрешены только адреса https:// или пути от корня сайта (/...).",
  });

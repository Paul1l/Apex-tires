import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238 over HOTP, RFC 4226) for the staff
 * sign-in: HMAC-SHA1, 30-second steps, 6 digits, ±1 step of clock drift.
 * These parameters are what Google Authenticator, Yandex Key and other
 * authenticator apps use by default.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accepted clock drift in steps on each side of the current step. */
export const TOTP_WINDOW_STEPS = 1;
/** 160-bit keys, the length RFC 4226 recommends for HMAC-SHA1. */
export const TOTP_SECRET_BYTES = 20;

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 without padding (the form authenticator apps accept). */
export function encodeBase32(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

/**
 * Decodes base32 typed or pasted by a person: case, spaces, hyphens and
 * trailing padding are ignored. Throws on any other character.
 */
export function decodeBase32(text: string): Buffer {
  const normalized = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalized) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value === -1) throw new Error("Invalid base32 character");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  return Buffer.from(bytes);
}

/** New random 160-bit key as raw bytes. */
export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** Number of the 30-second step that contains `timeMilliseconds`. */
export function totpTimeStep(
  timeMilliseconds: number,
  periodSeconds = TOTP_PERIOD_SECONDS,
): number {
  return Math.floor(timeMilliseconds / 1_000 / periodSeconds);
}

/** HOTP value (RFC 4226, section 5.3) for an 8-byte big-endian counter. */
export function generateHotp(
  secret: Uint8Array,
  counter: number,
  digits = TOTP_DIGITS,
  algorithm: TotpAlgorithm = "sha1",
): string {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error("HOTP counter must be a non-negative safe integer");
  }
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error("HOTP length must be 6 to 8 digits");
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** TOTP value (RFC 6238) for the step that contains `timeMilliseconds`. */
export function generateTotp(
  secret: Uint8Array,
  timeMilliseconds: number,
  options: { digits?: number; algorithm?: TotpAlgorithm; periodSeconds?: number } = {},
): string {
  return generateHotp(
    secret,
    totpTimeStep(timeMilliseconds, options.periodSeconds),
    options.digits,
    options.algorithm,
  );
}

function constantTimeCodeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  // Codes have a fixed length; the length check reveals nothing secret.
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export type TotpVerification =
  | { valid: true; step: number }
  | { valid: false; reason: "format" | "mismatch" | "replayed" };

/**
 * Checks a 6-digit code against the current step and ±`window` steps.
 * A code of `lastUsedStep` or of an earlier step is refused even when it is
 * correct, so one code cannot be used twice. Every candidate step is
 * compared in constant time, without stopping at the first match.
 */
export function verifyTotp(input: {
  secret: Uint8Array;
  code: string;
  timeMilliseconds: number;
  lastUsedStep?: number | null;
  window?: number;
}): TotpVerification {
  if (!/^\d{6}$/.test(input.code)) return { valid: false, reason: "format" };
  const window = input.window ?? TOTP_WINDOW_STEPS;
  const currentStep = totpTimeStep(input.timeMilliseconds);
  let matchedStep: number | null = null;
  for (let step = currentStep - window; step <= currentStep + window; step += 1) {
    if (step < 0) continue;
    if (constantTimeCodeEquals(generateHotp(input.secret, step), input.code)) {
      matchedStep = step;
    }
  }
  if (matchedStep === null) return { valid: false, reason: "mismatch" };
  if (input.lastUsedStep !== null && input.lastUsedStep !== undefined && matchedStep <= input.lastUsedStep) {
    return { valid: false, reason: "replayed" };
  }
  return { valid: true, step: matchedStep };
}

/**
 * Key URI for authenticator apps (Google "Key Uri Format"):
 * `otpauth://totp/<issuer>:<account>?secret=…&issuer=…`. The issuer is the
 * shop brand, the account is the staff email.
 */
export function buildOtpauthUri(input: {
  issuer: string;
  accountName: string;
  secretBase32: string;
}): string {
  // A colon inside the issuer would split the label in the wrong place.
  const issuer = input.issuer.replace(/:/g, " ").trim() || "Shop";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(input.accountName)}`;
  const parameters = new URLSearchParams({
    secret: input.secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  // URLSearchParams encodes spaces as "+", which some apps show literally.
  return `otpauth://totp/${label}?${parameters.toString().replace(/\+/g, "%20")}`;
}

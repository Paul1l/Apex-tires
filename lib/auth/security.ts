const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Creates a keyed SHA-256 digest so codes, contacts and session tokens are
 * never persisted in their original form.
 */
export async function createSecureDigest(
  secret: string,
  value: string,
): Promise<string> {
  const signingKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    textEncoder.encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}

export function generateSixDigitCode(): string {
  const randomValue = new Uint32Array(1);
  crypto.getRandomValues(randomValue);
  return String(100_000 + (randomValue[0] % 900_000));
}

export function generateOpaqueToken(byteLength = 32): string {
  const randomBytes = new Uint8Array(byteLength);
  crypto.getRandomValues(randomBytes);
  return bytesToHex(randomBytes);
}

export function constantTimeStringEquals(
  actualValue: string,
  expectedValue: string,
): boolean {
  const maximumLength = Math.max(actualValue.length, expectedValue.length);
  let difference = actualValue.length ^ expectedValue.length;

  for (let index = 0; index < maximumLength; index += 1) {
    difference |=
      (actualValue.charCodeAt(index) || 0) ^
      (expectedValue.charCodeAt(index) || 0);
  }

  return difference === 0;
}

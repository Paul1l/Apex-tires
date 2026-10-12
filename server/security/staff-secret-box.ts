import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encryption of staff authenticator keys at rest: AES-256-GCM with a key
 * derived by HKDF-SHA256 from OTP_CODE_PEPPER. A dedicated salt and info keep
 * this key independent from the HMAC uses of the same pepper (codes, session
 * tokens, rate-limit buckets).
 *
 * Stored format: `v1.<iv>.<ciphertext>.<tag>` (base64url parts). The user id
 * is authenticated data, so a key copied to another staff row does not
 * decrypt. Rotating OTP_CODE_PEPPER makes every stored key unreadable: staff
 * then need a new key (admin section or `pnpm admin:create`).
 */
const FORMAT_VERSION = "v1";
const KEY_SALT = "apex-wheels/staff-totp-secret/v1";
const KEY_INFO = "apex-wheels staff authenticator key encryption v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class StaffSecretDecryptionError extends Error {
  constructor() {
    super("Staff authenticator key cannot be decrypted");
    this.name = "StaffSecretDecryptionError";
  }
}

export function deriveStaffSecretKey(pepper: string): Buffer {
  if (pepper.length < 32) throw new Error("OTP_CODE_PEPPER is too short");
  return Buffer.from(hkdfSync("sha256", pepper, KEY_SALT, KEY_INFO, 32));
}

function associatedData(userId: string): Buffer {
  return Buffer.from(`staff-totp:${userId}`, "utf8");
}

export function encryptStaffSecret(secret: Uint8Array, key: Buffer, userId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(associatedData(userId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/** Throws StaffSecretDecryptionError on a wrong key, user id, format or any change. */
export function decryptStaffSecret(payload: string, key: Buffer, userId: string): Buffer {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) throw new StaffSecretDecryptionError();
  const [, ivText, ciphertextText, tagText] = parts;
  const iv = Buffer.from(ivText, "base64url");
  const ciphertext = Buffer.from(ciphertextText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new StaffSecretDecryptionError();
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(associatedData(userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new StaffSecretDecryptionError();
  }
}

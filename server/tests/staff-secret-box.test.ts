import assert from "node:assert/strict";
import test from "node:test";
import { buildStaffEnrollment, formatSecretForDisplay } from "../security/staff-enrollment.js";
import {
  decryptStaffSecret,
  deriveStaffSecretKey,
  encryptStaffSecret,
  StaffSecretDecryptionError,
} from "../security/staff-secret-box.js";
import { decodeBase32, generateTotpSecret } from "../security/totp.js";

const PEPPER = "p".repeat(48);
const USER_ID = "7f1c8e5e-3a3b-4f43-9d55-2d1f0c2b9a10";
const OTHER_USER_ID = "0b3e3b9a-0d39-4d67-8a0f-7c1d4b1a2e33";

function flipCharacter(text: string, index: number): string {
  const replacement = text[index] === "A" ? "B" : "A";
  return text.slice(0, index) + replacement + text.slice(index + 1);
}

test("the encryption key is derived (HKDF) and not the pepper itself", () => {
  const key = deriveStaffSecretKey(PEPPER);
  assert.equal(key.length, 32);
  assert.notDeepEqual(key, Buffer.from(PEPPER).subarray(0, 32));
  assert.deepEqual(deriveStaffSecretKey(PEPPER), key);
  assert.notDeepEqual(deriveStaffSecretKey("q".repeat(48)), key);
  assert.throws(() => deriveStaffSecretKey("short"));
});

test("authenticator keys survive an encryption round trip", () => {
  const key = deriveStaffSecretKey(PEPPER);
  const secret = generateTotpSecret();
  const stored = encryptStaffSecret(secret, key, USER_ID);
  assert.match(stored, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!stored.includes(secret.toString("base64url")), "no clear-text key in the stored value");
  assert.deepEqual(decryptStaffSecret(stored, key, USER_ID), secret);
  // A random IV: the same key encrypts differently every time.
  assert.notEqual(encryptStaffSecret(secret, key, USER_ID), stored);
});

test("any change, another user or another pepper is detected", () => {
  const key = deriveStaffSecretKey(PEPPER);
  const stored = encryptStaffSecret(generateTotpSecret(), key, USER_ID);
  const [version, iv, ciphertext, tag] = stored.split(".");

  const tampered = [
    [version, flipCharacter(iv, 1), ciphertext, tag].join("."),
    [version, iv, flipCharacter(ciphertext, 2), tag].join("."),
    [version, iv, ciphertext, flipCharacter(tag, 3)].join("."),
    [version, iv, ciphertext.slice(0, -2), tag].join("."),
    ["v2", iv, ciphertext, tag].join("."),
    [version, iv, ciphertext].join("."),
    "",
  ];
  for (const payload of tampered) {
    assert.throws(() => decryptStaffSecret(payload, key, USER_ID), StaffSecretDecryptionError);
  }
  assert.throws(() => decryptStaffSecret(stored, key, OTHER_USER_ID), StaffSecretDecryptionError);
  assert.throws(
    () => decryptStaffSecret(stored, deriveStaffSecretKey("r".repeat(48)), USER_ID),
    StaffSecretDecryptionError,
  );
});

test("enrollment holds the URI, the base32 key and an SVG QR code", () => {
  const secret = generateTotpSecret();
  const enrollment = buildStaffEnrollment({ secret, issuer: "APEX WHEELS", email: "m@shop.ru" });
  assert.deepEqual(decodeBase32(enrollment.secret), secret);
  assert.ok(enrollment.otpauthUri.includes(`secret=${enrollment.secret}`));
  assert.ok(enrollment.qrDataUrl.startsWith("data:image/svg+xml;base64,"));
  const svg = Buffer.from(enrollment.qrDataUrl.split(",")[1], "base64").toString("utf8");
  assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(!svg.includes(enrollment.secret), "the key is only encoded in the QR modules");
  assert.equal(formatSecretForDisplay("ABCDEFGHIJ"), "ABCD EFGH IJ");
});

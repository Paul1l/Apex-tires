import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOtpauthUri,
  decodeBase32,
  encodeBase32,
  generateHotp,
  generateTotp,
  generateTotpSecret,
  totpTimeStep,
  verifyTotp,
} from "../security/totp.js";

const SHA1_KEY = Buffer.from("12345678901234567890", "ascii");
const SHA256_KEY = Buffer.from("12345678901234567890123456789012", "ascii");
const SHA512_KEY = Buffer.from(
  "1234567890123456789012345678901234567890123456789012345678901234",
  "ascii",
);

test("HOTP matches RFC 4226 Appendix D", () => {
  const expected = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];
  expected.forEach((code, counter) => {
    assert.equal(generateHotp(SHA1_KEY, counter), code);
  });
});

test("TOTP matches RFC 6238 Appendix B test vectors (8 digits)", () => {
  const vectors: Array<[number, string, string, string]> = [
    // seconds, SHA1, SHA256, SHA512
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  for (const [seconds, sha1, sha256, sha512] of vectors) {
    const time = seconds * 1_000;
    assert.equal(generateTotp(SHA1_KEY, time, { digits: 8 }), sha1, `SHA1 at ${seconds}`);
    assert.equal(
      generateTotp(SHA256_KEY, time, { digits: 8, algorithm: "sha256" }),
      sha256,
      `SHA256 at ${seconds}`,
    );
    assert.equal(
      generateTotp(SHA512_KEY, time, { digits: 8, algorithm: "sha512" }),
      sha512,
      `SHA512 at ${seconds}`,
    );
  }
  // The 6-digit code used by the apps is the last six digits of the same value.
  assert.equal(generateTotp(SHA1_KEY, 59_000), "287082");
});

test("base32 follows RFC 4648 and accepts typed keys", () => {
  const vectors: Array<[string, string]> = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  for (const [plain, encoded] of vectors) {
    assert.equal(encodeBase32(Buffer.from(plain)), encoded);
    assert.equal(decodeBase32(encoded).toString(), plain);
  }
  assert.equal(decodeBase32("mzxw 6ytb-oi======").toString(), "foobar");
  assert.throws(() => decodeBase32("MZXW1"), /Invalid base32/);

  const secret = generateTotpSecret();
  assert.equal(secret.length, 20);
  assert.equal(encodeBase32(secret).length, 32);
  assert.deepEqual(decodeBase32(encodeBase32(secret)), secret);
  assert.notDeepEqual(generateTotpSecret(), secret);
});

test("a code is accepted within ±1 step and refused outside the window", () => {
  const now = 1_700_000_015_000;
  const step = totpTimeStep(now);
  const codeAt = (offset: number) => generateHotp(SHA1_KEY, step + offset);

  assert.deepEqual(verifyTotp({ secret: SHA1_KEY, code: codeAt(0), timeMilliseconds: now }), {
    valid: true,
    step,
  });
  assert.deepEqual(verifyTotp({ secret: SHA1_KEY, code: codeAt(-1), timeMilliseconds: now }), {
    valid: true,
    step: step - 1,
  });
  assert.deepEqual(verifyTotp({ secret: SHA1_KEY, code: codeAt(1), timeMilliseconds: now }), {
    valid: true,
    step: step + 1,
  });
  for (const offset of [-3, -2, 2, 3]) {
    const code = codeAt(offset);
    // Skip the rare case where an out-of-window code equals an in-window one.
    if ([-1, 0, 1].some((inWindow) => codeAt(inWindow) === code)) continue;
    assert.deepEqual(verifyTotp({ secret: SHA1_KEY, code, timeMilliseconds: now }), {
      valid: false,
      reason: "mismatch",
    });
  }
});

test("a used step and earlier steps are refused (replay)", () => {
  const now = 1_700_000_015_000;
  const step = totpTimeStep(now);
  const current = generateHotp(SHA1_KEY, step);
  const previous = generateHotp(SHA1_KEY, step - 1);
  const next = generateHotp(SHA1_KEY, step + 1);

  assert.deepEqual(
    verifyTotp({ secret: SHA1_KEY, code: current, timeMilliseconds: now, lastUsedStep: step }),
    { valid: false, reason: "replayed" },
  );
  assert.deepEqual(
    verifyTotp({ secret: SHA1_KEY, code: previous, timeMilliseconds: now, lastUsedStep: step }),
    { valid: false, reason: "replayed" },
  );
  assert.deepEqual(
    verifyTotp({ secret: SHA1_KEY, code: next, timeMilliseconds: now, lastUsedStep: step }),
    { valid: true, step: step + 1 },
  );
  assert.deepEqual(
    verifyTotp({ secret: SHA1_KEY, code: current, timeMilliseconds: now, lastUsedStep: step - 1 }),
    { valid: true, step },
  );
});

test("only six digits are checked", () => {
  for (const code of ["", "12345", "1234567", "12345a", " 123456", "１２３４５６"]) {
    assert.deepEqual(verifyTotp({ secret: SHA1_KEY, code, timeMilliseconds: 59_000 }), {
      valid: false,
      reason: "format",
    });
  }
});

test("otpauth URI follows the key URI format", () => {
  const uri = buildOtpauthUri({
    issuer: "APEX WHEELS",
    accountName: "admin@shop.ru",
    secretBase32: "JBSWY3DPEHPK3PXP",
  });
  assert.equal(
    uri,
    "otpauth://totp/APEX%20WHEELS:admin%40shop.ru?secret=JBSWY3DPEHPK3PXP&issuer=APEX%20WHEELS&algorithm=SHA1&digits=6&period=30",
  );
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "otpauth:");
  assert.equal(parsed.searchParams.get("issuer"), "APEX WHEELS");
  assert.equal(parsed.searchParams.get("secret"), "JBSWY3DPEHPK3PXP");

  const cyrillic = buildOtpauthUri({
    issuer: "Шины: Барнаул",
    accountName: "менеджер@shop.ru",
    secretBase32: "JBSWY3DPEHPK3PXP",
  });
  assert.match(cyrillic, /^otpauth:\/\/totp\/[^:]+:[^:?]+\?/);
  assert.equal(new URL(cyrillic).searchParams.get("issuer"), "Шины  Барнаул");
  assert.ok(/^[\x21-\x7e]+$/.test(cyrillic), "URI is plain ASCII");
});

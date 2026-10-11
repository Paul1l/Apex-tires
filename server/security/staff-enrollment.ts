import qrcode from "qrcode-generator";
import { buildOtpauthUri, encodeBase32 } from "./totp";

/**
 * What a new staff member needs to add the key to an authenticator app.
 * Shown once (admin dialog or console) and never stored in clear text.
 */
export interface StaffEnrollment {
  otpauthUri: string;
  /** Base32 key for manual entry. */
  secret: string;
  /** QR code of `otpauthUri` as an SVG data URL for an <img>. */
  qrDataUrl: string;
}

function createQrCode(text: string) {
  // Type 0 picks the smallest version that fits; level M survives smudges on
  // a screen photo and keeps the code small enough for phone cameras.
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  return code;
}

export function buildStaffEnrollment(input: {
  secret: Uint8Array;
  issuer: string;
  email: string;
}): StaffEnrollment {
  const secret = encodeBase32(input.secret);
  const otpauthUri = buildOtpauthUri({
    issuer: input.issuer,
    accountName: input.email,
    secretBase32: secret,
  });
  const svg = createQrCode(otpauthUri).createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  return {
    otpauthUri,
    secret,
    qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
  };
}

/** QR code for a terminal: half-height block characters, light on dark. */
export function renderEnrollmentQrAscii(otpauthUri: string): string {
  return createQrCode(otpauthUri).createASCII(1, 2);
}

/** "ABCD EFGH …" groups, easier to type into an app by hand. */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

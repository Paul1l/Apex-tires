/**
 * Image types accepted for product photos. The type is taken only from the
 * file content, never from the file name or the browser's MIME type; SVG,
 * HTML and everything else is rejected. Each type is stored and served with
 * a fixed extension and Content-Type.
 *
 * Besides the signature, the container structure is checked (no decoding,
 * no dependencies): a JPEG must be a chain of marker segments ending with
 * EOI, a PNG a chain of chunks from IHDR to a final IEND, a WebP a RIFF file
 * whose size field and chunks cover the file exactly. This refuses
 * "signature + HTML" polyglots and data appended after the image. Text inside
 * valid metadata (comments, EXIF, tEXt) is still possible in any image
 * format; it is never executed because /uploads serves a fixed image
 * Content-Type with nosniff and a sandboxing CSP.
 */
export type StoredImageType = "jpeg" | "png" | "webp";

export const STORED_IMAGE_TYPES: Record<StoredImageType, { extension: string; contentType: string; label: string }> = {
  jpeg: { extension: "jpg", contentType: "image/jpeg", label: "JPEG" },
  png: { extension: "png", contentType: "image/png", label: "PNG" },
  webp: { extension: "webp", contentType: "image/webp", label: "WebP" },
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The only valid IEND chunk: length 0, type, CRC-32 of "IEND". */
const PNG_IEND_CHUNK = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/** Frame headers (SOF0–SOF15 except DHT C4, JPG C8 and DAC CC). */
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;
/**
 * Zero bytes accepted after EOI. Some cameras and card-recovery tools pad
 * JPEG files with NUL bytes to a block size; zeros cannot carry markup, so
 * accepting them does not weaken the check. Any other trailing byte is refused.
 */
const JPEG_MAXIMUM_ZERO_PADDING = 64 * 1024;

function startsWithBytes(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  if (offset < 0 || bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + ((bytes[offset + 3] << 24) >>> 0);
}

function isRestartOrStuffing(byte: number): boolean {
  return byte === 0x00 || (byte >= 0xd0 && byte <= 0xd7);
}

/**
 * SOI, marker segments with valid lengths, a frame header before the first
 * scan, entropy-coded data, more segments/scans (progressive JPEG), and the
 * first EOI exactly at the end of the file (optionally followed by zeros).
 */
export function isWellFormedJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let end = bytes.length;
  while (end > 4 && bytes[end - 1] === 0x00 && bytes.length - end < JPEG_MAXIMUM_ZERO_PADDING) end -= 1;
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  let inScan = false;
  while (offset < end) {
    if (inScan) {
      // Entropy-coded data: 0xFF appears only as FF00 stuffing, restart
      // markers or fill bytes; any other FFxx is the next marker.
      while (offset < end - 1 && !(bytes[offset] === 0xff && !isRestartOrStuffing(bytes[offset + 1]) && bytes[offset + 1] !== 0xff)) {
        offset += 1;
      }
      inScan = false;
      if (offset >= end - 1) return false;
    }
    if (bytes[offset] !== 0xff) return false;
    while (offset < end - 2 && bytes[offset + 1] === 0xff) offset += 1; // fill bytes
    const marker = bytes[offset + 1];
    if (marker === JPEG_EOI) return sawScan && offset + 2 === end;
    if (marker === 0xd8 || marker === 0x01 || isRestartOrStuffing(marker)) return false;
    if (offset + 4 > end) return false;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > end) return false;
    if (JPEG_FRAME_MARKERS.has(marker)) sawFrame = true;
    if (marker === JPEG_SOS) {
      if (!sawFrame) return false;
      sawScan = true;
      inScan = true;
    }
    offset += 2 + length;
  }
  return false;
}

/** Signature, IHDR (13 bytes) first, chunks with valid lengths, IDAT, and IEND as the last bytes. */
export function isWellFormedPng(bytes: Uint8Array): boolean {
  if (!startsWithBytes(bytes, PNG_SIGNATURE)) return false;
  let offset = PNG_SIGNATURE.length;
  let first = true;
  let sawImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = uint32BigEndian(bytes, offset);
    const type = asciiAt(bytes, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type) || length > bytes.length - offset - 12) return false;
    if (first && (type !== "IHDR" || length !== 13)) return false;
    first = false;
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      return sawImageData && offset + 12 === bytes.length && startsWithBytes(bytes, PNG_IEND_CHUNK, offset);
    }
    offset += 12 + length;
  }
  return false;
}

/** RIFF size equal to the file length, WEBP form, VP8/VP8L/VP8X first, chunks covering the file exactly. */
export function isWellFormedWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || asciiAt(bytes, 0, 4) !== "RIFF" || asciiAt(bytes, 8, 4) !== "WEBP") return false;
  if (uint32LittleEndian(bytes, 4) + 8 !== bytes.length) return false;
  const firstChunk = asciiAt(bytes, 12, 4);
  if (firstChunk !== "VP8 " && firstChunk !== "VP8L" && firstChunk !== "VP8X") return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    if (!/^[\x20-\x7e]{4}$/.test(asciiAt(bytes, offset, 4))) return false;
    const size = uint32LittleEndian(bytes, offset + 4);
    const next = offset + 8 + size + (size % 2);
    if (next > bytes.length) return false;
    offset = next;
  }
  return offset === bytes.length;
}

/** JPEG, PNG or WebP by content and structure; null for anything else (including SVG/HTML and polyglots). */
export function detectImageType(bytes: Uint8Array): StoredImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return isWellFormedJpeg(bytes) ? "jpeg" : null;
  }
  if (startsWithBytes(bytes, PNG_SIGNATURE)) return isWellFormedPng(bytes) ? "png" : null;
  if (asciiAt(bytes, 0, 4) === "RIFF") return isWellFormedWebp(bytes) ? "webp" : null;
  return null;
}

/** Content type by stored extension (serving uploads); null for other extensions. */
export function contentTypeForExtension(extension: string): string | null {
  const match = Object.values(STORED_IMAGE_TYPES).find((type) => type.extension === extension);
  return match?.contentType ?? null;
}

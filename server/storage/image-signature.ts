/**
 * Image types accepted for product photos. The type is taken only from the
 * file content (magic bytes), never from the file name or the browser's MIME
 * type; SVG, HTML and everything else is rejected. Each type is stored and
 * served with a fixed extension and Content-Type.
 */
export type StoredImageType = "jpeg" | "png" | "webp";

export const STORED_IMAGE_TYPES: Record<StoredImageType, { extension: string; contentType: string; label: string }> = {
  jpeg: { extension: "jpg", contentType: "image/jpeg", label: "JPEG" },
  png: { extension: "png", contentType: "image/png", label: "PNG" },
  webp: { extension: "webp", contentType: "image/webp", label: "WebP" },
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWithBytes(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** JPEG, PNG or WebP by content; null for anything else (including SVG/HTML). */
export function detectImageType(bytes: Uint8Array): StoredImageType | null {
  // JPEG: SOI marker followed by the start of the next marker.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  // PNG: 8-byte signature, then the IHDR chunk must come first.
  if (startsWithBytes(bytes, PNG_SIGNATURE) && asciiAt(bytes, 12, 4) === "IHDR") return "png";
  // WebP: RIFF container of type WEBP with a VP8/VP8L/VP8X first chunk.
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") {
    const chunk = asciiAt(bytes, 12, 4);
    if (chunk === "VP8 " || chunk === "VP8L" || chunk === "VP8X") return "webp";
  }
  return null;
}

/** Content type by stored extension (serving uploads); null for other extensions. */
export function contentTypeForExtension(extension: string): string | null {
  const match = Object.values(STORED_IMAGE_TYPES).find((type) => type.extension === extension);
  return match?.contentType ?? null;
}

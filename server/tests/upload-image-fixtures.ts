/**
 * Real 2×2 images written by an encoder (Pillow 12), small enough to inline,
 * and polyglot samples built from them. Shared by the upload tests.
 */
const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));
const text = (value: string) => new TextEncoder().encode(value);
const join = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));

/** Baseline JPEG (JFIF, SOF0). */
export const JPEG = fromBase64(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2E//Z",
);
/** Progressive JPEG (SOF2, several scans and DHT segments between them) with an EXIF segment. */
export const JPEG_PROGRESSIVE = fromBase64(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4QAURXhpZgAASUkqAAgAAAAAAAAA/9sAQwAKBwcIBwYKCAgICwoKCw4YEA4NDQ4dFRYRGCMfJSQiHyIhJis3LyYpNCkhIjBBMTQ5Oz4+PiUuRElDPEg3PT47/9sAQwEKCwsODQ4cEBAcOygiKDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7/8IAEQgAAgACAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAF/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/2gAMAwEAAhADEAAAAZwFM//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//aAAwDAQACAAMAAAAQC//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Qf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Qf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Qf//Z",
);
export const PNG = fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGM8ISfHwMDAxMDAwMDAAAANBAEIfXHKZgAAAABJRU5ErkJggg==",
);
/** PNG with a tEXt chunk between IHDR and IDAT. */
export const PNG_WITH_TEXT = fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADXRFWHRDb21tZW50AHBob3RvxFiMugAAABZJREFUeJxjFGmSY2BgYGJgYGBgYAAACJAAuFX4azcAAAAASUVORK5CYII=",
);
/** Lossy WebP (VP8). */
export const WEBP = fromBase64("UklGRjoAAABXRUJQVlA4IC4AAACwAQCdASoCAAIAAUAmJaACdLoABDAAAP7x3I/4DdfFtMv/vYL/3YL/3YL/WwAA");
/** Lossless WebP (VP8L). */
export const WEBP_LOSSLESS = fromBase64("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQjyLXo/+BiOh/AAA=");
/** Extended WebP with alpha (VP8X, ALPH, VP8). */
export const WEBP_EXTENDED = fromBase64(
  "UklGRloAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgICAgABWUDggLgAAALABAJ0BKgIAAgABQCYloAJ0ugAEMAAA/vHcj/gN18W0y/+9gv/dgv/dgv9bAAA=",
);

const HTML = text("<!doctype html><html><body><script>alert(document.domain)</script></body></html>");

/** QA-26 sample: the JPEG signature followed by an HTML page. */
export const JPEG_SIGNATURE_THEN_HTML = join(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), HTML);

/** Polyglots that must be refused: valid starts, HTML in the middle or at the end. */
export const POLYGLOTS: ReadonlyArray<readonly [string, Uint8Array]> = [
  ["JPEG signature + HTML", JPEG_SIGNATURE_THEN_HTML],
  ["JPEG signature + HTML + EOI", join(JPEG_SIGNATURE_THEN_HTML, new Uint8Array([0xff, 0xd9]))],
  ["JPEG + HTML after EOI", join(JPEG, HTML)],
  ["JPEG + HTML + another EOI", join(JPEG, HTML, new Uint8Array([0xff, 0xd9]))],
  ["JPEG without EOI", JPEG.subarray(0, JPEG.length - 2)],
  ["JPEG + NUL padding + HTML", join(JPEG, new Uint8Array(16), HTML)],
  ["PNG + HTML after IEND", join(PNG, HTML)],
  ["PNG without IEND", PNG.subarray(0, PNG.length - 12)],
  ["PNG signature + HTML", join(PNG.subarray(0, 8), HTML)],
  ["PNG with HTML instead of the first chunk", join(PNG.subarray(0, 8), new Uint8Array([0, 0, 0, 13]), text("IHDX"), HTML)],
  ["PNG with HTML between chunks", join(PNG.subarray(0, 33), HTML, PNG.subarray(33))],
  ["WebP + HTML (RIFF size unchanged)", join(WEBP, HTML)],
  ["WebP header + HTML", join(WEBP.subarray(0, 16), HTML)],
  ["WebP truncated", WEBP.subarray(0, WEBP.length - 4)],
];

/** Builds a polyglot whose RIFF size claims the appended HTML as a chunk of garbage. */
export function webpWithForgedSize(): Uint8Array {
  const forged = join(WEBP, HTML);
  Buffer.from(forged.buffer, forged.byteOffset, forged.byteLength).writeUInt32LE(forged.length - 8, 4);
  return forged;
}

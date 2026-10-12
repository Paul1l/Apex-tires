import { contentTypeForExtension, STORED_IMAGE_TYPES, type StoredImageType } from "./image-signature";

/**
 * Names of files the site stores itself. Only these keys are ever written,
 * served or deleted:
 *   products/<product UUID, lower case>/<32 hex characters>.<jpg|png|webp>
 * Anything else (other folders, "..", encoded separators, NUL, upper case,
 * other extensions) is not ours and is refused before touching the disk.
 */
const PRODUCT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STORED_FILE_PATTERN = /^[0-9a-f]{32}\.(jpg|png|webp)$/;

export const PUBLIC_UPLOADS_PREFIX = "/uploads/";

export interface StoredFileKey {
  /** Relative to UPLOADS_DIR, always with "/" separators. */
  storageKey: string;
  productId: string;
  fileName: string;
  contentType: string;
}

export function storedImageFileName(type: StoredImageType, randomHex: string): string {
  if (!/^[0-9a-f]{32}$/.test(randomHex)) throw new Error("Random file name must be 32 hex characters");
  return `${randomHex}.${STORED_IMAGE_TYPES[type].extension}`;
}

export function productImageStorageKey(productId: string, fileName: string): string {
  const parsed = parseStorageKey(`products/${productId}/${fileName}`);
  if (!parsed) throw new Error("Invalid product image storage key");
  return parsed.storageKey;
}

export function publicUploadUrl(storageKey: string): string {
  return `${PUBLIC_UPLOADS_PREFIX}${storageKey}`;
}

/** Validates the segments of /uploads/[...path] (or a stored key split by "/"). */
export function parseUploadSegments(segments: readonly string[]): StoredFileKey | null {
  if (segments.length !== 3) return null;
  const [folder, productId, fileName] = segments;
  if (folder !== "products") return null;
  if (typeof productId !== "string" || !PRODUCT_ID_PATTERN.test(productId)) return null;
  if (typeof fileName !== "string" || !STORED_FILE_PATTERN.test(fileName)) return null;
  const contentType = contentTypeForExtension(fileName.slice(fileName.lastIndexOf(".") + 1));
  if (!contentType) return null;
  return { storageKey: `products/${productId}/${fileName}`, productId, fileName, contentType };
}

export function parseStorageKey(storageKey: string | null | undefined): StoredFileKey | null {
  if (typeof storageKey !== "string" || storageKey.length > 200) return null;
  return parseUploadSegments(storageKey.split("/"));
}

/** True only for a file this site stored for exactly this product. */
export function isOwnProductImageKey(productId: string, storageKey: string | null | undefined): boolean {
  const parsed = parseStorageKey(storageKey);
  return parsed !== null && parsed.productId === productId.toLowerCase();
}

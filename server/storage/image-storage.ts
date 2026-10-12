import type { AdminUploadSettings } from "../../lib/admin/product-types";
import type { UploadEnvironment } from "../config/environment";
import type { StoredImageType } from "./image-signature";

export interface SavedImage {
  /** Relative key stored in product_images.storage_key. */
  storageKey: string;
  /** Public URL stored in product_images.url (/uploads/...). */
  url: string;
}

export interface ReadImage {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Where uploaded photos live. Today: a local directory (UPLOADS_DIR, a
 * Docker volume on the VDS). An S3-compatible store can implement the same
 * three methods later without changing the services and routes.
 */
export interface ImageStorage {
  save(productId: string, bytes: Uint8Array, type: StoredImageType): Promise<SavedImage>;
  /** Deletes a file this site stored; false when the key is not ours or the file is gone. */
  remove(storageKey: string): Promise<boolean>;
  /** Reads a stored file for /uploads; null when the key is not ours or the file is missing. */
  read(storageKey: string): Promise<ReadImage | null>;
}

/**
 * Storage for the configured UPLOADS_DIR, or null when uploads are disabled.
 * The file-system code is imported lazily: modules that only import this one
 * stay free of node:fs at load time (the Cloudflare worker build).
 */
export async function createImageStorage(environment: UploadEnvironment): Promise<ImageStorage | null> {
  if (!environment.uploadsDirectory) return null;
  const { LocalImageStorage } = await import("./local-image-storage");
  return new LocalImageStorage(environment.uploadsDirectory);
}

/** Upload state shown in the editor (limits and why uploads are off). */
export function describeUploadSettings(environment: UploadEnvironment): AdminUploadSettings {
  return {
    enabled: environment.uploadsDirectory !== null,
    reason: environment.uploadsDirectory
      ? null
      : environment.problem ??
        "Загрузка фото отключена: на сервере не задан каталог для файлов (UPLOADS_DIR). Можно добавить фото по ссылке https://.",
    maxBytes: environment.productImageMaxBytes,
    maxImages: environment.productImageMaxCount,
  };
}

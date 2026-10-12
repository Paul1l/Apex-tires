import type { ImageStorage, ReadImage, SavedImage } from "./image-storage";
import type { StoredImageType } from "./image-signature";
import {
  parseStorageKey,
  productImageStorageKey,
  publicUploadUrl,
  storedImageFileName,
  type StoredFileKey,
} from "./upload-path";

/** Files larger than this are never served, whatever the current upload limit. */
const MAXIMUM_SERVED_FILE_BYTES = 25 * 1024 * 1024;

function isMissingFile(error: unknown): boolean {
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

/**
 * Local directory storage (UPLOADS_DIR). Paths are built only from validated
 * keys (see upload-path.ts) and checked again after resolving symbolic links:
 * the real path must stay inside the real UPLOADS_DIR. Final symbolic links
 * are never followed when reading or deleting. node:fs is imported lazily.
 */
export class LocalImageStorage implements ImageStorage {
  constructor(private readonly rootDirectory: string) {}

  private async resolveRoot(): Promise<string> {
    const { realpath, stat } = await import("node:fs/promises");
    const root = await realpath(this.rootDirectory);
    if (!(await stat(root)).isDirectory()) throw new Error("UPLOADS_DIR is not a directory");
    return root;
  }

  private static async isInside(root: string, candidate: string): Promise<boolean> {
    const path = await import("node:path");
    const relative = path.relative(root, candidate);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  /** Absolute path of a validated key, refused if its real location leaves the root. */
  private async resolveExisting(key: StoredFileKey): Promise<string | null> {
    const { lstat, realpath } = await import("node:fs/promises");
    const path = await import("node:path");
    const root = await this.resolveRoot();
    const candidate = path.join(root, "products", key.productId, key.fileName);
    try {
      if (!(await lstat(candidate)).isFile()) return null;
      const real = await realpath(candidate);
      return (await LocalImageStorage.isInside(root, real)) ? real : null;
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async save(productId: string, bytes: Uint8Array, type: StoredImageType): Promise<SavedImage> {
    const { mkdir, realpath, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { randomBytes } = await import("node:crypto");
    const root = await this.resolveRoot();
    const fileName = storedImageFileName(type, randomBytes(16).toString("hex"));
    const storageKey = productImageStorageKey(productId, fileName);
    const directory = path.join(root, "products", productId);
    await mkdir(directory, { recursive: true, mode: 0o750 });
    const realDirectory = await realpath(directory);
    if (!(await LocalImageStorage.isInside(root, realDirectory))) {
      throw new Error("Product upload directory resolves outside UPLOADS_DIR");
    }
    // "wx": never overwrite an existing file (random names make it unlikely).
    await writeFile(path.join(realDirectory, fileName), bytes, { flag: "wx", mode: 0o640 });
    return { storageKey, url: publicUploadUrl(storageKey) };
  }

  async remove(storageKey: string): Promise<boolean> {
    const key = parseStorageKey(storageKey);
    if (!key) return false;
    const filePath = await this.resolveExisting(key);
    if (!filePath) return false;
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }

  async read(storageKey: string): Promise<ReadImage | null> {
    const key = parseStorageKey(storageKey);
    if (!key) return null;
    const filePath = await this.resolveExisting(key);
    if (!filePath) return null;
    const { open } = await import("node:fs/promises");
    const { constants } = await import("node:fs");
    let handle;
    try {
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    try {
      const details = await handle.stat();
      if (!details.isFile() || details.size > MAXIMUM_SERVED_FILE_BYTES) return null;
      const bytes = new Uint8Array(await handle.readFile());
      return { bytes, contentType: key.contentType };
    } finally {
      await handle.close();
    }
  }
}

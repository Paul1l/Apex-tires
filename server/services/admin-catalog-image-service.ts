import type { PoolClient } from "pg";
import type { AdminProductImage } from "../../lib/admin/product-types";
import type { UploadEnvironment } from "../config/environment";
import { withTransaction } from "../database/postgres-client";
import type { StoredImageRow } from "../repositories/admin-catalog-product-repository";
import { createImageStorage, type ImageStorage, type SavedImage } from "../storage/image-storage";
import type { ImageUpload } from "../storage/image-upload-request";
import { isOwnProductImageKey } from "../storage/upload-path";
import { applicationLogger } from "../types/common";
import { ApplicationError } from "../utils/errors";
import type { AddImageUrlInput, UpdateImagesInput } from "../validators/admin-product-schema";
import { isImageLocked, isOneCProduct } from "./admin-catalog-rules";
import {
  mapEditorImage,
  productNotFound,
  type AdminCatalogDependencies,
} from "./admin-catalog-product-service";

/**
 * Photos added on the site to a 1C product go after the 1C photos
 * (1C positions are 0–100), so the exchange keeps the main photo.
 */
export const ONE_C_PRODUCT_MANUAL_IMAGE_POSITION = 1_000;

export interface ImageChangeResult {
  product: { id: string; kind: "tire" | "wheel"; slug: string };
  images: AdminProductImage[];
}

export interface AdminCatalogImageDependencies extends AdminCatalogDependencies {
  createStorage?: (environment: UploadEnvironment) => Promise<ImageStorage | null>;
}

function firstFreePosition(productSource: string, images: readonly StoredImageRow[]): number {
  const base = isOneCProduct(productSource) ? ONE_C_PRODUCT_MANUAL_IMAGE_POSITION : 0;
  return Math.max(base, ...images.map((image) => image.position + 1));
}

export function uploadsNotConfigured(environment: UploadEnvironment): ApplicationError {
  return new ApplicationError({
    code: "UPLOADS_NOT_CONFIGURED",
    message:
      environment.problem ??
      "Загрузка фото отключена: на сервере не задан каталог для файлов (UPLOADS_DIR). Добавьте фото по ссылке https:// или обратитесь к администратору сервера.",
    statusCode: 503,
  });
}

export class AdminCatalogImageService {
  constructor(private readonly dependencies: AdminCatalogImageDependencies) {}

  private createStorage(environment: UploadEnvironment): Promise<ImageStorage | null> {
    return (this.dependencies.createStorage ?? createImageStorage)(environment);
  }

  /** Configured storage and limits; throws UPLOADS_NOT_CONFIGURED when uploads are off. */
  async requireUploads(): Promise<{ storage: ImageStorage; environment: UploadEnvironment }> {
    const environment = this.dependencies.uploadEnvironment();
    const storage = await this.createStorage(environment);
    if (!storage) throw uploadsNotConfigured(environment);
    return { storage, environment };
  }

  private async lockProduct(database: PoolClient, productId: string) {
    const product = await this.dependencies.products.lockProduct(database, productId);
    if (!product) throw productNotFound();
    return product;
  }

  private async result(database: PoolClient, product: { id: string; kind: "tire" | "wheel"; slug: string; source_system: string }): Promise<ImageChangeResult> {
    const images = await this.dependencies.products.listImages(database, product.id);
    return {
      product: { id: product.id, kind: product.kind, slug: product.slug },
      images: images.map((image) => mapEditorImage(product.source_system, image, product.id)),
    };
  }

  private assertBelowLimit(images: readonly StoredImageRow[], maximum: number): void {
    if (images.length >= maximum) {
      throw new ApplicationError({
        code: "IMAGE_LIMIT_REACHED",
        message: `У товара уже ${images.length} фото — это максимум (${maximum}). Удалите лишние фото и повторите.`,
        statusCode: 409,
      });
    }
  }

  /** Saves an uploaded file and its record; the file is removed again if the record is not saved. */
  async addUploadedImage(
    actorUserId: string,
    productId: string,
    upload: ImageUpload,
    storage: ImageStorage,
    maximumImages: number,
  ): Promise<ImageChangeResult> {
    let saved: SavedImage | null = null;
    try {
      return await withTransaction(this.dependencies.pool, async (database) => {
        const product = await this.lockProduct(database, productId);
        const images = await this.dependencies.products.listImages(database, productId);
        this.assertBelowLimit(images, maximumImages);
        saved = await storage.save(productId, upload.bytes, upload.type);
        const imageId = await this.dependencies.products.insertImage(database, {
          productId,
          url: saved.url,
          storageKey: saved.storageKey,
          alt: upload.alt,
          position: firstFreePosition(product.source_system, images),
        });
        await this.dependencies.audit.record(database, {
          actorUserId,
          action: "catalog.product.image_uploaded",
          entityType: "products",
          entityId: productId,
          details: { imageId, storageKey: saved.storageKey, type: upload.type, bytes: upload.bytes.byteLength },
        });
        return this.result(database, product);
      });
    } catch (error) {
      const orphan = saved as SavedImage | null;
      if (orphan) {
        await storage.remove(orphan.storageKey).catch((removeError: unknown) => {
          applicationLogger.warn({ error: removeError }, "Uploaded product photo could not be removed after a failed save");
        });
      }
      throw error;
    }
  }

  async addImageByUrl(
    actorUserId: string,
    productId: string,
    input: AddImageUrlInput,
  ): Promise<ImageChangeResult> {
    const maximumImages = this.dependencies.uploadEnvironment().productImageMaxCount;
    return withTransaction(this.dependencies.pool, async (database) => {
      const product = await this.lockProduct(database, productId);
      const images = await this.dependencies.products.listImages(database, productId);
      this.assertBelowLimit(images, maximumImages);
      const imageId = await this.dependencies.products.insertImage(database, {
        productId,
        url: input.url,
        storageKey: null,
        alt: input.alt,
        position: firstFreePosition(product.source_system, images),
      });
      await this.dependencies.audit.record(database, {
        actorUserId,
        action: "catalog.product.image_linked",
        entityType: "products",
        entityId: productId,
        details: { imageId },
      });
      return this.result(database, product);
    });
  }

  /** New order (first = main photo) and alt texts of the editable photos. */
  async updateImages(actorUserId: string, productId: string, input: UpdateImagesInput): Promise<ImageChangeResult> {
    return withTransaction(this.dependencies.pool, async (database) => {
      const product = await this.lockProduct(database, productId);
      const images = await this.dependencies.products.listImages(database, productId);
      const editable = images.filter((image) => !isImageLocked(product.source_system, image.source_system));
      const requested = new Set(input.images.map((image) => image.id));
      if (editable.length !== requested.size || editable.some((image) => !requested.has(image.id))) {
        throw new ApplicationError({
          code: "IMAGE_LIST_CHANGED",
          message: "Список фото изменился (фото добавили или удалили). Обновите страницу и повторите.",
          statusCode: 409,
        });
      }
      const base = isOneCProduct(product.source_system) ? ONE_C_PRODUCT_MANUAL_IMAGE_POSITION : 0;
      for (const [index, image] of input.images.entries()) {
        await this.dependencies.products.updateImage(database, productId, { id: image.id, alt: image.alt, position: base + index });
      }
      await this.dependencies.audit.record(database, {
        actorUserId,
        action: "catalog.product.images_updated",
        entityType: "products",
        entityId: productId,
        details: { order: input.images.map((image) => image.id) },
      });
      return this.result(database, product);
    });
  }

  /**
   * Deletes the record; the file is deleted only when the site stored it for
   * this product (storage_key products/<id>/<random>.<ext>). Links to other
   * sites and files of 1C/CSV are never touched.
   */
  async deleteImage(actorUserId: string, productId: string, imageId: string): Promise<ImageChangeResult> {
    let storageKey: string | null = null;
    const result = await withTransaction(this.dependencies.pool, async (database) => {
      const product = await this.lockProduct(database, productId);
      const images = await this.dependencies.products.listImages(database, productId);
      const image = images.find((candidate) => candidate.id === imageId);
      if (!image) {
        throw new ApplicationError({ code: "IMAGE_NOT_FOUND", message: "Фото не найдено. Обновите страницу.", statusCode: 404 });
      }
      if (isImageLocked(product.source_system, image.source_system)) {
        throw new ApplicationError({
          code: "PRODUCT_SOURCE_CONFLICT",
          message: "Это фото пришло из 1С и меняется только в учётной системе.",
          statusCode: 409,
        });
      }
      await this.dependencies.products.deleteImage(database, productId, imageId);
      const ownFile = isOwnProductImageKey(productId, image.storage_key);
      if (ownFile) storageKey = image.storage_key;
      await this.dependencies.audit.record(database, {
        actorUserId,
        action: "catalog.product.image_deleted",
        entityType: "products",
        entityId: productId,
        details: { imageId, storageKey: ownFile ? image.storage_key : null },
      });
      return this.result(database, product);
    });
    const fileKey = storageKey as string | null;
    if (fileKey) {
      const storage = await this.createStorage(this.dependencies.uploadEnvironment());
      if (!storage) {
        applicationLogger.warn({ productId }, "Product photo record deleted while uploads are disabled; the file was left in place");
      } else {
        await storage.remove(fileKey).catch((error: unknown) => {
          applicationLogger.warn({ error, productId }, "Deleted product photo file could not be removed");
        });
      }
    }
    return result;
  }
}

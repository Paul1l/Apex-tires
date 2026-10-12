import type { Pool, PoolClient } from "pg";
import type {
  AdminProductCard,
  AdminProductEditorData,
  AdminProductImage,
  AdminProductListResponse,
} from "../../lib/admin/product-types";
import { storefrontProductPath } from "../cache/storefront-revalidation";
import type { UploadEnvironment } from "../config/environment";
import { withTransaction } from "../database/postgres-client";
import type { AdminAuditRepository } from "../repositories/admin-audit-repository";
import {
  mapEditorCard,
  type AdminCatalogProductRepository,
  type EditorProductRow,
  type StoredImageRow,
} from "../repositories/admin-catalog-product-repository";
import type { AdminCatalogReferenceRepository } from "../repositories/admin-catalog-reference-repository";
import { describeUploadSettings } from "../storage/image-storage";
import { isOwnProductImageKey } from "../storage/upload-path";
import type { JsonValue } from "../types/common";
import { ApplicationError } from "../utils/errors";
import { createProductSlug } from "../utils/product-slug";
import { toSafeImageUrl } from "../validators/image-url";
import type {
  AdminProductListQuery,
  CreateProductInput,
  UpdateProductInput,
} from "../validators/admin-product-schema";
import {
  assertSourceAllowsChanges,
  changedCardFields,
  formatWheelPcd,
  isImageLocked,
  lockedFieldsForSource,
  normalizeCardForKind,
  planStockChanges,
  priceChanged,
  throwValidationIssues,
  validateCompleteCard,
} from "./admin-catalog-rules";

export interface AdminCatalogDependencies {
  pool: Pool;
  products: AdminCatalogProductRepository;
  references: AdminCatalogReferenceRepository;
  audit: AdminAuditRepository;
  uploadEnvironment: () => UploadEnvironment;
}

/** Product identity the storefront cache reset needs after a change. */
export interface ChangedProduct {
  id: string;
  kind: "tire" | "wheel";
  slug: string;
  version: string;
}

export function productNotFound(): ApplicationError {
  return new ApplicationError({
    code: "PRODUCT_NOT_FOUND",
    message: "Товар не найден. Обновите список товаров.",
    statusCode: 404,
  });
}

function databaseCode(error: unknown, key: "code" | "constraint"): string | undefined {
  const value = error instanceof Error ? Reflect.get(error, key) : undefined;
  return typeof value === "string" ? value : undefined;
}

function skuConflict(sku: string): ApplicationError {
  return new ApplicationError({
    code: "SKU_CONFLICT",
    message: `Товар с SKU «${sku}» уже есть в каталоге. Укажите другой SKU.`,
    statusCode: 409,
    details: [{ field: "card.sku", message: "Такой SKU уже занят." }],
  });
}

/** Constraint errors a concurrent save can still hit after the checks. */
function translateDatabaseError(error: unknown, sku: string): unknown {
  const code = databaseCode(error, "code");
  const constraint = databaseCode(error, "constraint");
  if (code === "23505" && constraint === "products_sku_key") return skuConflict(sku);
  if (code === "23514" && constraint?.startsWith("inventories")) {
    return new ApplicationError({
      code: "STOCK_BELOW_RESERVED",
      message: "Остаток не может быть меньше резерва. Обновите страницу: резерв мог измениться.",
      statusCode: 422,
    });
  }
  return error;
}

export function mapEditorImage(productSource: string, image: StoredImageRow, productId: string): AdminProductImage {
  return {
    id: image.id,
    url: toSafeImageUrl(image.url) ?? "",
    alt: image.alt,
    position: image.position,
    source: image.source_system,
    stored: isOwnProductImageKey(productId, image.storage_key),
    locked: isImageLocked(productSource, image.source_system),
  };
}

function pcdText(card: AdminProductCard, stored: string | null, wheelSizeChanged: boolean): string | null {
  if (card.kind === "tire" || card.boltCount === null || card.pcd === null) return null;
  return wheelSizeChanged || !stored ? formatWheelPcd(card.boltCount, card.pcd) : stored;
}

export class AdminCatalogProductService {
  constructor(private readonly dependencies: AdminCatalogDependencies) {}

  async list(query: AdminProductListQuery): Promise<AdminProductListResponse> {
    const { items, total } = await this.dependencies.products.listProducts(this.dependencies.pool, query);
    return {
      ok: true,
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
        hasNextPage: query.page * query.pageSize < total,
      },
    };
  }

  async getEditorData(productId: string): Promise<AdminProductEditorData | null> {
    const { pool, products } = this.dependencies;
    const row = await products.findEditorProduct(pool, productId);
    if (!row) return null;
    const [price, stock, images] = await Promise.all([
      products.findRetailPrice(pool, productId),
      products.listStock(pool, productId),
      products.listImages(pool, productId),
    ]);
    return {
      id: row.id,
      slug: row.slug,
      source: row.source_system,
      externalId: row.external_id,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      card: normalizeCardForKind(mapEditorCard(row)),
      brandName: row.brand,
      categoryName: row.category,
      price,
      stock,
      images: images.map((image) => mapEditorImage(row.source_system, image, row.id)),
      lockedFields: lockedFieldsForSource(row.source_system),
      publicPath: storefrontProductPath(row),
      uploads: describeUploadSettings(this.dependencies.uploadEnvironment()),
    };
  }

  private async requireBrand(database: PoolClient, brandId: string | null) {
    const brand = brandId ? await this.dependencies.references.findBrand(database, brandId, { lock: true }) : null;
    if (!brand || !brand.isActive) {
      throw new ApplicationError({
        code: "BRAND_UNAVAILABLE",
        message: "Выбранный бренд не найден или отключён. Выберите другой бренд.",
        statusCode: 422,
        details: [{ field: "card.brandId", message: "Бренд недоступен." }],
      });
    }
    return brand;
  }

  private async findCategory(database: PoolClient, categoryId: string | null) {
    if (!categoryId) return null;
    const category = await this.dependencies.references.findCategory(database, categoryId, { lock: true });
    if (!category || !category.isActive) {
      throw new ApplicationError({
        code: "CATEGORY_UNAVAILABLE",
        message: "Выбранная категория не найдена или отключена.",
        statusCode: 422,
        details: [{ field: "card.categoryId", message: "Категория недоступна." }],
      });
    }
    return category;
  }

  private async assertSkuIsFree(database: PoolClient, sku: string, productId: string | null): Promise<void> {
    const existing = await this.dependencies.products.findProductBySku(database, sku, productId);
    if (existing !== null) throw skuConflict(existing);
  }

  private async uniqueSlug(database: PoolClient, name: string, sku: string): Promise<string> {
    const base = createProductSlug(name, sku);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const candidate = attempt === 1 ? base : `${base}-${attempt}`;
      if (!(await this.dependencies.products.slugExists(database, candidate))) return candidate;
    }
    const { randomBytes } = await import("node:crypto");
    return `${base}-${randomBytes(4).toString("hex")}`;
  }

  async create(actorUserId: string, input: CreateProductInput): Promise<ChangedProduct> {
    const card = normalizeCardForKind(input.card);
    throwValidationIssues(validateCompleteCard(card));
    const { pool, products, audit } = this.dependencies;
    try {
      return await withTransaction(pool, async (database) => {
        const brand = await this.requireBrand(database, card.brandId);
        const category = await this.findCategory(database, card.categoryId);
        await this.assertSkuIsFree(database, card.sku, null);
        const slug = await this.uniqueSlug(database, card.name, card.sku);
        const created = await products.insertProduct(database, card, {
          brandName: brand.name,
          categoryName: category?.name ?? "",
          pcdText: pcdText(card, null, true),
        }, slug);
        await products.saveSpecs(database, created.id, card);
        if (input.price) await products.saveRetailPrice(database, created.id, input.price);
        const stockChanges = input.stock?.length
          ? planStockChanges(await products.listStock(database, created.id, { lock: true }), input.stock)
          : [];
        for (const change of stockChanges) {
          await products.setStockQuantity(database, created.id, change.warehouseId, change.to);
        }
        await audit.record(database, {
          actorUserId,
          action: "catalog.product.created",
          entityType: "products",
          entityId: created.id,
          details: {
            sku: card.sku,
            kind: card.kind,
            isActive: card.isActive,
            priceKopecks: input.price?.amountKopecks ?? null,
            stock: stockChanges.map((change) => ({ warehouseId: change.warehouseId, quantity: change.to })),
          },
        });
        return { id: created.id, kind: card.kind, slug, version: created.version };
      });
    } catch (error) {
      throw translateDatabaseError(error, card.sku);
    }
  }

  async update(actorUserId: string, productId: string, input: UpdateProductInput): Promise<ChangedProduct & { changed: boolean }> {
    const { pool, products, audit } = this.dependencies;
    try {
      return await withTransaction(pool, async (database) => {
        const row = await products.findEditorProduct(database, productId, { lock: true });
        if (!row) throw productNotFound();
        if (row.version !== input.version) {
          throw new ApplicationError({
            code: "PRODUCT_VERSION_CONFLICT",
            message:
              "Товар изменили после того, как вы открыли форму (другой сотрудник, импорт или обмен с 1С). Загрузите актуальные данные и внесите правки снова.",
            statusCode: 409,
          });
        }
        const current = normalizeCardForKind(mapEditorCard(row));
        const patch = Object.fromEntries(
          Object.entries(input.card ?? {}).filter(([, value]) => value !== undefined),
        ) as Partial<AdminProductCard>;
        const next = normalizeCardForKind({ ...current, ...patch, kind: current.kind });
        const cardFields = changedCardFields(current, next);
        const currentPrice = await products.findRetailPrice(database, productId);
        const priceIsChanged = priceChanged(currentPrice, input.price);
        const stockRows = await products.listStock(database, productId, { lock: true });
        const stockIsChanged = (input.stock ?? []).some(
          (requested) => stockRows.find((row) => row.warehouseId === requested.warehouseId)?.quantity !== requested.quantity,
        );
        assertSourceAllowsChanges(row.source_system, {
          cardFields,
          price: priceIsChanged,
          stock: stockIsChanged,
        });
        if (cardFields.length === 0 && !priceIsChanged && !stockIsChanged) {
          return { id: row.id, kind: row.kind, slug: row.slug, version: row.version, changed: false };
        }
        if (cardFields.length > 0) await this.saveCard(database, row, next, cardFields);
        if (priceIsChanged && input.price) await products.saveRetailPrice(database, productId, input.price);
        const stockChanges = planStockChanges(stockRows, input.stock);
        for (const change of stockChanges) {
          await products.setStockQuantity(database, productId, change.warehouseId, change.to);
        }
        const version = await products.touchProduct(database, productId);
        const details: Record<string, JsonValue> = { changedFields: cardFields };
        if (priceIsChanged && input.price) {
          details.price = {
            from: currentPrice?.amountKopecks ?? null,
            to: input.price.amountKopecks,
            oldFrom: currentPrice?.oldAmountKopecks ?? null,
            oldTo: input.price.oldAmountKopecks,
          };
        }
        if (stockChanges.length > 0) {
          details.stock = stockChanges.map((change) => ({ warehouseId: change.warehouseId, from: change.from, to: change.to }));
        }
        await audit.record(database, {
          actorUserId,
          action: "catalog.product.updated",
          entityType: "products",
          entityId: productId,
          details,
        });
        return { id: row.id, kind: row.kind, slug: row.slug, version, changed: true };
      });
    } catch (error) {
      throw translateDatabaseError(error, input.card?.sku ?? "");
    }
  }

  private async saveCard(
    database: PoolClient,
    row: EditorProductRow,
    card: AdminProductCard,
    changedFields: readonly string[],
  ): Promise<void> {
    throwValidationIssues(validateCompleteCard(card));
    const changed = new Set(changedFields);
    const brandName = changed.has("brandId") ? (await this.requireBrand(database, card.brandId)).name : row.brand;
    const categoryName = changed.has("categoryId")
      ? (await this.findCategory(database, card.categoryId))?.name ?? ""
      : row.category;
    if (changed.has("sku")) await this.assertSkuIsFree(database, card.sku, row.id);
    const wheelSizeChanged = changed.has("boltCount") || changed.has("pcd");
    await this.dependencies.products.updateProduct(database, row.id, card, {
      brandName,
      categoryName,
      pcdText: pcdText(card, row.pcd, wheelSizeChanged),
    });
    await this.dependencies.products.saveSpecs(database, row.id, card);
  }
}

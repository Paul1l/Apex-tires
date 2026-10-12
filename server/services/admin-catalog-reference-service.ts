import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { AdminBrand, AdminCategory, AdminWarehouse } from "../../lib/admin/product-types";
import { withTransaction } from "../database/postgres-client";
import type { AdminAuditRepository } from "../repositories/admin-audit-repository";
import type { AdminCatalogReferenceRepository } from "../repositories/admin-catalog-reference-repository";
import { ApplicationError } from "../utils/errors";
import { createEntitySlug } from "../utils/product-slug";

/**
 * Brand slug as the 1C/CSV import creates it (ProductRepository.
 * upsertFromExternalSystem), so an imported brand of the same name reuses the
 * row created in the admin.
 */
export function brandSlug(name: string): string {
  return `brand-${createHash("sha256").update(name.toLocaleLowerCase("ru")).digest("hex").slice(0, 16)}`;
}

export interface AdminCatalogReferenceDependencies {
  pool: Pool;
  references: AdminCatalogReferenceRepository;
  audit: AdminAuditRepository;
}

/** Brands, categories (list and create; nothing is deleted) and warehouses (read). */
export class AdminCatalogReferenceService {
  constructor(private readonly dependencies: AdminCatalogReferenceDependencies) {}

  listBrands(): Promise<AdminBrand[]> {
    return this.dependencies.references.listBrands(this.dependencies.pool);
  }

  listCategories(): Promise<AdminCategory[]> {
    return this.dependencies.references.listCategories(this.dependencies.pool);
  }

  listWarehouses(): Promise<AdminWarehouse[]> {
    return this.dependencies.references.listActiveWarehouses(this.dependencies.pool);
  }

  /** Creates a brand, or returns the existing one with the same name (any case). */
  async createBrand(actorUserId: string, name: string): Promise<{ brand: AdminBrand; created: boolean }> {
    return withTransaction(this.dependencies.pool, async (database) => {
      const result = await this.dependencies.references.insertBrand(database, name, brandSlug(name));
      if (result.created) {
        await this.dependencies.audit.record(database, {
          actorUserId,
          action: "catalog.brand.created",
          entityType: "brands",
          entityId: result.brand.id,
          details: { name: result.brand.name },
        });
      }
      return result;
    });
  }

  /** Creates a category, or returns the existing one with the same name under the same parent. */
  async createCategory(
    actorUserId: string,
    input: { name: string; parentId: string | null },
  ): Promise<{ category: AdminCategory; created: boolean }> {
    const { references, audit } = this.dependencies;
    return withTransaction(this.dependencies.pool, async (database) => {
      if (input.parentId && !(await references.findCategory(database, input.parentId, { lock: true }))) {
        throw new ApplicationError({
          code: "CATEGORY_UNAVAILABLE",
          message: "Родительская категория не найдена.",
          statusCode: 422,
        });
      }
      // Serializes concurrent creation of the same name (no unique index on names).
      await database.query("SELECT pg_advisory_xact_lock(hashtext('admin-catalog-category'))");
      const existing = await references.findCategoryByName(database, input.name, input.parentId);
      if (existing) return { category: existing, created: false };
      let slug = createEntitySlug(input.name);
      if (await references.categorySlugExists(database, slug)) slug = `${slug}-${randomBytes(3).toString("hex")}`;
      const category = await references.insertCategory(database, input.name, slug, input.parentId);
      await audit.record(database, {
        actorUserId,
        action: "catalog.category.created",
        entityType: "categories",
        entityId: category.id,
        details: { name: category.name, parentId: category.parentId },
      });
      return { category, created: true };
    });
  }
}

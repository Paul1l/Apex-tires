import type { Pool } from "pg";
import { createApplicationServices } from "../bootstrap/application-services";
import { readUploadEnvironment, type UploadEnvironment } from "../config/environment";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import { AdminCatalogFitmentRepository } from "../repositories/admin-catalog-fitment-repository";
import { AdminCatalogProductRepository } from "../repositories/admin-catalog-product-repository";
import { AdminCatalogReferenceRepository } from "../repositories/admin-catalog-reference-repository";
import type { ImageStorage } from "../storage/image-storage";
import { AdminCatalogFitmentService } from "./admin-catalog-fitment-service";
import { AdminCatalogImageService } from "./admin-catalog-image-service";
import { AdminCatalogProductService } from "./admin-catalog-product-service";
import { AdminCatalogReferenceService } from "./admin-catalog-reference-service";

export interface AdminCatalogServices {
  products: AdminCatalogProductService;
  images: AdminCatalogImageService;
  fitments: AdminCatalogFitmentService;
  references: AdminCatalogReferenceService;
}

/**
 * Admin catalog editor services on a given pool. Tests pass their own pool,
 * upload settings and storage; the routes use createAdminCatalogServices().
 */
export function buildAdminCatalogServices(options: {
  pool: Pool;
  uploadEnvironment?: () => UploadEnvironment;
  createStorage?: (environment: UploadEnvironment) => Promise<ImageStorage | null>;
}): AdminCatalogServices {
  const products = new AdminCatalogProductRepository();
  const references = new AdminCatalogReferenceRepository();
  const fitments = new AdminCatalogFitmentRepository();
  const audit = new AdminAuditRepository();
  const dependencies = {
    pool: options.pool,
    products,
    references,
    audit,
    uploadEnvironment: options.uploadEnvironment ?? (() => readUploadEnvironment()),
  };
  return {
    products: new AdminCatalogProductService(dependencies),
    images: new AdminCatalogImageService({ ...dependencies, createStorage: options.createStorage }),
    fitments: new AdminCatalogFitmentService({ ...dependencies, fitments }),
    references: new AdminCatalogReferenceService(dependencies),
  };
}

/** Services on the shared application pool (requires DATABASE_URL). */
export function createAdminCatalogServices(): AdminCatalogServices {
  return buildAdminCatalogServices({ pool: createApplicationServices().pool });
}

import type { Pool } from "pg";
import type {
  AdminProductFitmentList,
  AdminVehicleReference,
} from "../../lib/admin/product-types";
import { withTransaction } from "../database/postgres-client";
import type { AdminAuditRepository } from "../repositories/admin-audit-repository";
import type {
  AdminCatalogFitmentRepository,
  ProductFitmentSize,
} from "../repositories/admin-catalog-fitment-repository";
import type { AdminCatalogProductRepository } from "../repositories/admin-catalog-product-repository";
import type { AdminCatalogReferenceRepository } from "../repositories/admin-catalog-reference-repository";
import { ApplicationError } from "../utils/errors";
import type { AddFitmentInput, VehicleReferenceQuery } from "../validators/admin-product-schema";
import { formatWheelPcd } from "./admin-catalog-rules";
import { productNotFound } from "./admin-catalog-product-service";

export interface AdminCatalogFitmentDependencies {
  pool: Pool;
  products: AdminCatalogProductRepository;
  references: AdminCatalogReferenceRepository;
  fitments: AdminCatalogFitmentRepository;
  audit: AdminAuditRepository;
}

export function fitmentSizeLabel(size: ProductFitmentSize): string {
  return size.kind === "tire"
    ? `${size.width}/${size.profile} R${size.diameter}`
    : `${size.width}J R${size.diameter} ${formatWheelPcd(size.boltCount, size.pcd)}`;
}

/**
 * Checks that a wheel fitment with the given ET range and hub DIA still
 * applies to this wheel, otherwise the addition would not show it to buyers.
 */
export function wheelFitmentIssue(
  size: ProductFitmentSize,
  input: Pick<AddFitmentInput, "etMin" | "etMax" | "dia">,
): string | null {
  if (size.kind !== "wheel") return null;
  if ((input.etMin !== null || input.etMax !== null) && size.et === null) {
    return "У диска не указан вылет (ET): сохраните ET в карточке или оставьте диапазон ET пустым.";
  }
  if (size.et !== null && input.etMin !== null && size.et < input.etMin) {
    return `Вылет диска ET${size.et} меньше «ET от» (${input.etMin}): применимость не покажет этот диск.`;
  }
  if (size.et !== null && input.etMax !== null && size.et > input.etMax) {
    return `Вылет диска ET${size.et} больше «ET до» (${input.etMax}): применимость не покажет этот диск.`;
  }
  if (input.dia !== null && (size.dia === null || size.dia < input.dia)) {
    return "Центральное отверстие диска (DIA) меньше ступицы автомобиля или не указано: применимость не покажет этот диск.";
  }
  return null;
}

export class AdminCatalogFitmentService {
  constructor(private readonly dependencies: AdminCatalogFitmentDependencies) {}

  async list(productId: string): Promise<AdminProductFitmentList | null> {
    const { pool, fitments } = this.dependencies;
    const size = await fitments.findProductSize(pool, productId);
    if (size === undefined) return null;
    if (size === null) return { size: null, items: [], sameSizeProducts: 0 };
    const [items, sameSizeProducts] = await Promise.all([
      fitments.listForProduct(pool, productId),
      fitments.countSameSizeProducts(pool, productId),
    ]);
    return { size: fitmentSizeLabel(size), items, sameSizeProducts };
  }

  listVehicleReferences(query: VehicleReferenceQuery): Promise<AdminVehicleReference[]> {
    return this.dependencies.references.listVehicleReferences(this.dependencies.pool, query.level, query.parentId);
  }

  async add(actorUserId: string, productId: string, input: AddFitmentInput) {
    const { pool, products, fitments, audit } = this.dependencies;
    return withTransaction(pool, async (database) => {
      const product = await products.lockProduct(database, productId);
      if (!product) throw productNotFound();
      const size = await fitments.findProductSize(database, productId);
      if (!size) {
        throw new ApplicationError({
          code: "FITMENT_SIZE_INCOMPLETE",
          message: "Сначала заполните и сохраните размер товара: применимость задаётся по размеру.",
          statusCode: 422,
        });
      }
      const generation = await fitments.findGeneration(database, input.generationId);
      const modification = input.modificationId ? await fitments.findModification(database, input.modificationId) : null;
      if (!generation || (input.modificationId && modification?.generation_id !== input.generationId)) {
        throw new ApplicationError({
          code: "VEHICLE_REFERENCE_NOT_FOUND",
          message: "Автомобиль не найден в справочнике. Выберите марку, модель и поколение заново.",
          statusCode: 422,
        });
      }
      const issue = wheelFitmentIssue(size, input);
      if (issue) throw new ApplicationError({ code: "FITMENT_DOES_NOT_MATCH", message: issue, statusCode: 422 });
      const saved = await fitments.saveManualFitment(database, {
        generationId: input.generationId,
        modificationId: input.modificationId,
        axle: input.axle,
        fitmentType: input.fitmentType,
        size,
        dia: input.dia,
        etMin: input.etMin,
        etMax: input.etMax,
        notes: "Добавлено в админке",
      });
      await audit.record(database, {
        actorUserId,
        action: "catalog.fitment.added",
        entityType: "fitments",
        entityId: saved.id,
        details: {
          productId,
          generationId: input.generationId,
          modificationId: input.modificationId,
          size: fitmentSizeLabel(size),
          created: saved.created,
        },
      });
      return { product: { id: product.id, kind: product.kind, slug: product.slug }, fitmentId: saved.id, created: saved.created };
    });
  }

  /** Revokes (verified = false) a fitment that applies to this product's size. */
  async revoke(actorUserId: string, productId: string, fitmentId: string) {
    const { pool, products, fitments, audit } = this.dependencies;
    return withTransaction(pool, async (database) => {
      const product = await products.lockProduct(database, productId);
      if (!product) throw productNotFound();
      const fitment = await fitments.findProductFitmentForUpdate(database, productId, fitmentId);
      if (!fitment) {
        throw new ApplicationError({
          code: "FITMENT_NOT_FOUND",
          message: "Запись применимости не найдена или уже отозвана. Обновите список.",
          statusCode: 404,
        });
      }
      await fitments.revoke(database, fitmentId, "Отозвано в админке");
      await audit.record(database, {
        actorUserId,
        action: "catalog.fitment.revoked",
        entityType: "fitments",
        entityId: fitmentId,
        details: {
          productId,
          vehicle: [fitment.make, fitment.model, fitment.generation, fitment.modification].filter(Boolean).join(" "),
          source: fitment.source,
        },
      });
      return { product: { id: product.id, kind: product.kind, slug: product.slug } };
    });
  }
}

import type { Pool } from "pg";
import { withTransaction } from "../database/postgres-client";
import { parseCsv, type CsvRecord } from "../imports/csv-parser";
import { ProductRepository } from "../repositories/product-repository";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import type { JsonValue } from "../types/common";
import {
  fitmentSchema,
  formatValidationIssues,
  priceSchema,
  productFitmentsSchema,
  productSchema,
  stockSchema,
  type PriceSyncItem,
  type ProductSyncItem,
  type StockSyncItem,
} from "../validators/one-c-schemas";

const CSV_SOURCE_SYSTEM = "csv";
const MAXIMUM_IMPORT_ROWS = 5_000;

export interface ImportRowError {
  line: number;
  externalId?: string;
  code: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}

export interface ImportReport {
  ok: boolean;
  received: number;
  created: number;
  updated: number;
  failed: number;
  errors: ImportRowError[];
}

interface PreparedProductRow {
  line: number;
  product: ProductSyncItem;
  price: PriceSyncItem;
  stock?: StockSyncItem;
}

function optionalValue(value: string): string | undefined {
  return value || undefined;
}

function numberValue(value: string): number | undefined {
  return value === "" ? undefined : Number(value.replace(",", "."));
}

function booleanValue(value: string, defaultValue: boolean): unknown {
  if (!value) return defaultValue;
  const normalized = value.toLocaleLowerCase("ru");
  if (["true", "1", "yes", "да"].includes(normalized)) return true;
  if (["false", "0", "no", "нет"].includes(normalized)) return false;
  return value;
}

function persistenceError(line: number, externalId?: string): ImportRowError {
  return {
    line,
    externalId,
    code: "PERSISTENCE_ERROR",
    message: "Строка не сохранена из-за конфликта или ошибки базы данных.",
  };
}

export class CatalogImportService {
  constructor(
    private readonly pool: Pool,
    private readonly productRepository: ProductRepository,
    private readonly auditRepository: AdminAuditRepository,
  ) {}

  async importProductsCsv(
    csv: string,
    mode: "full" | "incremental" = "incremental",
    actorUserId?: string,
  ): Promise<ImportReport> {
    const records = parseCsv(csv, {
      maximumRows: MAXIMUM_IMPORT_ROWS,
      requiredHeaders: [
        "external_id",
        "sku",
        "name",
        "brand",
        "model",
        "kind",
        "diameter",
        "price",
      ],
    });
    const errors: ImportRowError[] = [];
    const preparedRows: PreparedProductRow[] = [];
    const seenExternalIds = new Set<string>();

    for (const record of records) {
      const prepared = this.prepareProductRow(record, errors);
      if (!prepared) continue;
      if (seenExternalIds.has(prepared.product.externalId)) {
        errors.push({
          line: record.lineNumber,
          externalId: prepared.product.externalId,
          code: "DUPLICATE_EXTERNAL_ID",
          message: "external_id повторяется внутри CSV-файла.",
        });
        continue;
      }
      seenExternalIds.add(prepared.product.externalId);
      preparedRows.push(prepared);
    }

    let created = 0;
    let updated = 0;
    await withTransaction(this.pool, async (database) => {
      const existingIds = await this.productRepository.findExistingExternalIds(
        database,
        CSV_SOURCE_SYSTEM,
        preparedRows.map((row) => row.product.externalId),
      );
      const persistedIds: string[] = [];

      for (const row of preparedRows) {
        const savepoint = `csv_product_${row.line}`;
        await database.query(`SAVEPOINT ${savepoint}`);
        try {
          await this.productRepository.upsertFromExternalSystem(
            database,
            row.product,
            CSV_SOURCE_SYSTEM,
          );
          await this.productRepository.upsertPrice(
            database,
            row.price,
            CSV_SOURCE_SYSTEM,
          );
          if (row.stock) {
            await this.productRepository.upsertStock(
              database,
              row.stock,
              CSV_SOURCE_SYSTEM,
            );
          }
          await database.query(`RELEASE SAVEPOINT ${savepoint}`);
          persistedIds.push(row.product.externalId);
          if (existingIds.has(row.product.externalId)) updated += 1;
          else created += 1;
        } catch {
          await database.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await database.query(`RELEASE SAVEPOINT ${savepoint}`);
          errors.push(persistenceError(row.line, row.product.externalId));
        }
      }

      if (mode === "full" && errors.length === 0) {
        await this.productRepository.deactivateMissing(
          database,
          CSV_SOURCE_SYSTEM,
          persistedIds,
        );
      }
    });

    const report = {
      ok: errors.length === 0,
      received: records.length,
      created,
      updated,
      failed: errors.length,
      errors,
    };
    if (actorUserId) {
      await this.auditRepository.record(this.pool, {
        actorUserId,
        action: "catalog.products.csv_import",
        entityType: "products",
        details: {
          mode,
          ...report,
          errors: report.errors.slice(0, 20),
        } as unknown as JsonValue,
      });
    }
    return report;
  }

  async importFitmentsCsv(csv: string, actorUserId?: string): Promise<ImportReport> {
    const records = parseCsv(csv, {
      maximumRows: MAXIMUM_IMPORT_ROWS,
      requiredHeaders: ["product_external_id", "make", "model", "verified"],
    });
    const errors: ImportRowError[] = [];
    const grouped = new Map<
      string,
      {
        productExternalId: string;
        productSourceSystem: string;
        lines: number[];
        fitments: Array<ReturnType<typeof fitmentSchema.parse>>;
      }
    >();

    for (const record of records) {
      const values = record.values;
      const validation = fitmentSchema.safeParse({
        make: values.make,
        model: values.model,
        generation: optionalValue(values.generation),
        modification: optionalValue(values.modification),
        yearFrom: numberValue(values.year_from),
        yearTo: numberValue(values.year_to),
        isOem: booleanValue(values.is_oem, false),
        source: "import",
        verified: booleanValue(values.verified, false),
        verifiedAt: optionalValue(values.verified_at),
        notes: optionalValue(values.notes),
      });
      const productExternalId = values.product_external_id;
      if (!productExternalId || !validation.success) {
        errors.push({
          line: record.lineNumber,
          externalId: productExternalId || undefined,
          code: "VALIDATION_ERROR",
          message: "Строка применяемости не соответствует шаблону.",
          issues: validation.success
            ? [{ path: "product_external_id", message: "Обязательное поле" }]
            : formatValidationIssues(validation.error),
        });
        continue;
      }
      const productSourceSystem = values.product_source_system || CSV_SOURCE_SYSTEM;
      const groupKey = `${productSourceSystem}\u0000${productExternalId}`;
      const group = grouped.get(groupKey) ?? {
        productExternalId,
        productSourceSystem,
        lines: [],
        fitments: [],
      };
      group.lines.push(record.lineNumber);
      group.fitments.push(validation.data);
      grouped.set(groupKey, group);
    }

    let updated = 0;
    await withTransaction(this.pool, async (database) => {
      for (const group of grouped.values()) {
        const savepoint = `csv_fitment_${group.lines[0]}`;
        await database.query(`SAVEPOINT ${savepoint}`);
        const itemValidation = productFitmentsSchema.safeParse({
          externalId: group.productExternalId,
          fitments: group.fitments,
        });
        try {
          if (!itemValidation.success) throw new Error("INVALID_GROUP");
          await this.productRepository.replaceFitments(
            database,
            itemValidation.data,
            group.productSourceSystem,
            CSV_SOURCE_SYSTEM,
          );
          await database.query(`RELEASE SAVEPOINT ${savepoint}`);
          updated += group.fitments.length;
        } catch {
          await database.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await database.query(`RELEASE SAVEPOINT ${savepoint}`);
          for (const line of group.lines) {
            errors.push(
              persistenceError(line, group.productExternalId),
            );
          }
        }
      }
    });

    const report = {
      ok: errors.length === 0,
      received: records.length,
      created: 0,
      updated,
      failed: errors.length,
      errors: errors.sort((first, second) => first.line - second.line),
    };
    if (actorUserId) {
      await this.auditRepository.record(this.pool, {
        actorUserId,
        action: "catalog.fitments.csv_import",
        entityType: "product_fitments",
        details: {
          ...report,
          errors: report.errors.slice(0, 20),
        } as unknown as JsonValue,
      });
    }
    return report;
  }

  private prepareProductRow(
    record: CsvRecord,
    errors: ImportRowError[],
  ): PreparedProductRow | null {
    const values = record.values;
    const sourceUpdatedAt = optionalValue(values.source_updated_at);
    const productValidation = productSchema.safeParse({
      externalId: values.external_id,
      sku: values.sku,
      name: values.name,
      brand: values.brand,
      model: values.model,
      category: values.category || "",
      description: values.description || "",
      kind: values.kind,
      condition: values.condition || "new",
      width: numberValue(values.width) ?? 0,
      profile: numberValue(values.profile) ?? 0,
      diameter: numberValue(values.diameter),
      season: values.season || "none",
      studded: booleanValue(values.studded, false),
      runflat: booleanValue(values.runflat, false),
      xl: booleanValue(values.xl, false),
      wheelType: optionalValue(values.wheel_type),
      pcd: optionalValue(values.pcd),
      offset: numberValue(values.offset),
      centerBore: numberValue(values.center_bore),
      color: optionalValue(values.color),
      country: optionalValue(values.country),
      specifications: {},
      images: values.image_url
        ? [{ url: values.image_url, alt: values.name, position: 0 }]
        : [],
      isActive: booleanValue(values.is_active, true),
      sourceUpdatedAt,
    });
    const priceValidation = priceSchema.safeParse({
      externalId: values.external_id,
      price: numberValue(values.price),
      oldPrice: numberValue(values.old_price),
      discount: numberValue(values.discount),
      sourceUpdatedAt,
    });
    const hasStock = values.stock !== "";
    const stockValidation = hasStock
      ? stockSchema.safeParse({
          externalId: values.external_id,
          warehouseExternalId:
            values.warehouse_external_id || values.warehouse_code,
          warehouseCode: values.warehouse_code,
          warehouseName: values.warehouse_name,
          quantity: numberValue(values.stock),
          reserved: numberValue(values.reserved) ?? 0,
          sourceUpdatedAt,
        })
      : null;

    if (
      !productValidation.success ||
      !priceValidation.success ||
      (stockValidation && !stockValidation.success)
    ) {
      errors.push({
        line: record.lineNumber,
        externalId: values.external_id || undefined,
        code: "VALIDATION_ERROR",
        message: "Строка товара не соответствует шаблону.",
        issues: [
          ...(productValidation.success
            ? []
            : formatValidationIssues(productValidation.error)),
          ...(priceValidation.success
            ? []
            : formatValidationIssues(priceValidation.error)),
          ...(stockValidation && !stockValidation.success
            ? formatValidationIssues(stockValidation.error)
            : []),
        ],
      });
      return null;
    }
    return {
      line: record.lineNumber,
      product: productValidation.data,
      price: priceValidation.data,
      stock: stockValidation?.data,
    };
  }
}

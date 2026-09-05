import type { Pool } from "pg";
import type { Product } from "../../lib/types";
import { ProductRepository } from "../repositories/product-repository";

function kopecksToRubles(value: number | string): number {
  return Number(value) / 100;
}

function buildProductSubtitle(row: {
  kind: "tire" | "wheel";
  width: number;
  profile: number;
  diameter: number;
  pcd: string | null;
}): string {
  if (row.kind === "tire") {
    return `${row.width}/${row.profile} R${row.diameter}`;
  }
  return [`R${row.diameter}`, row.pcd].filter(Boolean).join(" ");
}

export class CatalogService {
  constructor(
    private readonly pool: Pool,
    private readonly productRepository: ProductRepository,
  ) {}

  async getActiveProducts(): Promise<Product[]> {
    const rows = await this.productRepository.listActiveCatalog(this.pool);
    return rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      externalId: row.external_id ?? undefined,
      kind: row.kind,
      condition: row.condition,
      brand: row.brand,
      model: row.model,
      subtitle: buildProductSubtitle(row),
      width: row.width,
      profile: row.profile,
      diameter: row.diameter,
      season: row.season,
      studded: row.studded,
      runflat: row.runflat,
      xl: row.xl,
      wheelType: row.wheel_type ?? undefined,
      pcd: row.pcd ?? undefined,
      offset: row.offset ?? undefined,
      centerBore:
        row.center_bore === null ? undefined : Number(row.center_bore),
      color: row.color ?? undefined,
      price: kopecksToRubles(row.amount_kopecks),
      oldPrice:
        row.old_amount_kopecks === null
          ? undefined
          : kopecksToRubles(row.old_amount_kopecks),
      discount:
        row.discount_percent === null
          ? undefined
          : Number(row.discount_percent),
      priceUpdatedAt: new Date(row.price_updated_at).toISOString(),
      stock: row.stock,
      reserved: row.reserved,
      warehouse: row.warehouse ?? "",
      tags: [],
      country: row.country ?? "",
      image: row.image ?? undefined,
      compatibleCars: row.compatible_cars,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }
}

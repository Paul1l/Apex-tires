import type { Pool } from "pg";
import type { Product, ProductDetails } from "../../lib/types";
import { ProductRepository, type CatalogProductRow } from "../repositories/product-repository";
import type { CatalogQuery } from "../validators/catalog-query-schema";
import { normalizeCatalogSearch } from "./catalog-search-parser";

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

function mapCatalogProduct(row: CatalogProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    externalId: row.external_id ?? undefined,
    slug: row.slug,
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
    centerBore: row.center_bore === null ? undefined : Number(row.center_bore),
    color: row.color ?? undefined,
    price: kopecksToRubles(row.amount_kopecks),
    oldPrice: row.old_amount_kopecks === null ? undefined : kopecksToRubles(row.old_amount_kopecks),
    discount: row.discount_percent === null ? undefined : Number(row.discount_percent),
    priceUpdatedAt: new Date(row.price_updated_at).toISOString(),
    stock: row.stock,
    reserved: row.reserved,
    warehouse: row.warehouse ?? "",
    tags: [],
    country: row.country ?? "",
    image: row.image ?? undefined,
    compatibleCars: row.compatible_cars,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class CatalogService {
  constructor(
    private readonly pool: Pool,
    private readonly productRepository: ProductRepository,
  ) {}

  async getCatalogPage(query: CatalogQuery) {
    const [rows, facets] = await Promise.all([
      this.productRepository.searchCatalog(this.pool, normalizeCatalogSearch(query)),
      this.productRepository.getCatalogFacets(this.pool, query.type),
    ]);
    const items = rows.map(mapCatalogProduct);
    const total = Number(rows[0]?.total_count ?? 0);
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
        hasNextPage: query.page * query.pageSize < total,
      },
      facets,
    };
  }

  async getActiveProducts(): Promise<Product[]> {
    return (await this.getCatalogPage({ type: "all", sort: "newest", page: 1, pageSize: 96 })).items;
  }

  async getProductBySlug(slug: string): Promise<ProductDetails | null> {
    const row = await this.productRepository.findPublicBySlug(this.pool, slug);
    return row ? { ...mapCatalogProduct(row), name: row.name, description: row.description ?? "" } : null;
  }

  async getProductsByIds(productIds: string[]): Promise<Product[]> {
    if (productIds.length === 0) return [];
    return (await this.productRepository.findPublicByIds(this.pool, productIds)).map(mapCatalogProduct);
  }
}

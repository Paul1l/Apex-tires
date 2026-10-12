import type { Pool } from "pg";
import { businessConfig, type AvailabilityDisplayMode } from "../../config/business";
import type { Product, ProductDetails } from "../../lib/types";
import { ProductRepository, type CatalogProductRow } from "../repositories/product-repository";
import type { CatalogQuery } from "../validators/catalog-query-schema";
import { normalizeCatalogSearch } from "./catalog-search-parser";
import { buildProductSubtitle } from "../utils/product-title";
import { toPublicProduct } from "./public-product";

function kopecksToRubles(value: number | string): number {
  return Number(value) / 100;
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

/**
 * Catalog reads. Every method except getAdminCatalogPage serves buyers
 * (public API, server-rendered storefront and product pages, cart): products
 * are passed through toPublicProduct, so the 1C identifier and exact stock are
 * not exposed beyond what the availability display mode shows.
 */
export class CatalogService {
  constructor(
    private readonly pool: Pool,
    private readonly productRepository: ProductRepository,
    private readonly availabilityDisplayMode: AvailabilityDisplayMode =
      businessConfig.catalog.availabilityDisplayMode,
  ) {}

  private async loadCatalogPage(query: CatalogQuery, toResponseProduct: (product: Product) => Product) {
    const [rows, facets] = await Promise.all([
      this.productRepository.searchCatalog(this.pool, normalizeCatalogSearch(query)),
      this.productRepository.getCatalogFacets(this.pool, query.type),
    ]);
    const items = rows.map((row) => toResponseProduct(mapCatalogProduct(row)));
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

  private toPublic<ProductType extends Product>(product: ProductType): ProductType {
    return toPublicProduct(product, this.availabilityDisplayMode);
  }

  /** Catalog page for buyers (see the class note). */
  getCatalogPage(query: CatalogQuery) {
    return this.loadCatalogPage(query, (product) => this.toPublic(product));
  }

  /** Catalog page for staff (manager/admin API only): stored stock, reserves and 1C ids. */
  getAdminCatalogPage(query: CatalogQuery) {
    return this.loadCatalogPage(query, (product) => product);
  }

  async getActiveProducts(): Promise<Product[]> {
    return (await this.getCatalogPage({ type: "all", sort: "newest", page: 1, pageSize: 96 })).items;
  }

  async getProductBySlug(slug: string): Promise<ProductDetails | null> {
    const row = await this.productRepository.findPublicBySlug(this.pool, slug);
    return row
      ? this.toPublic({ ...mapCatalogProduct(row), name: row.name, description: row.description ?? "" })
      : null;
  }

  async getProductsByIds(productIds: string[]): Promise<Product[]> {
    if (productIds.length === 0) return [];
    return (await this.productRepository.findPublicByIds(this.pool, productIds)).map((row) =>
      this.toPublic(mapCatalogProduct(row)),
    );
  }
}

/**
 * Data shapes of the admin catalog editor shared by the API (server) and the
 * editor pages (browser). Money is in kopecks, as stored in PostgreSQL; the
 * editor shows rubles (see lib/admin/product-form.ts).
 */

export type AdminProductKind = "tire" | "wheel";
export type AdminTireSeason = "summer" | "winter" | "all-season";
export type AdminWheelType = "alloy" | "steel" | "other";

/** Editable product card. Tire and wheel fields are null for the other kind. */
export interface AdminProductCard {
  kind: AdminProductKind;
  sku: string;
  article: string | null;
  name: string;
  brandId: string | null;
  model: string;
  categoryId: string | null;
  description: string;
  country: string | null;
  isActive: boolean;
  diameter: number | null;
  // Tire
  width: number | null;
  profile: number | null;
  season: AdminTireSeason | null;
  studded: boolean;
  runflat: boolean;
  xl: boolean;
  loadIndex: string | null;
  speedIndex: string | null;
  // Wheel
  wheelWidth: number | null;
  boltCount: number | null;
  pcd: number | null;
  offset: number | null;
  centerBore: number | null;
  wheelType: AdminWheelType | null;
  color: string | null;
}

export type AdminProductCardField = keyof AdminProductCard;

export interface AdminProductPrice {
  amountKopecks: number;
  oldAmountKopecks: number | null;
}

export interface AdminProductStockRow {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: number;
  reserved: number;
}

export interface AdminProductImage {
  id: string;
  url: string;
  alt: string;
  position: number;
  /** manual, csv or 1c */
  source: string;
  /** The file is stored by the site (UPLOADS_DIR) and is deleted with the record. */
  stored: boolean;
  /** Owned by 1C: replaced by the next exchange, not editable here. */
  locked: boolean;
}

export interface AdminUploadSettings {
  enabled: boolean;
  /** Why uploads are disabled (Russian, for the editor). */
  reason: string | null;
  maxBytes: number;
  maxImages: number;
}

export interface AdminProductEditorData {
  id: string;
  slug: string;
  source: string;
  externalId: string | null;
  /** Opaque optimistic-concurrency token; send it back with PATCH. */
  version: string;
  createdAt: string;
  updatedAt: string;
  card: AdminProductCard;
  /** Stored brand and category names (category may be text only, from CSV/1C). */
  brandName: string;
  categoryName: string;
  price: AdminProductPrice | null;
  stock: AdminProductStockRow[];
  images: AdminProductImage[];
  /** Card fields and the sections "price"/"stock" closed for editing (1C). */
  lockedFields: string[];
  publicPath: string;
  uploads: AdminUploadSettings;
}

export interface AdminProductListItem {
  id: string;
  sku: string;
  slug: string;
  kind: AdminProductKind;
  brand: string;
  model: string;
  name: string;
  subtitle: string;
  season: "summer" | "winter" | "all-season" | "none";
  color: string | null;
  isActive: boolean;
  source: string;
  externalId: string | null;
  priceKopecks: number | null;
  oldPriceKopecks: number | null;
  stock: number;
  reserved: number;
  image: string | null;
  updatedAt: string;
}

export interface AdminProductListResponse {
  ok: true;
  items: AdminProductListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

export interface AdminBrand {
  id: string;
  name: string;
  isActive: boolean;
}

export interface AdminCategory {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
}

export interface AdminWarehouse {
  id: string;
  code: string;
  name: string;
  source: string;
}

export interface AdminVehicleReference {
  id: string;
  name: string;
  yearFrom?: number | null;
  yearTo?: number | null;
}

export interface AdminProductFitment {
  id: string;
  make: string;
  model: string;
  generation: string;
  yearFrom: number | null;
  yearTo: number | null;
  modification: string | null;
  axle: "all" | "front" | "rear";
  fitmentType: "factory" | "alternative" | "tuning";
  source: string;
  dia: number | null;
  etMin: number | null;
  etMax: number | null;
}

export interface AdminProductFitmentList {
  /** Size the fitments are matched by, e.g. "205/55 R16"; null — size incomplete. */
  size: string | null;
  items: AdminProductFitment[];
  /** Other products of the same size share these fitments. */
  sameSizeProducts: number;
}

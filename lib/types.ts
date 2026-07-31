export type ProductKind = "tire" | "wheel";
export type Season = "summer" | "winter" | "all-season" | "none";

export interface Product {
  id: string;
  sku: string;
  externalId?: string;
  kind: ProductKind;
  brand: string;
  model: string;
  subtitle: string;
  width: number;
  profile: number;
  diameter: number;
  season: Season;
  studded: boolean;
  runflat: boolean;
  pcd?: string;
  offset?: number;
  centerBore?: number;
  color?: string;
  price: number;
  oldPrice?: number;
  stock: number;
  reserved: number;
  warehouse: string;
  rating: number;
  reviews: number;
  tags: string[];
  country: string;
  featured?: boolean;
  image?: string;
  compatibleCars: string[];
  updatedAt: string;
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: "customer" | "admin";
}

export interface CatalogFilters {
  kind: "all" | ProductKind;
  seasons: Season[];
  brands: string[];
  width: string;
  profile: string;
  diameter: string;
  minPrice: number;
  maxPrice: number;
  inStock: boolean;
  studded: boolean;
  runflat: boolean;
  carMake: string;
  carModel: string;
  carYear: string;
  carGeneration: string;
  query: string;
  sort: "popular" | "price-asc" | "price-desc" | "rating";
}

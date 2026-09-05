export type ProductKind = "tire" | "wheel";
export type Season = "summer" | "winter" | "all-season" | "none";
export type ProductCondition = "new" | "used";
export type UsedConditionGrade = "excellent" | "good" | "acceptable";
export type WheelType = "alloy" | "steel" | "other";
export type DeliveryMethod = "pickup" | "courier" | "transport_company";

export interface Product {
  id: string;
  sku: string;
  externalId?: string;
  slug?: string;
  kind: ProductKind;
  condition: ProductCondition;
  brand: string;
  model: string;
  subtitle: string;
  width: number;
  profile: number;
  diameter: number;
  season: Season;
  studded: boolean;
  runflat: boolean;
  xl?: boolean;
  wheelType?: WheelType;
  pcd?: string;
  offset?: number;
  centerBore?: number;
  color?: string;
  price: number;
  oldPrice?: number;
  discount?: number;
  priceUpdatedAt: string;
  stock: number;
  reserved: number;
  warehouse: string;
  rating?: number;
  reviews?: number;
  tags: string[];
  country: string;
  featured?: boolean;
  image?: string;
  manufactureYear?: number;
  treadDepth?: number;
  conditionGrade?: UsedConditionGrade;
  repairs?: string;
  defects?: string;
  conditionComment?: string;
  setQuantity?: number;
  individualPhotos?: string[];
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
  role: "customer" | "manager" | "admin";
}

export interface ProductDetails extends Product {
  name: string;
  description: string;
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
  carModification?: string;
  query: string;
  sort: "popular" | "price-asc" | "price-desc" | "rating";
}

import type { AvailabilityDisplayMode } from "@/config/business";
import type { Product } from "@/lib/types";

export interface AvailabilityPresentation {
  label: string;
  availableQuantity: number;
  available: boolean;
}

export function getAvailabilityPresentation(
  product: Pick<Product, "stock" | "reserved">,
  displayMode: AvailabilityDisplayMode,
  catalogIsPreview: boolean,
): AvailabilityPresentation {
  const availableQuantity = Math.max(0, product.stock - product.reserved);

  if (catalogIsPreview) {
    return { label: "Наличие уточняется", availableQuantity, available: true };
  }
  if (displayMode === "on_request") {
    return { label: "Под заказ", availableQuantity, available: true };
  }
  if (displayMode === "out_of_stock" || availableQuantity === 0) {
    return { label: "Нет в наличии", availableQuantity, available: false };
  }
  if (displayMode === "exact") {
    return {
      label: `${availableQuantity} шт.`,
      availableQuantity,
      available: true,
    };
  }
  if (displayMode === "limited" && availableQuantity <= 4) {
    return { label: "Мало", availableQuantity, available: true };
  }
  return { label: "В наличии", availableQuantity, available: true };
}

export function hasValidDiscount(
  product: Pick<Product, "price" | "oldPrice">,
): product is Pick<Product, "price"> & { oldPrice: number } {
  return typeof product.oldPrice === "number" && product.oldPrice > product.price;
}

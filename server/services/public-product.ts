import type { AvailabilityDisplayMode } from "../../config/business";
import type { Product } from "../../lib/types";

/**
 * Highest free quantity that the "limited" display mode shows as «Мало»
 * (see getAvailabilityPresentation in lib/product-presentation.ts; the
 * public-product test fails if the two drift apart).
 */
export const LIMITED_LOW_STOCK_MAXIMUM = 4;

export interface PublicStock {
  stock: number;
  reserved: number;
}

/**
 * Stock values for buyers. With the "exact" display mode the storefront shows
 * the free quantity, so the values are returned as stored. Every other mode
 * shows only a label, and the response carries just enough to produce the
 * same label and the same "can be added to the cart" state:
 * - no free stock → 0;
 * - "limited": 1 for «Мало» (1…4 free), 5 for «В наличии» (5 and more);
 * - "available", "on_request", "out_of_stock": 1 when anything is free.
 * `reserved` is always 0 there. The real quantities stay on the server:
 * checkout reserves stock from the inventory tables, never from these values.
 */
export function toPublicStock(
  stock: number,
  reserved: number,
  displayMode: AvailabilityDisplayMode,
): PublicStock {
  if (displayMode === "exact") return { stock, reserved };
  const freeQuantity = Math.max(0, stock - reserved);
  if (freeQuantity === 0) return { stock: 0, reserved: 0 };
  if (displayMode === "limited") {
    return {
      stock: freeQuantity <= LIMITED_LOW_STOCK_MAXIMUM ? 1 : LIMITED_LOW_STOCK_MAXIMUM + 1,
      reserved: 0,
    };
  }
  return { stock: 1, reserved: 0 };
}

/**
 * Product as served by public endpoints and server-rendered storefront pages:
 * the 1C identifier is left out and stock is reduced to what the display mode
 * shows. The admin catalog keeps the stored values.
 */
export function toPublicProduct<ProductType extends Product>(
  product: ProductType,
  displayMode: AvailabilityDisplayMode,
): ProductType {
  const publicProduct: ProductType = {
    ...product,
    ...toPublicStock(product.stock, product.reserved, displayMode),
  };
  delete publicProduct.externalId;
  return publicProduct;
}

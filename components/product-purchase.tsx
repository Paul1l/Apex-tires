"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useStore } from "./store-provider";
import type { Product } from "@/lib/types";

// The cart lives in the storefront drawer; this parameter opens it there.
const CART_HREF = "/?cart=open";

export function ProductPurchase({
  product,
  canAddToCart,
  className,
}: {
  product: Product;
  /** Same availability rule as the storefront plus a real free quantity. */
  canAddToCart: boolean;
  className?: string;
}) {
  const { mergeCatalogProducts, addToCart, cartError } = useStore();
  const [added, setAdded] = useState(false);
  useEffect(() => mergeCatalogProducts([product]), [product, mergeCatalogProducts]);

  return (
    <div className={className}>
      <button
        type="button"
        className="primary-button"
        disabled={!canAddToCart || added}
        onClick={() => {
          addToCart(product.id);
          setAdded(true);
        }}
      >
        <ShoppingBag size={18} aria-hidden="true" />
        {added ? "Добавлено в корзину" : "В корзину"}
      </button>
      {added && (
        <Link className="secondary-button" href={CART_HREF} rel="nofollow">
          Открыть корзину
        </Link>
      )}
      <p role="status" aria-live="polite">
        {added ? "Товар добавлен в корзину." : ""}
      </p>
      {cartError && <p role="alert">{cartError}</p>}
    </div>
  );
}

/** Cart shortcut for pages outside the storefront (product page). */
export function HeaderCartLink({ className }: { className?: string }) {
  const { cart } = useStore();
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  return (
    <Link
      className={className}
      href={CART_HREF}
      rel="nofollow"
      aria-label={count > 0 ? `Корзина, товаров: ${count}` : "Корзина"}
    >
      <ShoppingBag size={20} aria-hidden="true" />
      <span>Корзина</span>
      {count > 0 && <b aria-hidden="true">{count}</b>}
    </Link>
  );
}

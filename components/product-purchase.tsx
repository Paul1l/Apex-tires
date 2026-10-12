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
  const { mergeCatalogProducts, addToCart, cart, cartError } = useStore();
  // "added" is shown only after the cart is actually saved (or applied
  // locally in preview); a failed save keeps the button available.
  const [status, setStatus] = useState<"idle" | "saving" | "added" | "limit" | "error">("idle");
  const [message, setMessage] = useState("");
  useEffect(() => mergeCatalogProducts([product]), [product, mergeCatalogProducts]);

  const added = status === "added";
  const statusText =
    status === "added"
      ? "Товар добавлен в корзину."
      : status === "limit" || status === "error"
        ? message
        : "";

  return (
    <div className={className}>
      <button
        type="button"
        className="primary-button"
        disabled={!canAddToCart || added || status === "saving"}
        aria-busy={status === "saving" || undefined}
        onClick={async () => {
          const quantityBefore = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
          setStatus("saving");
          const result = await addToCart(product.id);
          if (!result.ok) {
            setMessage(result.message ?? "Корзина не сохранена. Попробуйте ещё раз.");
            setStatus("error");
          } else if (result.quantity <= quantityBefore) {
            setMessage(`Больше добавить нельзя: в корзине уже ${result.quantity} шт.`);
            setStatus("limit");
          } else {
            setStatus("added");
          }
        }}
      >
        <ShoppingBag size={18} aria-hidden="true" />
        {added ? "Добавлено в корзину" : "В корзину"}
      </button>
      {(added || status === "limit") && (
        <Link className="secondary-button" href={CART_HREF} rel="nofollow">
          Открыть корзину
        </Link>
      )}
      <p role="status" aria-live="polite">
        {statusText}
      </p>
      {cartError && status !== "error" && <p role="alert">{cartError}</p>}
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

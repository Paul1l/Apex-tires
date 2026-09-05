"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "./store-provider";
import type { Product } from "@/lib/types";

export function ProductPurchase({ product }: { product: Product }) {
  const { mergeCatalogProducts, addToCart, cartError } = useStore();
  const [added,setAdded] = useState(false);
  useEffect(() => mergeCatalogProducts([product]), [product, mergeCatalogProducts]);
  return <div><button className="primary-button" disabled={product.stock <= product.reserved || added} onClick={() => { addToCart(product.id); setAdded(true); }}>{added ? "Добавлено в корзину" : "В корзину"}</button>
    {added && <Link className="primary-button" href="/?cart=open">Открыть корзину</Link>}{cartError && <p role="alert">{cartError}</p>}</div>;
}

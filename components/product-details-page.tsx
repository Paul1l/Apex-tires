import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { ProductKind } from "@/lib/types";
import { createApplicationServices, databaseIsConfigured } from "@/server/bootstrap/application-services";
import { businessConfig } from "@/config/business";
import { formatPrice } from "@/lib/catalog-data";
import { ProductPurchase } from "./product-purchase";

const loadProduct = cache(async (slug: string, kind: ProductKind) => {
  if (!databaseIsConfigured()) notFound();
  const product = await createApplicationServices().catalogService.getProductBySlug(slug);
  if (!product || product.kind !== kind) notFound();
  return product;
});

export async function productMetadata(slug: string, kind: ProductKind): Promise<Metadata> {
  const product = await loadProduct(slug,kind);
  return { title: product.name, description: `${product.name}, ${product.subtitle}. Каталог в ${businessConfig.location.city}.`,
    alternates: { canonical: `/${kind === "tire" ? "tires" : "wheels"}/${encodeURIComponent(slug)}` } };
}

export async function ProductDetailsPage({slug,kind}: {slug:string;kind:ProductKind}) {
  const product=await loadProduct(slug,kind);
  return <main className="container product-details-page"><Link href={kind === "tire" ? "/shiny" : "/diski"}>← В каталог</Link>
    <article><p className="eyebrow">{kind === "tire" ? "Шина" : "Диск"} · {product.sku}</p><h1>{product.name}</h1><p>{product.subtitle}</p>
      <strong>{formatPrice(product.price)}</strong><p>{product.stock > product.reserved ? "В наличии" : "Нет в наличии"}</p>
      {product.description && <p>{product.description}</p>}<ProductPurchase product={product} /></article></main>;
}

import { createHash } from "node:crypto";

export function createProductSlug(name: string, sku: string): string {
  const normalizedName = name
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
  const normalizedSku = sku
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${normalizedName || "product"}-${normalizedSku}-${createHash("sha256").update(sku).digest("hex").slice(0, 10)}`;
}

export function createEntitySlug(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "item";
}

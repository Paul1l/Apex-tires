export interface ProductTitleSource {
  kind: "tire" | "wheel";
  brand: string;
  model: string;
  width: number;
  profile: number;
  diameter: number;
  pcd: string | null;
}

/** Size line shown under the title in the catalog: `205/55 R16` or `R18 5x112`. */
export function buildProductSubtitle(
  row: Pick<ProductTitleSource, "kind" | "width" | "profile" | "diameter" | "pcd">,
): string {
  if (row.kind === "tire") {
    return `${row.width}/${row.profile} R${row.diameter}`;
  }
  return [`R${row.diameter}`, row.pcd].filter(Boolean).join(" ");
}

/** Customer-facing product name as in the catalog: brand, model and size. */
export function formatProductDisplayName(row: ProductTitleSource): string {
  return [`${row.brand} ${row.model}`.trim(), buildProductSubtitle(row)].filter(Boolean).join(", ");
}

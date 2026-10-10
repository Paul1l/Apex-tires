import type { Pool } from "pg";
import { businessConfig } from "../../config/business";
import { legalDocuments } from "../../lib/legal-documents";

export const SITEMAP_PAGE_SIZE = 5000;
export function escapeXml(value: string): string {
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
export function sitemapResponse(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600" } });
}
// Matches «Редакция от 31 июля 2026 года» in app/legal/[slug]/page.tsx.
const LEGAL_DOCUMENTS_REVISED_AT = "2026-07-31";
export function staticSitemap(): Response {
  const entries: Array<{ path: string; lastmod?: string }> =
    businessConfig.deploymentStage === "production" && businessConfig.siteUrl
      ? [
          { path: "" }, { path: "/shiny" }, { path: "/diski" }, { path: "/contacts" },
          { path: "/legal", lastmod: LEGAL_DOCUMENTS_REVISED_AT },
          ...legalDocuments.map((document) => ({ path: `/legal/${document.slug}`, lastmod: LEGAL_DOCUMENTS_REVISED_AT })),
        ]
      : [];
  return sitemapResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(({ path, lastmod }) => `<url><loc>${escapeXml(`${businessConfig.siteUrl}${path}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`).join("")}</urlset>`);
}
// Only products with a retail price have a product page; others would 404.
export const SITEMAP_PRODUCTS_FROM = "FROM products JOIN prices ON prices.product_id = products.id AND prices.price_type = 'retail' WHERE products.is_active";
export async function productSitemap(pool: Pool, page: number): Promise<Response> {
  const result = await pool.query<{ kind: "tire" | "wheel"; slug: string; updated_at: Date }>(
    `SELECT products.kind, products.slug, products.updated_at ${SITEMAP_PRODUCTS_FROM} ORDER BY products.id LIMIT $1 OFFSET $2`, [SITEMAP_PAGE_SIZE, page * SITEMAP_PAGE_SIZE],
  );
  const urls = result.rows.map((row) => `<url><loc>${escapeXml(`${businessConfig.siteUrl}/${row.kind === "tire" ? "tires" : "wheels"}/${encodeURIComponent(row.slug)}`)}</loc><lastmod>${row.updated_at.toISOString()}</lastmod></url>`);
  return sitemapResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
}

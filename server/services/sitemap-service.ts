import type { Pool } from "pg";
import { businessConfig } from "../../config/business";

export const SITEMAP_PAGE_SIZE = 5000;
export function escapeXml(value: string): string {
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
export function sitemapResponse(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600" } });
}
export function staticSitemap(): Response {
  const paths = businessConfig.deploymentStage === "production" && businessConfig.siteUrl ? ["", "/shiny", "/diski", "/contacts", "/legal"] : [];
  return sitemapResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escapeXml(`${businessConfig.siteUrl}${path}`)}</loc></url>`).join("")}</urlset>`);
}
export async function productSitemap(pool: Pool, page: number): Promise<Response> {
  const result = await pool.query<{ kind: "tire" | "wheel"; slug: string; updated_at: Date }>(
    "SELECT kind,slug,updated_at FROM products WHERE is_active ORDER BY id LIMIT $1 OFFSET $2", [SITEMAP_PAGE_SIZE, page * SITEMAP_PAGE_SIZE],
  );
  const urls = result.rows.map((row) => `<url><loc>${escapeXml(`${businessConfig.siteUrl}/${row.kind === "tire" ? "tires" : "wheels"}/${encodeURIComponent(row.slug)}`)}</loc><lastmod>${row.updated_at.toISOString()}</lastmod></url>`);
  return sitemapResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
}

import { businessConfig } from "@/config/business";
import { createApplicationServices, databaseIsConfigured } from "@/server/bootstrap/application-services";
import { SITEMAP_PAGE_SIZE, SITEMAP_PRODUCTS_FROM, escapeXml, sitemapResponse, staticSitemap } from "@/server/services/sitemap-service";

export const dynamic = "force-dynamic";
export async function GET() {
  if (businessConfig.deploymentStage !== "production" || !businessConfig.siteUrl) return staticSitemap();
  let count = 0;
  if (databaseIsConfigured()) {
    const result = await createApplicationServices().pool.query(`SELECT COUNT(*)::integer AS count ${SITEMAP_PRODUCTS_FROM}`);
    count = result.rows[0].count;
  }
  const paths = ["static.xml", ...Array.from({length: Math.ceil(count/SITEMAP_PAGE_SIZE)}, (_,page) => `products-${page}.xml`)];
  return sitemapResponse(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<sitemap><loc>${escapeXml(`${businessConfig.siteUrl}/sitemaps/${path}`)}</loc></sitemap>`).join("")}</sitemapindex>`);
}

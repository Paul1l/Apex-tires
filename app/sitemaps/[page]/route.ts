import { businessConfig } from "@/config/business";
import { createApplicationServices, databaseIsConfigured } from "@/server/bootstrap/application-services";
import { SITEMAP_PRODUCTS_FROM, productSitemap, staticSitemap } from "@/server/services/sitemap-service";
import { parseProductSitemapPage, productSitemapPageExists } from "../product-sitemap-pages";

export const dynamic = "force-dynamic";

function notFoundResponse(): Response {
  return new Response("Not found", { status: 404 });
}

export async function GET(_request: Request, {params}: {params: Promise<{page: string}>}) {
  const {page} = await params;
  if (page === "static.xml") return staticSitemap();
  const pageNumber = parseProductSitemapPage(page);
  if (pageNumber === null || businessConfig.deploymentStage !== "production" || !businessConfig.siteUrl || !databaseIsConfigured()) {
    return notFoundResponse();
  }
  const { pool } = createApplicationServices();
  // Same product set as the sitemap index: a page it does not list is 404,
  // not an empty <urlset>.
  const result = await pool.query<{ count: number }>(`SELECT COUNT(*)::integer AS count ${SITEMAP_PRODUCTS_FROM}`);
  if (!productSitemapPageExists(pageNumber, result.rows[0]?.count ?? 0)) return notFoundResponse();
  return productSitemap(pool, pageNumber);
}

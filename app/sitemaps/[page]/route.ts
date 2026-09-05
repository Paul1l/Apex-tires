import { businessConfig } from "@/config/business";
import { createApplicationServices, databaseIsConfigured } from "@/server/bootstrap/application-services";
import { productSitemap, staticSitemap } from "@/server/services/sitemap-service";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, {params}: {params: Promise<{page: string}>}) {
  const {page} = await params;
  if (page === "static.xml") return staticSitemap();
  const match = /^products-(\d{1,5})\.xml$/.exec(page);
  if (!match || businessConfig.deploymentStage !== "production" || !businessConfig.siteUrl || !databaseIsConfigured()) return new Response("Not found", {status:404});
  return productSitemap(createApplicationServices().pool, Number(match[1]));
}

import type { Metadata } from "next";
import { Storefront } from "@/components/storefront";
import { businessConfig } from "@/config/business";
import { loadInitialCatalog } from "@/lib/api/initial-catalog";
import { createPageSeoMetadata } from "@/lib/structured-data";

const { brandName, location } = businessConfig;

// Incremental static regeneration instead of rendering on every request:
// - the HTML is served from cache (fast TTFB for buyers and crawlers) and the
//   database is queried at most once per 5 minutes per catalog page;
// - list prices and stock may lag by up to 5 minutes; the cart, checkout and
//   product pages always read current data on the server;
// - the production image is built without DATABASE_URL, so the build output
//   has no products and the browser loads them; the first request after
//   5 minutes regenerates the page with the catalog from PostgreSQL;
// - if the database fails during regeneration, the page is still rendered and
//   the storefront loads the catalog in the browser.
export const revalidate = 300;

export const metadata: Metadata = {
  title: `Купить шины в ${location.cityPrepositional}`,
  description: `Каталог шин ${brandName}: летние, зимние и всесезонные шины с подбором по размеру и по автомобилю в ${location.cityPrepositional}.`,
  ...createPageSeoMetadata("/shiny"),
};

export default async function TiresPage() {
  const initialCatalog = await loadInitialCatalog("tire");
  return (
    <Storefront
      initialKind="tire"
      initialCatalog={initialCatalog}
      heading={`Шины в ${location.cityPrepositional}`}
      intro="Летние, зимние и всесезонные шины с подбором по размеру и по автомобилю; фильтры по бренду, цене, шипам и RunFlat."
    />
  );
}

import type { Metadata } from "next";
import { Storefront } from "@/components/storefront";
import { businessConfig } from "@/config/business";
import { loadInitialCatalog } from "@/lib/api/initial-catalog";
import { createPageSeoMetadata } from "@/lib/structured-data";

// Incremental static regeneration: the HTML (with the first catalog page in
// database mode) is cached and rebuilt in the background at most every
// 5 minutes. See the note in app/shiny/page.tsx.
export const revalidate = 300;

export const metadata: Metadata = {
  ...createPageSeoMetadata("/"),
};

export default async function HomePage() {
  const initialCatalog = await loadInitialCatalog("all");
  return (
    <Storefront
      initialCatalog={initialCatalog}
      heading={`Шины и диски в ${businessConfig.location.cityPrepositional}`}
      intro="Летние, зимние и всесезонные шины и автомобильные диски с подбором по размеру и по автомобилю."
    />
  );
}

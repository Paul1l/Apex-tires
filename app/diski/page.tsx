import type { Metadata } from "next";
import { Storefront } from "@/components/storefront";
import { businessConfig } from "@/config/business";
import { loadInitialCatalog } from "@/lib/api/initial-catalog";
import { createPageSeoMetadata } from "@/lib/structured-data";

const { brandName, location } = businessConfig;

// Caching: see the note in app/shiny/page.tsx.
export const revalidate = 300;

export const metadata: Metadata = {
  title: `Купить диски в ${location.cityPrepositional}`,
  description: `Каталог автомобильных дисков ${brandName}: подбор по диаметру и по автомобилю в ${location.cityPrepositional}.`,
  ...createPageSeoMetadata("/diski"),
};

export default async function WheelsPage() {
  const initialCatalog = await loadInitialCatalog("wheel");
  return (
    <Storefront
      initialKind="wheel"
      initialCatalog={initialCatalog}
      heading={`Диски в ${location.cityPrepositional}`}
      intro="Автомобильные диски с подбором по диаметру и по автомобилю; фильтры по бренду, цене и наличию."
    />
  );
}

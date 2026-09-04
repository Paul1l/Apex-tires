import type { Metadata } from "next";
import { Storefront } from "@/components/storefront";
import { businessConfig } from "@/config/business";

export const metadata: Metadata = {
  title: `Купить шины в ${businessConfig.location.city}`,
  description: `Каталог шин ${businessConfig.brandName}: подбор по размеру и автомобилю в ${businessConfig.location.city}.`,
};

export default function TiresPage() {
  return <Storefront initialKind="tire" />;
}

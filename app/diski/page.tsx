import type { Metadata } from "next";
import { Storefront } from "@/components/storefront";
import { businessConfig } from "@/config/business";

export const metadata: Metadata = {
  title: `Купить диски в ${businessConfig.location.city}`,
  description: `Каталог автомобильных дисков ${businessConfig.brandName}: подбор по размеру и автомобилю в ${businessConfig.location.city}.`,
};

export default function WheelsPage() {
  return <Storefront initialKind="wheel" />;
}

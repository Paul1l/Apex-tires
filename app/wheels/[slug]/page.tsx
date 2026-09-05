import { ProductDetailsPage, productMetadata } from "@/components/product-details-page";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: PageProps) {
  return productMetadata((await params).slug, "wheel");
}
export default async function Page({ params }: PageProps) {
  return <ProductDetailsPage slug={(await params).slug} kind="wheel" />;
}

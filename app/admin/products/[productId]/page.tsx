import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ProductEditor } from "@/components/admin/product-editor";
import { getStaffPageAccess } from "@/server/security/staff-page-guard";

export const metadata: Metadata = {
  title: "Товар — панель управления",
  description: "Закрытый раздел для сотрудников магазина.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ created?: string | string[] }>;
};

export default async function EditProductPage({ params, searchParams }: PageProps) {
  const access = await getStaffPageAccess();
  // Sign-in, "not configured" and "no access" messages are shown by /admin.
  if (access.status !== "allowed") redirect("/admin");
  const { productId } = await params;
  if (!UUID_PATTERN.test(productId)) notFound();
  const { created } = await searchParams;
  return <ProductEditor productId={productId.toLowerCase()} created={created === "1"} />;
}

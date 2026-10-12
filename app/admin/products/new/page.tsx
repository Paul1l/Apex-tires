import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProductEditor } from "@/components/admin/product-editor";
import { getStaffPageAccess } from "@/server/security/staff-page-guard";

export const metadata: Metadata = {
  title: "Новый товар — панель управления",
  description: "Закрытый раздел для сотрудников магазина.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const access = await getStaffPageAccess();
  // Sign-in, "not configured" and "no access" messages are shown by /admin.
  if (access.status !== "allowed") redirect("/admin");
  return <ProductEditor productId={null} />;
}

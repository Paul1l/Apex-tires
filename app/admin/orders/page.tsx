import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrderPageShell } from "@/components/admin/order-page-shell";
import { OrdersSection } from "@/components/admin/orders-section";
import { toUrlSearchParams } from "@/lib/admin/order-list-query";
import { getStaffPageAccess } from "@/server/security/staff-page-guard";
import { orderListFiltersFromSearchParams } from "@/server/validators/admin-order-schema";

export const metadata: Metadata = {
  title: "Заказы — панель управления",
  description: "Закрытый раздел для сотрудников магазина.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await getStaffPageAccess();
  if (access.status !== "allowed") redirect("/admin");
  const filters = orderListFiltersFromSearchParams(toUrlSearchParams(await searchParams));
  return (
    <OrderPageShell backHref="/admin" backLabel="Панель управления" crumbs={["Заказы"]}>
      <OrdersSection initialFilters={filters} syncWithUrl />
    </OrderPageShell>
  );
}

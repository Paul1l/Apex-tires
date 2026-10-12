import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OrderDetails } from "@/components/admin/order-details";
import { OrderPageShell } from "@/components/admin/order-page-shell";
import pageStyles from "@/components/admin/order-page.module.css";
import { orderListQuerySuffix, toUrlSearchParams } from "@/lib/admin/order-list-query";
import type { AdminOrderDetails } from "@/lib/admin/order-types";
import { getStaffPageAccess } from "@/server/security/staff-page-guard";
import { createAdminOrderService } from "@/server/services/admin-order-factory";
import { applicationLogger } from "@/server/types/common";
import { isDatabaseUnavailableError } from "@/server/utils/errors";
import {
  canChangePaymentStatus,
  orderIdSchema,
  orderListFiltersFromSearchParams,
} from "@/server/validators/admin-order-schema";

export const metadata: Metadata = {
  title: "Заказ — панель управления",
  description: "Закрытый раздел для сотрудников магазина.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await getStaffPageAccess();
  if (access.status !== "allowed") redirect("/admin");

  // The list filters travel with the order link, so "back" restores the same list.
  const listFilters = orderListFiltersFromSearchParams(toUrlSearchParams(await searchParams));
  const backHref = `/admin/orders${orderListQuerySuffix(listFilters)}`;
  const parsedId = orderIdSchema.safeParse((await params).orderId);

  let order: AdminOrderDetails | null = null;
  let unavailable = false;
  if (parsedId.success) {
    try {
      order = await createAdminOrderService().getOrderDetails(parsedId.data.toLowerCase());
    } catch (error) {
      if (!isDatabaseUnavailableError(error)) throw error;
      applicationLogger.error({ error }, "Administrative order page: database unavailable");
      unavailable = true;
    }
  }

  return (
    <OrderPageShell
      backHref={backHref}
      backLabel="Назад к заказам"
      crumbs={["Заказы", order ? `Заказ ${order.number}` : "Заказ"]}
    >
      {order ? (
        <OrderDetails
          initialOrder={order}
          canChangePaymentStatus={canChangePaymentStatus(access.user.role)}
        />
      ) : (
        <article className={`admin-card ${pageStyles.message}`}>
          <h1>{unavailable ? "База данных временно недоступна" : "Заказ не найден"}</h1>
          <p>
            {unavailable
              ? "Повторите попытку через несколько минут."
              : "Проверьте ссылку или найдите заказ по номеру в списке заказов."}
          </p>
          <Link className="admin-primary-button" href={backHref}>
            Назад к заказам
          </Link>
        </article>
      )}
    </OrderPageShell>
  );
}

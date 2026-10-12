import type { Metadata } from "next";
import Link from "next/link";
import { AdminDashboard } from "@/components/admin-dashboard";
import { parseAdminSection } from "@/lib/admin/admin-sections";
import { StaffLoginForm } from "@/components/admin/staff-login-form";
import { getStaffPageAccess } from "@/server/security/staff-page-guard";

export const metadata: Metadata = {
  title: "Панель управления магазином",
  description: "Закрытый раздел для сотрудников магазина.",
  // Never indexed, on any deployment stage (robots.txt alone does not stop
  // indexing of a linked URL).
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function AccessMessage({ message }: { message: string }) {
  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <p className="eyebrow">Закрытая зона</p>
        <h1>Управление магазином</h1>
        <p>{message}</p>
        <Link className="admin-primary-button" href="/">
          Вернуться в магазин
        </Link>
      </section>
    </main>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const access = await getStaffPageAccess();
  if (access.status === "not_configured") {
    return (
      <AccessMessage message="PostgreSQL и серверные сессии пока не настроены. Демо-доступ отключён." />
    );
  }
  if (access.status === "allowed") {
    const { section } = await searchParams;
    return (
      <AdminDashboard
        authorizedUser={access.user}
        initialSection={parseAdminSection(section)}
      />
    );
  }
  // Signed out, or signed in only as a customer (email code): staff rights
  // need the authenticator sign-in.
  return (
    <main className="admin-login-page">
      <Link className="admin-back" href="/">
        ← В магазин
      </Link>
      <section className="admin-login-card" aria-labelledby="staff-login-title">
        <p className="eyebrow">Закрытая зона</p>
        <h1 id="staff-login-title">Вход для сотрудников</h1>
        <p>
          {access.status === "forbidden"
            ? "Вы вошли как покупатель. Для работы в админке войдите с кодом из приложения-аутентификатора."
            : "Введите рабочий email и 6-значный код из приложения-аутентификатора."}
        </p>
        <StaffLoginForm />
      </section>
    </main>
  );
}

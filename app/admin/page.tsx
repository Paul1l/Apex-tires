import Link from "next/link";
import { cookies } from "next/headers";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AUTHENTICATION_COOKIE_NAME } from "@/lib/auth/session";
import {
  authenticationSessionsAreConfigured,
  createApplicationServices,
} from "@/server/bootstrap/application-services";

export const metadata = {
  title: "Панель управления магазином",
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

export default async function AdminPage() {
  if (!authenticationSessionsAreConfigured()) {
    return (
      <AccessMessage message="PostgreSQL и серверные сессии пока не настроены. Демо-доступ отключён." />
    );
  }
  const sessionToken = (await cookies()).get(AUTHENTICATION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return <AccessMessage message="Войдите по коду из письма на главной странице." />;
  }
  const user =
    await createApplicationServices().authService?.getUserBySessionToken(
      sessionToken,
    );
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return <AccessMessage message="Для этой учетной записи доступ к админ-панели запрещён." />;
  }
  return <AdminDashboard authorizedUser={user} />;
}

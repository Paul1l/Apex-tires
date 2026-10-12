import Link from "next/link";
import { ArrowLeft, ChevronRight, LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";
import { businessConfig } from "@/config/business";
import styles from "./order-page.module.css";

const DASHBOARD_PATH = "/admin";

/**
 * Frame of the standalone admin order pages (/admin/orders, /admin/orders/[id]):
 * the top bar of the admin panel with a way back, without the dashboard sidebar.
 * The «Панель управления» button is shown only when the back link leads
 * elsewhere, so a page never has two links to /admin.
 */
export function OrderPageShell({
  backHref,
  backLabel,
  crumbs,
  children,
}: {
  backHref: string;
  backLabel: string;
  crumbs: string[];
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className="admin-topbar">
        <div className={styles.topbarStart}>
          <Link className={styles.backLink} href={backHref}>
            <ArrowLeft size={16} aria-hidden="true" /> {backLabel}
          </Link>
          <nav className="admin-breadcrumb" aria-label="Расположение">
            <span>{businessConfig.brandName} CONTROL</span>
            {crumbs.map((crumb, index) => (
              <span key={`${crumb}-${index}`} className={styles.crumb}>
                <ChevronRight size={13} aria-hidden="true" />
                {index === crumbs.length - 1 ? <strong aria-current="page">{crumb}</strong> : crumb}
              </span>
            ))}
          </nav>
        </div>
        {backHref !== DASHBOARD_PATH && (
          <div className="admin-topbar-actions">
            <Link className="admin-secondary-button" href={DASHBOARD_PATH}>
              <LayoutDashboard size={16} aria-hidden="true" /> Панель управления
            </Link>
          </div>
        )}
      </header>
      <div className="admin-content">{children}</div>
    </main>
  );
}

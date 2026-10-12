import Link from "next/link";
import { ArrowLeft, ChevronRight, LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";
import { businessConfig } from "@/config/business";
import styles from "./order-page.module.css";

/**
 * Frame of the standalone admin order pages (/admin/orders, /admin/orders/[id]):
 * the top bar of the admin panel with a way back, without the dashboard sidebar.
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
        <div className="admin-topbar-actions">
          <Link className="admin-secondary-button" href="/admin">
            <LayoutDashboard size={16} aria-hidden="true" /> Панель управления
          </Link>
        </div>
      </header>
      <div className="admin-content">{children}</div>
    </main>
  );
}

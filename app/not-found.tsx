import type { Metadata } from "next";
import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { businessConfig } from "@/config/business";
import styles from "./not-found.module.css";

// Rendered with HTTP 404 for unknown URLs and for notFound() in routes
// (/legal/<unknown>, /tires/<unknown>, /wheels/<unknown>).
export const metadata: Metadata = {
  title: "Страница не найдена",
  description: `Такой страницы нет в магазине шин и дисков ${businessConfig.brandName}.`,
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className="brand-logo" aria-label={`${businessConfig.brandName} — на главную`}>
          <span className="logo-mark"><i /><i /><i /></span>
          <BrandWordmark />
        </Link>
        <nav className={styles.nav} aria-label="Разделы магазина">
          <Link href="/shiny">Шины</Link>
          <Link href="/diski">Диски</Link>
          <Link href="/contacts">Контакты</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <p className={styles.code} aria-hidden="true">404</p>
        <h1 className={styles.title}>Страница не найдена</h1>
        <p className={styles.text}>
          Возможно, в адресе опечатка или ссылка устарела: товар мог закончиться
          и пропасть из каталога. Откройте каталог шин или дисков и подберите
          товар по размеру или по автомобилю.
        </p>
        <div className={styles.actions}>
          <Link className="primary-button" href="/shiny">Каталог шин</Link>
          <Link className="secondary-button" href="/diski">Каталог дисков</Link>
          <Link className="secondary-button" href="/">На главную</Link>
        </div>
        <p className={styles.help}>
          Не нашли нужное? <Link href="/contacts">Свяжитесь с магазином</Link>.
        </p>
      </main>
    </div>
  );
}

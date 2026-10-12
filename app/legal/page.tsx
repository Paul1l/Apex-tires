import type { Metadata } from "next";
import Link from "next/link";
import { businessConfig } from "@/config/business";
import { legalDocuments } from "@/lib/legal-documents";
import { createPageSeoMetadata } from "@/lib/structured-data";

export const metadata: Metadata = {
  title: "Правовая информация",
  description: `Документы интернет-магазина ${businessConfig.brandName}: оферта, доставка и возврат, персональные данные, реквизиты продавца.`,
  ...createPageSeoMetadata("/legal"),
};

export default function LegalDocumentsIndexPage() {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link href="/" className="legal-brand">
          {businessConfig.brandName}
        </Link>
        <Link href="/" className="legal-back-link">
          Вернуться в магазин
        </Link>
      </header>

      <section className="legal-hero">
        <p className="eyebrow">Правовая информация</p>
        <h1>Документы магазина</h1>
        {businessConfig.deploymentStage === "production" ? (
          <p>
            Условия покупки, доставки и возврата, правила обработки
            персональных данных и реквизиты продавца.
          </p>
        ) : (
          <p>
            Предварительная редакция документов. Реквизиты продавца и тексты
            будут уточнены и проверены до начала приёма заказов.
          </p>
        )}
      </section>

      <section className="legal-document-grid">
        {legalDocuments.map((document) => (
          <Link
            className="legal-document-card"
            href={`/legal/${document.slug}`}
            key={document.slug}
          >
            <span>{document.shortTitle}</span>
            <p>{document.description}</p>
            <strong>Открыть документ →</strong>
          </Link>
        ))}
      </section>
    </main>
  );
}

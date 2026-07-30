import Link from "next/link";
import { legalDocuments } from "@/lib/legal-documents";

export const metadata = {
  title: "Правовая информация — APEX WHEELS",
  description: "Документы интернет-магазина APEX WHEELS.",
};

export default function LegalDocumentsIndexPage() {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link href="/" className="legal-brand">
          APEX <span>WHEELS</span>
        </Link>
        <Link href="/" className="legal-back-link">
          Вернуться в магазин
        </Link>
      </header>

      <section className="legal-hero">
        <p className="eyebrow">Правовая информация</p>
        <h1>Документы магазина</h1>
        <p>
          Структура документов подготовлена к запуску. До публикации магазина
          владелец должен заполнить поля реквизитов и передать тексты на
          юридическую проверку.
        </p>
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

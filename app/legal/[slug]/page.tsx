import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  legalDocumentBySlug,
  legalDocuments,
  LEGAL_PLACEHOLDER,
} from "@/lib/legal-documents";

interface LegalDocumentPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return legalDocuments.map((document) => ({ slug: document.slug }));
}

export async function generateMetadata({
  params,
}: LegalDocumentPageProps): Promise<Metadata> {
  const { slug } = await params;
  const document = legalDocumentBySlug.get(slug);

  if (!document) {
    return {};
  }

  return {
    title: `${document.shortTitle} — APEX WHEELS`,
    description: document.description,
  };
}

export default async function LegalDocumentPage({
  params,
}: LegalDocumentPageProps) {
  const { slug } = await params;
  const document = legalDocumentBySlug.get(slug);

  if (!document) {
    notFound();
  }

  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link href="/" className="legal-brand">
          APEX <span>WHEELS</span>
        </Link>
        <nav aria-label="Навигация по юридическому разделу">
          <Link href="/legal">Все документы</Link>
          <Link href="/">В магазин</Link>
        </nav>
      </header>

      <article className="legal-article">
        <div className="legal-draft-notice">
          <strong>Проект документа</strong>
          <span>
            Реквизиты ИП еще не предоставлены. Поля «{LEGAL_PLACEHOLDER}»
            необходимо заполнить и проверить с юристом до приема реальных
            заказов.
          </span>
        </div>

        <header>
          <p className="eyebrow">Редакция от 31 июля 2026 года</p>
          <h1>{document.title}</h1>
          <p>{document.description}</p>
        </header>

        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.items && (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>
    </main>
  );
}

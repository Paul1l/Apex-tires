import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { businessConfig } from "@/config/business";
import {
  createLegalDocuments,
  legalDocumentBySlug,
  LEGAL_PLACEHOLDER,
} from "@/lib/legal-documents";
import { createPageSeoMetadata } from "@/lib/structured-data";
import { getSiteSettings } from "@/server/services/site-settings-service";

interface LegalDocumentPageProps {
  params: Promise<{ slug: string }>;
}

// Rendered on request, not prerendered: the texts include contacts, the store
// address, hours and delivery terms from the settings edited in the admin
// (one cached settings query per request, shared with the layout).
// Not ISR: with prerendered params and `dynamicParams = false`, saving the
// settings (revalidatePath("/", "layout")) expires these pages and Next.js
// 16 then answers them with 404 (NoFallbackError); with `dynamicParams = true`
// the 404 of every unknown slug would be written to the cache on disk.
// Unknown slugs get the root not-found page (404) from notFound() below.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: LegalDocumentPageProps): Promise<Metadata> {
  const { slug } = await params;
  const document = legalDocumentBySlug.get(slug);

  if (!document) {
    return {};
  }

  return {
    title: document.shortTitle,
    description: document.description,
    ...createPageSeoMetadata(`/legal/${document.slug}`),
  };
}

export default async function LegalDocumentPage({
  params,
}: LegalDocumentPageProps) {
  const { slug } = await params;
  const settings = await getSiteSettings();
  const document = createLegalDocuments(settings).find((item) => item.slug === slug);

  if (!document) {
    notFound();
  }

  // The draft notice is true only while the text still contains placeholders.
  const hasPlaceholders = JSON.stringify(document).includes(LEGAL_PLACEHOLDER);

  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link href="/" className="legal-brand">
          {businessConfig.brandName}
        </Link>
        <nav aria-label="Навигация по юридическому разделу">
          <Link href="/legal">Все документы</Link>
          <Link href="/">В магазин</Link>
        </nav>
      </header>

      <article className="legal-article">
        {hasPlaceholders && (
          <div className="legal-draft-notice">
            <strong>Проект документа</strong>
            <span>
              Реквизиты ИП еще не предоставлены. Поля «{LEGAL_PLACEHOLDER}»
              необходимо заполнить и проверить с юристом до приема реальных
              заказов.
            </span>
          </div>
        )}

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

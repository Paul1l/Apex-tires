import type { Metadata } from "next";
import Link from "next/link";
import { Clock, ExternalLink, Mail, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import { BrandWordmark } from "@/components/brand-wordmark";
import {
  businessConfig,
  getSellerDisplayName,
  normalizeTelephoneHref,
} from "@/config/business";
import { createPageSeoMetadata, formatWorkingHours } from "@/lib/structured-data";
import { getSiteSettings } from "@/server/services/site-settings-service";
import styles from "./contacts.module.css";

const { location } = businessConfig;

// Contacts, address and hours come from the settings edited in the admin:
// ISR instead of a page built once (see app/layout.tsx); saving the settings
// revalidates it at once.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Контакты",
  description: `Контакты магазина шин и дисков ${businessConfig.brandName} в ${location.cityPrepositional}: адрес, телефон, график работы.`,
  ...createPageSeoMetadata("/contacts"),
};

const PENDING_VALUE = "Уточняется";

function NewTabHint() {
  return <span className={styles.visuallyHidden}> (откроется в новой вкладке)</span>;
}

export default async function ContactsPage() {
  const settings = await getSiteSettings();
  const sellerName = businessConfig.businessName ?? getSellerDisplayName();
  const { phone, email, whatsapp, telegram } = settings.contacts;
  const { address, twoGisUrl } = settings.location;
  const hasContacts = Boolean(phone || email || address);
  const workingHours = formatWorkingHours(settings.workingHours);

  return (
    <main className="contacts-page">
      <header className={styles.header}>
        <Link href="/" className="brand-logo" aria-label={`${businessConfig.brandName} — на главную`}>
          <span className="logo-mark"><i /><i /><i /></span>
          <BrandWordmark />
        </Link>
        <nav className={styles.nav} aria-label="Разделы магазина">
          <Link href="/shiny">Шины</Link>
          <Link href="/diski">Диски</Link>
          <Link href="/legal">Документы</Link>
        </nav>
      </header>

      <section className="contacts-hero">
        <p className="eyebrow">Связь с магазином</p>
        <h1>Контакты</h1>
        <p className={styles.lead}>
          {sellerName ?? businessConfig.brandName} · магазин шин и дисков в {location.cityPrepositional}
        </p>
      </section>

      {!hasContacts && (
        <p className={styles.pendingNotice} role="note">
          Адрес, телефон и график работы уточняются и появятся на этой странице
          после подтверждения.
          {twoGisUrl ? " Пока можно открыть карточку магазина в 2ГИС." : ""}
        </p>
      )}

      <section className="contacts-grid" aria-label="Контактные данные">
        <article>
          <MapPin aria-hidden="true" />
          <span>Адрес</span>
          {address ? <strong>{address}</strong> : <strong className={styles.pending}>{PENDING_VALUE}</strong>}
        </article>
        <article>
          <Phone aria-hidden="true" />
          <span>Телефон</span>
          {phone ? (
            <a href={normalizeTelephoneHref(phone)}>{phone}</a>
          ) : (
            <strong className={styles.pending}>{PENDING_VALUE}</strong>
          )}
        </article>
        <article>
          <Mail aria-hidden="true" />
          <span>Email</span>
          {email ? (
            <a href={`mailto:${email}`}>{email}</a>
          ) : (
            <strong className={styles.pending}>{PENDING_VALUE}</strong>
          )}
        </article>
        <article>
          <Clock aria-hidden="true" />
          <span>График работы</span>
          {workingHours ? (
            <strong>{workingHours}</strong>
          ) : (
            <strong className={styles.pending}>{PENDING_VALUE}</strong>
          )}
        </article>
      </section>

      <div className="contacts-actions">
        {twoGisUrl && (
          <a className="primary-button" href={twoGisUrl} rel="noopener noreferrer" target="_blank">
            <Navigation size={18} aria-hidden="true" /> Открыть в 2ГИС
            <ExternalLink size={15} aria-hidden="true" />
            <NewTabHint />
          </a>
        )}
        {whatsapp && (
          <a className="secondary-button" href={whatsapp} rel="noopener noreferrer" target="_blank">
            <MessageCircle size={18} aria-hidden="true" /> Написать в WhatsApp
            <NewTabHint />
          </a>
        )}
        {telegram && (
          <a className="secondary-button" href={telegram} rel="noopener noreferrer" target="_blank">
            <MessageCircle size={18} aria-hidden="true" /> Написать в Telegram
            <NewTabHint />
          </a>
        )}
        <Link className="secondary-button" href="/">Перейти в каталог</Link>
      </div>

      <nav className="mobile-contact-actions" aria-label="Быстрые действия">
        {phone && <a href={normalizeTelephoneHref(phone)}><Phone aria-hidden="true" />Позвонить</a>}
        {whatsapp && <a href={whatsapp} rel="noopener noreferrer" target="_blank"><MessageCircle aria-hidden="true" />WhatsApp</a>}
        {twoGisUrl && <a href={twoGisUrl} rel="noopener noreferrer" target="_blank"><Navigation aria-hidden="true" />2ГИС</a>}
        <Link href="/">Каталог</Link>
      </nav>
    </main>
  );
}

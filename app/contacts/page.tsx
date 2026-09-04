import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import { BrandWordmark } from "@/components/brand-wordmark";
import {
  businessConfig,
  getSellerDisplayName,
  normalizeTelephoneHref,
} from "@/config/business";

export const metadata: Metadata = {
  title: "Контакты",
  description: `Контакты магазина шин и дисков в ${businessConfig.location.city}.`,
};

export default function ContactsPage() {
  const sellerName = businessConfig.businessName ?? getSellerDisplayName();
  const hasContacts = Boolean(
    businessConfig.contacts.phone ||
      businessConfig.contacts.email ||
      businessConfig.location.address,
  );

  return (
    <main className="contacts-page">
      <header className="legal-header">
        <Link href="/" className="brand-logo">
          <span className="logo-mark"><i /><i /><i /></span>
          <BrandWordmark />
        </Link>
        <Link href="/">Вернуться в каталог</Link>
      </header>

      <section className="contacts-hero">
        <p className="eyebrow">Связь с магазином</p>
        <h1>Контакты</h1>
        <p>{sellerName ?? businessConfig.brandName} · {businessConfig.location.city}</p>
      </section>

      {!hasContacts && (
        <div className="legal-draft-notice contacts-notice">
          <strong>Предварительная версия</strong>
          <span>Адрес, телефон, email и график работы еще не предоставлены владельцем и не публикуются как вымышленные данные.</span>
        </div>
      )}

      <section className="contacts-grid">
        {businessConfig.location.address && (
          <article><MapPin /><span>Адрес</span><strong>{businessConfig.location.address}</strong></article>
        )}
        {businessConfig.contacts.phone && (
          <article><Phone /><span>Телефон</span><a href={normalizeTelephoneHref(businessConfig.contacts.phone)}>{businessConfig.contacts.phone}</a></article>
        )}
        {businessConfig.contacts.email && (
          <article><Mail /><span>Email</span><a href={`mailto:${businessConfig.contacts.email}`}>{businessConfig.contacts.email}</a></article>
        )}
        {businessConfig.workingHours && (
          <article><span>График</span><strong>{businessConfig.workingHours}</strong></article>
        )}
      </section>

      <div className="contacts-actions">
        {businessConfig.location.twoGisUrl && (
          <a className="primary-button" href={businessConfig.location.twoGisUrl} rel="noreferrer" target="_blank"><Navigation size={18} /> Построить маршрут</a>
        )}
        {businessConfig.contacts.whatsapp && (
          <a className="secondary-button" href={businessConfig.contacts.whatsapp} rel="noreferrer" target="_blank"><MessageCircle size={18} /> Написать в WhatsApp</a>
        )}
        {businessConfig.contacts.telegram && (
          <a className="secondary-button" href={businessConfig.contacts.telegram} rel="noreferrer" target="_blank"><MessageCircle size={18} /> Написать в Telegram</a>
        )}
      </div>

      <div className="mobile-contact-actions">
        {businessConfig.contacts.phone && <a href={normalizeTelephoneHref(businessConfig.contacts.phone)}><Phone />Позвонить</a>}
        {businessConfig.contacts.whatsapp && <a href={businessConfig.contacts.whatsapp}><MessageCircle />WhatsApp</a>}
        {businessConfig.location.twoGisUrl && <a href={businessConfig.location.twoGisUrl}><Navigation />Маршрут</a>}
        <Link href="/#catalog">Каталог</Link>
      </div>
    </main>
  );
}

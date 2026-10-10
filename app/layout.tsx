import type { Metadata } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { PrivacyTools } from "@/components/privacy-tools";
import { StoreProvider } from "@/components/store-provider";
import { businessConfig } from "@/config/business";
import { createBaseOpenGraph, createSiteJsonLd, serializeJsonLd } from "@/lib/structured-data";
import "./globals.css";

const manrope = Manrope({
  subsets: ["cyrillic", "latin"],
  variable: "--font-manrope",
  display: "swap",
});

const unbounded = Unbounded({
  subsets: ["cyrillic", "latin"],
  variable: "--font-display",
  display: "swap",
});

const { brandName, location } = businessConfig;

// No `alternates.canonical` and no `openGraph.url` here: both would be
// inherited by every page that does not set its own (admin, 404). Each
// indexable page sets them through createPageSeoMetadata().
export const metadata: Metadata = {
  metadataBase: businessConfig.siteUrl
    ? new URL(businessConfig.siteUrl)
    : undefined,
  title: {
    default: `${brandName} — шины и диски в ${location.cityPrepositional}`,
    template: `%s — ${brandName}`,
  },
  description:
    `Каталог шин и дисков в ${location.cityPrepositional}: подбор по размеру и по автомобилю.`,
  applicationName: brandName,
  icons: { icon: businessConfig.branding.faviconSource },
  // Preview (demo prices): noindex in HTML; robots.txt allows crawling so
  // that search engines can read this tag (see app/robots.ts).
  robots:
    businessConfig.deploymentStage === "production"
      ? { index: true, follow: true }
      : { index: false, follow: false },
  openGraph: createBaseOpenGraph(),
  twitter: {
    card: businessConfig.branding.openGraphImageSource ? "summary_large_image" : "summary",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = createSiteJsonLd();

  return (
    <html lang="ru">
      <body className={`${manrope.variable} ${unbounded.variable}`}>
        {structuredData && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
          />
        )}
        <StoreProvider>
          {children}
          <PrivacyTools />
        </StoreProvider>
      </body>
    </html>
  );
}

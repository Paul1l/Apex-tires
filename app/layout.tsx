import type { Metadata } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { PrivacyTools } from "@/components/privacy-tools";
import { SiteSettingsProvider } from "@/components/site-settings-provider";
import { StoreProvider } from "@/components/store-provider";
import { businessConfig } from "@/config/business";
import { createBaseOpenGraph, createSiteJsonLd, serializeJsonLd } from "@/lib/structured-data";
import { getSiteSettings } from "@/server/services/site-settings-service";
import "./globals.css";

// Fonts (PERF-04). Both are variable fonts: one file per alphabet covers
// every weight in use (Manrope 400–800, Unbounded 500–800); listing weights
// would switch to one static file per weight. All alphabets stay available
// through @font-face (loaded only when a page uses them, e.g. latin-ext for
// "₽"); `subsets` only selects the files preloaded for the first screen:
// - Manrope cyrillic + latin: body text (latin holds spaces, digits, punctuation);
// - Unbounded cyrillic: the hero headline. The 50 KB latin file (the "APEX"
//   wordmark and punctuation) loads from CSS without competing with the hero
//   image for bandwidth.
const manrope = Manrope({
  subsets: ["cyrillic", "latin"],
  variable: "--font-manrope",
  display: "swap",
});

const unbounded = Unbounded({
  subsets: ["cyrillic"],
  variable: "--font-display",
  display: "swap",
});

const { brandName, location } = businessConfig;

// Every page shows store data edited in the admin (contacts, hours, delivery,
// services: getSiteSettings below), so no page stays with the values of the
// build forever: pages that were static become ISR and are rebuilt in the
// background at most every 5 minutes (one settings query per rebuild). Saving
// the settings in the admin revalidates the whole site at once
// (revalidatePath("/", "layout")). Pages with their own shorter interval or
// dynamic rendering keep it.
export const revalidate = 300;

// Icons come from app/favicon.ico, app/icon.svg (the header mark) and
// app/apple-icon.png. Next.js emits these file-based icons only while
// `metadata.icons` is unset, so it is set only for a favicon the owner
// configured (NEXT_PUBLIC_FAVICON_SOURCE).
const configuredFavicon =
  businessConfig.branding.faviconSource !== "/icon.svg"
    ? businessConfig.branding.faviconSource
    : null;

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
  ...(configuredFavicon
    ? { icons: { icon: configuredFavicon, apple: "/apple-icon.png" } }
    : {}),
  // Preview (demo prices): noindex in HTML; robots.txt allows crawling so
  // that search engines can read this tag (see app/robots.ts).
  robots:
    businessConfig.deploymentStage === "production"
      ? { index: true, follow: true }
      : { index: false, follow: false },
  // Always with an image: the configured one or app/opengraph-image.jpg.
  openGraph: createBaseOpenGraph(),
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // One query per request (React cache, shared with the page); defaults from
  // the build without a database or when it is unavailable.
  const settings = await getSiteSettings();
  const structuredData = createSiteJsonLd(businessConfig, settings);

  return (
    <html lang="ru">
      <body className={`${manrope.variable} ${unbounded.variable}`}>
        {structuredData && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
          />
        )}
        {/* Plain JSON for client components (useSiteSettings). */}
        <SiteSettingsProvider settings={settings}>
          <StoreProvider>
            {/* First in the DOM (A11Y-10): the cookie banner is fixed at the
                bottom of the screen, but keyboard and screen reader users reach
                it first instead of after the whole page. */}
            <PrivacyTools />
            {children}
          </StoreProvider>
        </SiteSettingsProvider>
      </body>
    </html>
  );
}

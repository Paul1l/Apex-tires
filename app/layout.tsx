import type { Metadata } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { PrivacyTools } from "@/components/privacy-tools";
import { StoreProvider } from "@/components/store-provider";
import { businessConfig, getSellerDisplayName } from "@/config/business";
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

export const metadata: Metadata = {
  metadataBase: businessConfig.siteUrl
    ? new URL(businessConfig.siteUrl)
    : undefined,
  title: {
    default: `${businessConfig.brandName} — шины и диски в ${businessConfig.location.city}`,
    template: `%s — ${businessConfig.brandName}`,
  },
  description:
    `Каталог шин и дисков с подбором по размерам и автомобилю в ${businessConfig.location.city}.`,
  icons: { icon: businessConfig.branding.faviconSource },
  robots:
    businessConfig.deploymentStage === "production"
      ? { index: true, follow: true }
      : { index: false, follow: false },
  openGraph: businessConfig.branding.openGraphImageSource
    ? { images: [businessConfig.branding.openGraphImageSource] }
    : undefined,
};

function createLocalBusinessStructuredData() {
  const sellerName = businessConfig.businessName ?? getSellerDisplayName();
  const { address, latitude, longitude } = businessConfig.location;
  const { phone, email } = businessConfig.contacts;
  if (!sellerName || !address || !phone || !email) return null;

  return {
    "@context": "https://schema.org",
    "@type": "AutoPartsStore",
    name: sellerName,
    telephone: phone,
    email,
    address: {
      "@type": "PostalAddress",
      streetAddress: address,
      addressLocality: businessConfig.location.city,
      addressCountry: "RU",
    },
    ...(latitude !== null && longitude !== null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude,
            longitude,
          },
        }
      : {}),
    ...(businessConfig.workingHours
      ? { openingHours: businessConfig.workingHours }
      : {}),
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = createLocalBusinessStructuredData();

  return (
    <html lang="ru">
      <body className={`${manrope.variable} ${unbounded.variable}`}>
        {structuredData && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
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

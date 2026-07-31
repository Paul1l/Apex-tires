import type { Metadata } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { PrivacyTools } from "@/components/privacy-tools";
import { StoreProvider } from "@/components/store-provider";
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
  title: "Apex Wheels — шины и диски",
  description:
    "Премиальный подбор шин и дисков по параметрам и автомобилю в Кемерово. Доставка, шиномонтаж и проверка совместимости.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${manrope.variable} ${unbounded.variable}`}>
        <StoreProvider>
          {children}
          <PrivacyTools />
        </StoreProvider>
      </body>
    </html>
  );
}

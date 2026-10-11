import type { MetadataRoute } from "next";
import { businessConfig } from "@/config/business";

// Colours of the design tokens in app/globals.css (--paper is the header and
// page background).
const PAPER = "#f4f2ec";

/**
 * Web app manifest (/manifest.webmanifest): name and icons for "Add to Home
 * Screen". The icons are the header mark (app/icon.svg) rendered to PNG;
 * the maskable one keeps the circle inside the 80% safe zone.
 */
export default function manifest(): MetadataRoute.Manifest {
  const { brandName, location } = businessConfig;
  return {
    name: brandName,
    short_name: brandName,
    description: `Шины и диски в ${location.cityPrepositional}: подбор по размеру и по автомобилю.`,
    lang: "ru",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    // A shop page in a regular browser tab: no app-like window without the address bar.
    display: "browser",
    background_color: PAPER,
    theme_color: PAPER,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

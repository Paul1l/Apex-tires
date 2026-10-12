"use client";

import { createContext, useContext } from "react";
import type { SiteSettings } from "@/lib/site-settings";

/**
 * Store data edited in the admin (contacts, address, working hours, delivery,
 * services) for client components. app/layout.tsx reads the saved settings on
 * the server (`getSiteSettings()`: defaults without a database) and passes
 * them here as plain JSON; client components read them with
 * `useSiteSettings()` instead of the build-time `businessConfig`.
 *
 * Brand, city, seller requisites and catalog modes are not settings: they
 * stay in `businessConfig` (environment).
 */
const SiteSettingsContext = createContext<SiteSettings | null>(null);

export function SiteSettingsProvider({
  settings,
  children,
}: React.PropsWithChildren<{ settings: SiteSettings }>) {
  return <SiteSettingsContext.Provider value={settings}>{children}</SiteSettingsContext.Provider>;
}

export function useSiteSettings(): SiteSettings {
  const settings = useContext(SiteSettingsContext);
  if (!settings) throw new Error("useSiteSettings must be used inside SiteSettingsProvider");
  return settings;
}

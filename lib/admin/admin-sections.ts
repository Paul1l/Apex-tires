/** Sections of the admin dashboard, selectable by /admin?section=… */
export const ADMIN_SECTIONS = [
  "overview",
  "products",
  "orders",
  "fitment-requests",
  "sync",
  "staff",
  "settings",
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export function parseAdminSection(value: unknown): AdminSection {
  return ADMIN_SECTIONS.find((section) => section === value) ?? "overview";
}

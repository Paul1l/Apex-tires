import { businessConfig, type BusinessConfig } from "../config/business";

/**
 * Store data that staff edit in the admin (wave T23). Stored in
 * store_settings under SITE_SETTINGS_KEY; values missing there fall back to
 * the build-time configuration (NEXT_PUBLIC_* variables), so preview builds
 * and a database without saved settings behave exactly as before.
 *
 * Not editable here: legal requisites, brand, city, catalog and deployment
 * flags — they stay in the environment.
 */
export const SITE_SETTINGS_KEY = "site_settings";

export interface DeliveryOptionSettings {
  enabled: boolean;
  rules: string | null;
}

export interface SiteSettings {
  contacts: {
    phone: string | null;
    additionalPhones: string[];
    email: string | null;
    supportEmail: string | null;
    whatsapp: string | null;
    telegram: string | null;
    vk: string | null;
  };
  location: {
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    twoGisUrl: string;
  };
  workingHours: string | null;
  delivery: {
    pickup: DeliveryOptionSettings;
    cityDelivery: DeliveryOptionSettings;
    regionalDelivery: DeliveryOptionSettings;
  };
  services: {
    tireService: boolean;
    tireStorage: boolean;
    balancing: boolean;
    installation: boolean;
    other: string[];
  };
}

export function getDefaultSiteSettings(
  config: BusinessConfig = businessConfig,
): SiteSettings {
  return {
    contacts: {
      phone: config.contacts.phone,
      additionalPhones: [...config.contacts.additionalPhones],
      email: config.contacts.email,
      supportEmail: config.contacts.supportEmail,
      whatsapp: config.contacts.whatsapp,
      telegram: config.contacts.telegram,
      vk: config.social.vk,
    },
    location: {
      address: config.location.address,
      latitude: config.location.latitude,
      longitude: config.location.longitude,
      twoGisUrl: config.location.twoGisUrl,
    },
    workingHours: config.workingHours,
    delivery: {
      pickup: { ...config.delivery.pickup },
      cityDelivery: { ...config.delivery.cityDelivery },
      regionalDelivery: { ...config.delivery.regionalDelivery },
    },
    services: { ...config.services, other: [...config.services.other] },
  };
}

/** Address for staff notifications (orders, fitment requests). */
export function getManagerNotificationEmail(
  settings: Pick<SiteSettings, "contacts">,
): string | undefined {
  return settings.contacts.supportEmail ?? settings.contacts.email ?? undefined;
}

export type AvailabilityDisplayMode =
  | "exact"
  | "limited"
  | "available"
  | "on_request"
  | "out_of_stock";

export type DeploymentStage = "preview" | "production";

function optionalValue(value: string | undefined): string | null {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : null;
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function coordinate(value: string | undefined): number | null {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

const configuredAvailabilityMode =
  process.env.NEXT_PUBLIC_AVAILABILITY_DISPLAY_MODE;
const availabilityModes: AvailabilityDisplayMode[] = [
  "exact",
  "limited",
  "available",
  "on_request",
  "out_of_stock",
];

export const BUSINESS_DATA_PLACEHOLDER = "[ТРЕБУЕТСЯ ЗАПОЛНИТЬ]";

export const businessConfig = {
  deploymentStage: (
    process.env.NEXT_PUBLIC_DEPLOYMENT_STAGE === "production"
      ? "production"
      : "preview"
  ) as DeploymentStage,
  businessName: optionalValue(process.env.NEXT_PUBLIC_BUSINESS_NAME),
  siteUrl: optionalValue(process.env.NEXT_PUBLIC_SITE_URL),
  brandName:
    optionalValue(process.env.NEXT_PUBLIC_BRAND_NAME) ?? "APEX WHEELS",
  seller: {
    legalName: optionalValue(process.env.NEXT_PUBLIC_SELLER_LEGAL_NAME),
    lastName: optionalValue(process.env.NEXT_PUBLIC_SELLER_LAST_NAME),
    firstName: optionalValue(process.env.NEXT_PUBLIC_SELLER_FIRST_NAME),
    patronymic: optionalValue(process.env.NEXT_PUBLIC_SELLER_PATRONYMIC),
    inn: optionalValue(process.env.NEXT_PUBLIC_SELLER_INN),
    ogrnip: optionalValue(process.env.NEXT_PUBLIC_SELLER_OGRNIP),
    legalAddress: optionalValue(
      process.env.NEXT_PUBLIC_SELLER_LEGAL_ADDRESS,
    ),
    actualAddress: optionalValue(
      process.env.NEXT_PUBLIC_SELLER_ACTUAL_ADDRESS,
    ),
    returnAddress: optionalValue(
      process.env.NEXT_PUBLIC_SELLER_RETURN_ADDRESS,
    ),
  },
  contacts: {
    phone: optionalValue(process.env.NEXT_PUBLIC_CONTACT_PHONE),
    additionalPhones: (process.env.NEXT_PUBLIC_ADDITIONAL_PHONES ?? "")
      .split(",")
      .map((phone) => phone.trim())
      .filter(Boolean),
    email: optionalValue(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
    supportEmail: optionalValue(process.env.NEXT_PUBLIC_SUPPORT_EMAIL),
    whatsapp: optionalValue(process.env.NEXT_PUBLIC_WHATSAPP_URL),
    telegram: optionalValue(process.env.NEXT_PUBLIC_TELEGRAM_URL),
  },
  location: {
    city: "Барнаул",
    address: optionalValue(process.env.NEXT_PUBLIC_STORE_ADDRESS),
    latitude: coordinate(process.env.NEXT_PUBLIC_STORE_LATITUDE),
    longitude: coordinate(process.env.NEXT_PUBLIC_STORE_LONGITUDE),
    twoGisUrl: optionalValue(process.env.NEXT_PUBLIC_TWO_GIS_URL),
  },
  workingHours: optionalValue(process.env.NEXT_PUBLIC_WORKING_HOURS),
  delivery: {
    pickup: {
      enabled: enabled(process.env.NEXT_PUBLIC_PICKUP_ENABLED),
      rules: optionalValue(process.env.NEXT_PUBLIC_PICKUP_RULES),
    },
    cityDelivery: {
      enabled: enabled(process.env.NEXT_PUBLIC_CITY_DELIVERY_ENABLED),
      rules: optionalValue(process.env.NEXT_PUBLIC_CITY_DELIVERY_RULES),
    },
    regionalDelivery: {
      enabled: enabled(process.env.NEXT_PUBLIC_REGIONAL_DELIVERY_ENABLED),
      rules: optionalValue(process.env.NEXT_PUBLIC_REGIONAL_DELIVERY_RULES),
    },
  },
  services: {
    tireService: enabled(process.env.NEXT_PUBLIC_TIRE_SERVICE_ENABLED),
    tireStorage: enabled(process.env.NEXT_PUBLIC_TIRE_STORAGE_ENABLED),
    balancing: enabled(process.env.NEXT_PUBLIC_BALANCING_ENABLED),
    installation: enabled(process.env.NEXT_PUBLIC_INSTALLATION_ENABLED),
    other: (process.env.NEXT_PUBLIC_OTHER_SERVICES ?? "")
      .split(",")
      .map((service) => service.trim())
      .filter(Boolean),
  },
  social: {
    vk: optionalValue(process.env.NEXT_PUBLIC_VK_URL),
    telegram: optionalValue(process.env.NEXT_PUBLIC_TELEGRAM_URL),
    whatsapp: optionalValue(process.env.NEXT_PUBLIC_WHATSAPP_URL),
    twoGis: optionalValue(process.env.NEXT_PUBLIC_TWO_GIS_URL),
  },
  catalog: {
    dataMode:
      process.env.NEXT_PUBLIC_CATALOG_DATA_MODE === "database"
        ? "database"
        : "preview",
    usedProductsEnabled: enabled(
      process.env.NEXT_PUBLIC_USED_PRODUCTS_ENABLED,
    ),
    ratingsEnabled: enabled(process.env.NEXT_PUBLIC_RATINGS_ENABLED),
    availabilityDisplayMode: availabilityModes.includes(
      configuredAvailabilityMode as AvailabilityDisplayMode,
    )
      ? (configuredAvailabilityMode as AvailabilityDisplayMode)
      : "on_request",
  },
  features: {
    installmentEnabled: enabled(
      process.env.NEXT_PUBLIC_INSTALLMENT_ENABLED,
    ),
  },
  branding: {
    logoSource: optionalValue(process.env.NEXT_PUBLIC_LOGO_SOURCE),
    faviconSource:
      optionalValue(process.env.NEXT_PUBLIC_FAVICON_SOURCE) ?? "/icon.svg",
    openGraphImageSource: optionalValue(
      process.env.NEXT_PUBLIC_OPEN_GRAPH_IMAGE_SOURCE,
    ),
  },
} as const;

export type BusinessConfig = typeof businessConfig;

export function getSellerDisplayName(
  config: BusinessConfig = businessConfig,
): string | null {
  if (config.seller.legalName) return config.seller.legalName;
  const personName = [
    config.seller.lastName,
    config.seller.firstName,
    config.seller.patronymic,
  ]
    .filter(Boolean)
    .join(" ");
  return personName || null;
}

export function getPublicBusinessValue(value: string | null): string {
  return value ?? BUSINESS_DATA_PLACEHOLDER;
}

export function normalizeTelephoneHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

export function getEnabledDeliveryMethods(
  config: BusinessConfig = businessConfig,
): Array<"pickup" | "courier" | "transport_company"> {
  const methods: Array<"pickup" | "courier" | "transport_company"> = [];
  if (config.delivery.pickup.enabled) methods.push("pickup");
  if (config.delivery.cityDelivery.enabled) methods.push("courier");
  if (config.delivery.regionalDelivery.enabled) methods.push("transport_company");
  return methods;
}

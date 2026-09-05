import {
  BUSINESS_DATA_PLACEHOLDER,
  getSellerDisplayName,
  type BusinessConfig,
} from "./business";

export interface BusinessConfigIssue {
  field: string;
  message: string;
}

const suspiciousPlaceholderPattern =
  /(иванов|123456789|999.?999|example\.(?:ru|com)|заполнить|placeholder|тест)/iu;

function isMissingOrPlaceholder(value: string | null): boolean {
  return (
    !value ||
    value === BUSINESS_DATA_PLACEHOLDER ||
    suspiciousPlaceholderPattern.test(value)
  );
}

export function validateBusinessConfig(
  config: BusinessConfig,
): BusinessConfigIssue[] {
  const issues: BusinessConfigIssue[] = [];
  const requireValue = (field: string, value: string | null, label: string) => {
    if (isMissingOrPlaceholder(value)) {
      issues.push({ field, message: `Не заполнено: ${label}.` });
    }
  };

  requireValue("businessName", config.businessName, "официальное название");
  requireValue("siteUrl", config.siteUrl, "production URL сайта");
  requireValue("seller", getSellerDisplayName(config), "продавец");
  requireValue("seller.inn", config.seller.inn, "ИНН");
  requireValue("seller.ogrnip", config.seller.ogrnip, "ОГРНИП");
  requireValue("contacts.phone", config.contacts.phone, "телефон");
  requireValue("contacts.email", config.contacts.email, "email");
  requireValue("location.address", config.location.address, "адрес магазина");

  if (config.seller.inn && !/^\d{10}(?:\d{2})?$/.test(config.seller.inn)) {
    issues.push({ field: "seller.inn", message: "ИНН должен содержать 10 или 12 цифр." });
  }
  if (config.seller.ogrnip && !/^\d{15}$/.test(config.seller.ogrnip)) {
    issues.push({ field: "seller.ogrnip", message: "ОГРНИП должен содержать 15 цифр." });
  }
  if (
    config.contacts.phone &&
    !/^\+7\d{10}$/.test(config.contacts.phone.replace(/[\s()-]/g, ""))
  ) {
    issues.push({ field: "contacts.phone", message: "Нужен российский телефон в формате +7XXXXXXXXXX." });
  }
  if (
    config.contacts.email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.contacts.email)
  ) {
    issues.push({ field: "contacts.email", message: "Укажите корректный email." });
  }
  if (config.catalog.dataMode !== "database") {
    issues.push({ field: "catalog.dataMode", message: "Production-каталог должен получать товары из базы данных." });
  }
  if (
    config.marketing.rating !== null &&
    (config.marketing.rating < 0 || config.marketing.rating > 5)
  ) {
    issues.push({ field: "marketing.rating", message: "Рейтинг должен быть от 0 до 5." });
  }
  for (const [field, value] of [
    ["marketing.yearsExperience", config.marketing.yearsExperience],
    ["marketing.clientCount", config.marketing.clientCount],
    ["marketing.returnDays", config.marketing.returnDays],
  ] as const) {
    if (value !== null && !Number.isInteger(value)) {
      issues.push({ field, message: "Подтверждённый показатель должен быть целым числом." });
    }
  }
  if (config.features.installmentEnabled) {
    issues.push({
      field: "features.installmentEnabled",
      message: "Рассрочку нельзя включить до подключения реального PaymentProvider.",
    });
  }

  return issues;
}

export function assertProductionBusinessConfig(
  config: BusinessConfig,
): void {
  if (config.deploymentStage !== "production") return;

  const issues = validateBusinessConfig(config);
  if (issues.length > 0) {
    throw new Error(
      `Production deployment заблокирован: ${issues.map((issue) => issue.message).join(" ")}`,
    );
  }
}

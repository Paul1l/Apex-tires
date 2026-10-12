import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BUSINESS_DATA_PLACEHOLDER,
  businessConfig,
  getEnabledDeliveryMethods,
  type BusinessConfig,
} from "../../config/business.js";
import { SiteSettingsProvider, useSiteSettings } from "../../components/site-settings-provider.js";
import { createLegalDocuments, legalDocuments, LEGAL_PLACEHOLDER } from "../../lib/legal-documents.js";
import { getDefaultSiteSettings, type SiteSettings } from "../../lib/site-settings.js";
import { parseStoredSiteSettings } from "../services/site-settings-service.js";

/** Settings as saved in the admin; every store value differs from the build. */
function savedSettings(): SiteSettings {
  return {
    contacts: {
      phone: "+7 (3852) 55-44-33",
      additionalPhones: ["+7 (3852) 55-44-34"],
      email: "shop@apex-barnaul.ru",
      supportEmail: "care@apex-barnaul.ru",
      whatsapp: "https://wa.me/73852554433",
      telegram: "https://t.me/apex_barnaul",
      vk: "https://vk.com/apex_barnaul",
    },
    location: {
      address: "ул. Попова, 1",
      latitude: 53.37,
      longitude: 83.75,
      twoGisUrl: "https://2gis.ru/barnaul/firm/70000001036958402",
    },
    workingHours: "Mo-Fr 09:00-19:00; Sa 10:00-16:00",
    delivery: {
      pickup: { enabled: false, rules: "Склад на ул. Попова, 1, после звонка менеджера" },
      cityDelivery: { enabled: false, rules: null },
      regionalDelivery: { enabled: true, rules: "Транспортной компанией по Алтайскому краю" },
    },
    services: { tireService: true, tireStorage: false, balancing: true, installation: false, other: [] },
  };
}

/** Build-time configuration with its own (different) contacts and seller requisites. */
function buildConfig(): BusinessConfig {
  return {
    ...businessConfig,
    seller: {
      ...businessConfig.seller,
      lastName: "Петров",
      firstName: "Сергей",
      patronymic: "Олегович",
      inn: "222100000000",
      ogrnip: "322220000000000",
      legalAddress: null,
      actualAddress: null,
      returnAddress: "г. Барнаул, ул. Возвратная, 5",
    },
    contacts: {
      ...businessConfig.contacts,
      phone: "+7 (3852) 00-00-09",
      email: "build@apex-barnaul.ru",
      supportEmail: "build-support@apex-barnaul.ru",
    },
    location: { ...businessConfig.location, address: "ул. Сборочная, 9" },
    workingHours: "Пн–Вс 00:00–24:00",
    delivery: {
      pickup: { enabled: true, rules: "Правила самовывоза из сборки" },
      cityDelivery: { enabled: true, rules: "Правила доставки из сборки" },
      regionalDelivery: { enabled: false, rules: null },
    },
  } as BusinessConfig;
}

function documentText(documents: ReturnType<typeof createLegalDocuments>, slug: string): string {
  const document = documents.find((item) => item.slug === slug);
  assert.ok(document, `document ${slug}`);
  return document.sections
    .flatMap((section) => [section.heading, ...(section.paragraphs ?? []), ...(section.items ?? [])])
    .join("\n");
}

test("legal documents take contacts, address, hours and delivery terms from the saved settings", () => {
  const documents = createLegalDocuments(savedSettings(), buildConfig());
  const requisites = documentText(documents, "requisites");

  assert.match(requisites, /телефон: \+7 \(3852\) 55-44-33;/);
  assert.match(requisites, /общий email: shop@apex-barnaul\.ru;/);
  assert.match(requisites, /email для персональных данных: care@apex-barnaul\.ru;/);
  assert.match(requisites, /режим работы: Mo-Fr 09:00-19:00; Sa 10:00-16:00\./);
  // Without a legal or actual address of the seller, the store address is used.
  assert.match(requisites, /юридический\/почтовый адрес: ул\. Попова, 1;/);
  assert.match(requisites, /адрес места осуществления деятельности: ул\. Попова, 1;/);

  const delivery = documentText(documents, "delivery-payment-returns");
  assert.match(delivery, /Самовывоз: Склад на ул\. Попова, 1, после звонка менеджера\./);
  assert.match(delivery, new RegExp(`Курьерская доставка: ${escapeRegExp(LEGAL_PLACEHOLDER)}\\.`));
  assert.match(delivery, /Региональная доставка: Транспортной компанией по Алтайскому краю\./);

  assert.match(documentText(documents, "privacy"), /Email для обращений по персональным данным: care@apex-barnaul\.ru\./);
  assert.match(documentText(documents, "personal-data-consent"), /адрес: ул\. Попова, 1, email: care@apex-barnaul\.ru\./);
  assert.match(documentText(documents, "terms"), /по адресу: care@apex-barnaul\.ru\./);

  const allText = JSON.stringify(documents);
  for (const buildValue of ["00-00-09", "build@apex-barnaul.ru", "build-support@", "Сборочная", "Пн–Вс", "из сборки"]) {
    assert.ok(!allText.includes(buildValue), `build-time value ${buildValue} is not used`);
  }
});

test("legal documents keep seller requisites from the environment", () => {
  const config = buildConfig();
  const documents = createLegalDocuments(savedSettings(), config);
  const requisites = documentText(documents, "requisites");

  assert.match(requisites, /ФИО\/наименование продавца: Петров Сергей Олегович;/);
  assert.match(requisites, /ОГРНИП: 322220000000000;/);
  assert.match(requisites, /ИНН: 222100000000;/);
  assert.match(requisites, /care@apex-barnaul\.ru, г\. Барнаул, ул\. Возвратная, 5;/);
  assert.match(documentText(documents, "offer"), /Адрес и место возврата товара: г\. Барнаул, ул\. Возвратная, 5\./);

  // A seller's own legal and actual address win over the store address.
  const withSellerAddress = createLegalDocuments(savedSettings(), {
    ...config,
    seller: { ...config.seller, legalAddress: "г. Барнаул, ул. Юридическая, 2", actualAddress: "г. Барнаул, ул. Рабочая, 3" },
  } as BusinessConfig);
  const sellerRequisites = documentText(withSellerAddress, "requisites");
  assert.match(sellerRequisites, /юридический\/почтовый адрес: г\. Барнаул, ул\. Юридическая, 2;/);
  assert.match(sellerRequisites, /адрес места осуществления деятельности: г\. Барнаул, ул\. Рабочая, 3;/);
});

test("missing settings are shown as the placeholder, support email falls back to the general one", () => {
  const settings = savedSettings();
  settings.contacts = { ...settings.contacts, phone: null, supportEmail: null };
  settings.workingHours = null;
  settings.location = { ...settings.location, address: null };
  const requisites = documentText(createLegalDocuments(settings, buildConfig()), "requisites");

  assert.equal(LEGAL_PLACEHOLDER, BUSINESS_DATA_PLACEHOLDER);
  assert.ok(requisites.includes(`телефон: ${LEGAL_PLACEHOLDER};`));
  assert.ok(requisites.includes(`режим работы: ${LEGAL_PLACEHOLDER}.`));
  assert.ok(requisites.includes(`юридический/почтовый адрес: ${LEGAL_PLACEHOLDER};`));
  assert.ok(requisites.includes("email для персональных данных: shop@apex-barnaul.ru;"));
});

test("slugs, titles and descriptions do not depend on the settings (sitemap, index page, metadata)", () => {
  const summary = (documents: ReturnType<typeof createLegalDocuments>) =>
    documents.map(({ slug, shortTitle, title, description }) => ({ slug, shortTitle, title, description }));
  assert.deepEqual(summary(createLegalDocuments(savedSettings())), summary(legalDocuments));
  assert.deepEqual(summary(createLegalDocuments(getDefaultSiteSettings())), summary(legalDocuments));
  // Without saved settings the texts are exactly the build-time ones.
  assert.deepEqual(createLegalDocuments(getDefaultSiteSettings()), legalDocuments);
});

test("checkout delivery methods follow the saved settings, not the build", () => {
  const settings = savedSettings();
  assert.deepEqual(getEnabledDeliveryMethods({ delivery: settings.delivery }), ["transport_company"]);
  assert.deepEqual(getEnabledDeliveryMethods({ delivery: buildConfig().delivery }), ["pickup", "courier"]);

  settings.delivery.pickup.enabled = true;
  settings.delivery.cityDelivery.enabled = true;
  assert.deepEqual(getEnabledDeliveryMethods(settings), ["pickup", "courier", "transport_company"]);

  settings.delivery = {
    pickup: { enabled: false, rules: null },
    cityDelivery: { enabled: false, rules: null },
    regionalDelivery: { enabled: false, rules: null },
  };
  assert.deepEqual(getEnabledDeliveryMethods(settings), []);
});

test("settings cross to client components as plain JSON", () => {
  for (const settings of [getDefaultSiteSettings(), parseStoredSiteSettings(savedSettings())]) {
    assert.deepEqual(JSON.parse(JSON.stringify(settings)), settings);
  }
  assert.deepEqual(parseStoredSiteSettings(savedSettings()), savedSettings());
});

function SettingsProbe() {
  const { contacts, workingHours, services } = useSiteSettings();
  return createElement(
    "p",
    null,
    `${contacts.phone ?? "—"} | ${workingHours ?? "—"} | ${services.tireService ? "шиномонтаж" : "без шиномонтажа"}`,
  );
}

test("useSiteSettings returns the settings given to the provider", () => {
  const html = renderToStaticMarkup(
    createElement(SiteSettingsProvider, { settings: savedSettings() }, createElement(SettingsProbe)),
  );
  assert.equal(html, "<p>+7 (3852) 55-44-33 | Mo-Fr 09:00-19:00; Sa 10:00-16:00 | шиномонтаж</p>");

  const withoutContacts = { ...savedSettings(), workingHours: null };
  withoutContacts.contacts = { ...withoutContacts.contacts, phone: null };
  withoutContacts.services = { ...withoutContacts.services, tireService: false };
  assert.equal(
    renderToStaticMarkup(createElement(SiteSettingsProvider, { settings: withoutContacts }, createElement(SettingsProbe))),
    "<p>— | — | без шиномонтажа</p>",
  );
});

test("useSiteSettings outside the provider is a programming error", () => {
  assert.throws(() => renderToStaticMarkup(createElement(SettingsProbe)), /inside SiteSettingsProvider/);
});

// Regression guard: storefront pages and components must not show store data
// (contacts, address, coordinates, hours, delivery, services, social links)
// from the build-time configuration — it comes from getSiteSettings() or
// useSiteSettings(). The admin and API routes are outside the storefront.
const ROOT = join(import.meta.dirname, "..", "..");
const EXCLUDED = [/^app\/api\//, /^app\/admin\//, /^components\/admin\//, /^components\/admin-dashboard\.tsx$/];
const BUILD_TIME_STORE_DATA = [
  /businessConfig\.(contacts|workingHours|delivery|services|social)\b/,
  /businessConfig\.location\.(address|latitude|longitude|twoGisUrl)\b/,
  /\{[^}]*\b(contacts|workingHours|delivery|services|social)\b[^}]*\}\s*=\s*businessConfig\b/,
  /getEnabledDeliveryMethods\(\s*\)/,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .filter((path) => !EXCLUDED.some((pattern) => pattern.test(path)));
}

test("storefront files do not read store data from the build-time configuration", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components"), "lib/legal-documents.ts", "lib/structured-data.ts"];
  assert.ok(files.includes("components/storefront.tsx") && files.includes("app/contacts/page.tsx"));
  const offenders = files.flatMap((path) => {
    const source = readFileSync(join(ROOT, path), "utf8");
    return BUILD_TIME_STORE_DATA.filter((pattern) => pattern.test(source)).map((pattern) => `${path}: ${pattern}`);
  });
  assert.deepEqual(offenders, []);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

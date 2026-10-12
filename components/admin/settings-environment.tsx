"use client";

import { Activity, Server } from "lucide-react";
import {
  businessConfig,
  getSellerDisplayName,
  type AvailabilityDisplayMode,
} from "@/config/business";
import { validateBusinessConfig } from "@/config/business-validation";
import { applySiteSettingsToConfig, type SiteSettings } from "@/lib/site-settings";
import styles from "./settings-section.module.css";

const AVAILABILITY_LABELS: Record<AvailabilityDisplayMode, string> = {
  exact: "Точное количество",
  limited: "«Мало» / «В наличии»",
  available: "«В наличии» без количества",
  on_request: "«Под заказ»",
  out_of_stock: "«Нет в наличии»",
};

const MISSING = "Не задано";

function Value({ value }: { value: string | null }) {
  return <dd className={value ? undefined : styles.missing}>{value ?? MISSING}</dd>;
}

/**
 * Values that are set on the server (environment variables, applied at
 * build/start) and cannot be changed in the admin: legal requisites, brand,
 * city, site address and catalog modes.
 */
export function SettingsEnvironment({ settings }: { settings: SiteSettings | null }) {
  const configurationIssues = validateBusinessConfig(applySiteSettingsToConfig(businessConfig, settings));
  const yesNo = (value: boolean) => (value ? "Включено" : "Выключено");

  return (
    <div className={styles.columns}>
      <article className="admin-card">
        <div className="admin-card-head">
          <div>
            <p className="eyebrow">Только чтение</p>
            <h2>Задаётся на сервере</h2>
          </div>
          <Server aria-hidden="true" />
        </div>
        <p className={styles.envNote}>
          Эти значения задаются в переменных окружения сервера и меняются только при
          новой сборке сайта: реквизиты продавца используются в договорах и чеках,
          режимы каталога — в обмене с 1С. Обратитесь к тому, кто обслуживает сервер.
        </p>
        <dl className={styles.envList}>
          <div><dt>Бренд</dt><Value value={businessConfig.brandName} /></div>
          <div><dt>Город</dt><Value value={businessConfig.location.city} /></div>
          <div><dt>Продавец</dt><Value value={getSellerDisplayName()} /></div>
          <div><dt>Официальное название</dt><Value value={businessConfig.businessName} /></div>
          <div><dt>ИНН</dt><Value value={businessConfig.seller.inn} /></div>
          <div><dt>ОГРНИП</dt><Value value={businessConfig.seller.ogrnip} /></div>
          <div><dt>Юридический адрес</dt><Value value={businessConfig.seller.legalAddress} /></div>
          <div><dt>Адрес для возврата</dt><Value value={businessConfig.seller.returnAddress} /></div>
          <div><dt>Адрес сайта</dt><Value value={businessConfig.siteUrl} /></div>
          <div>
            <dt>Этап</dt>
            <dd>{businessConfig.deploymentStage === "production" ? "Рабочий сайт" : "Предпросмотр"}</dd>
          </div>
          <div>
            <dt>Каталог</dt>
            <dd>{businessConfig.catalog.dataMode === "database" ? "Из базы данных" : "Демонстрационный"}</dd>
          </div>
          <div>
            <dt>Показ остатков</dt>
            <dd>{AVAILABILITY_LABELS[businessConfig.catalog.availabilityDisplayMode]}</dd>
          </div>
          <div><dt>Б/у товары</dt><dd>{yesNo(businessConfig.catalog.usedProductsEnabled)}</dd></div>
          <div><dt>Рассрочка</dt><dd>{yesNo(businessConfig.features.installmentEnabled)}</dd></div>
        </dl>
      </article>
      <article className="admin-card">
        <div className="admin-card-head">
          <div>
            <p className="eyebrow">До запуска</p>
            <h2>
              {configurationIssues.length === 0
                ? "Обязательные данные заполнены"
                : `Требуют внимания: ${configurationIssues.length}`}
            </h2>
          </div>
          <Activity aria-hidden="true" />
        </div>
        {configurationIssues.length === 0 ? (
          <p className={styles.envNote}>Проверка не нашла пустых или тестовых значений.</p>
        ) : (
          <ul className={styles.issues}>
            {configurationIssues.map((issue) => (
              <li key={`${issue.field}-${issue.message}`}>
                <strong>{issue.field}</strong>
                <small>{issue.message}</small>
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}

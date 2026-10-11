"use client";

import { Activity, Gauge, Settings } from "lucide-react";
import { businessConfig, getSellerDisplayName } from "@/config/business";
import { validateBusinessConfig } from "@/config/business-validation";

export function SettingsSection() {
  const configurationIssues = validateBusinessConfig(businessConfig);
  const sellerName = getSellerDisplayName();

  return (
    <>
      <div className="admin-page-intro"><div><p className="eyebrow">Конфигурация</p><h1>Настройки магазина</h1><span>Единый источник данных: config/business.ts и переменные окружения.</span></div></div>
      <div className="settings-grid">
        <article className="admin-card settings-card"><div className="admin-card-head"><div><p className="eyebrow">Магазин</p><h2>Публичные данные</h2></div><Settings /></div><label><span>Бренд</span><input value={businessConfig.brandName} readOnly /></label><label><span>Продавец</span><input value={sellerName ?? ""} placeholder="Не заполнено — требуется до запуска" readOnly /></label><label><span>Телефон</span><input value={businessConfig.contacts.phone ?? ""} placeholder="Не заполнено — требуется до запуска" readOnly /></label><label><span>Email</span><input value={businessConfig.contacts.email ?? ""} placeholder="Не заполнено — требуется до запуска" readOnly /></label><label><span>Адрес</span><input value={businessConfig.location.address ?? ""} placeholder="Не заполнено — требуется до запуска" readOnly /></label><label><span>График</span><input value={businessConfig.workingHours ?? ""} placeholder="Не заполнено" readOnly /></label></article>
        <article className="admin-card settings-card"><div className="admin-card-head"><div><p className="eyebrow">Возможности</p><h2>Подтвержденные услуги</h2></div><Gauge /></div><label className="settings-switch"><span><strong>Самовывоз</strong><small>Включать только после согласования адреса и правил</small></span><input type="checkbox" checked={businessConfig.delivery.pickup.enabled} readOnly /></label><label className="settings-switch"><span><strong>Доставка по городу</strong><small>Стоимость не задана автоматически</small></span><input type="checkbox" checked={businessConfig.delivery.cityDelivery.enabled} readOnly /></label><label className="settings-switch"><span><strong>Б/у товары</strong><small>Для комплектов используются индивидуальные фото</small></span><input type="checkbox" checked={businessConfig.catalog.usedProductsEnabled} readOnly /></label><label className="settings-switch"><span><strong>Рассрочка</strong><small>Только после подключения реального провайдера</small></span><input type="checkbox" checked={businessConfig.features.installmentEnabled} readOnly /></label></article>
        <article className="admin-card settings-card"><div className="admin-card-head"><div><p className="eyebrow">До запуска</p><h2>{configurationIssues.length} пунктов требуют внимания</h2></div><Activity /></div>{configurationIssues.map((issue) => <p key={issue.field}><strong>{issue.field}</strong><br /><small>{issue.message}</small></p>)}</article>
      </div>
    </>
  );
}

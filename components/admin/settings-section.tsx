"use client";

import { Clock, ExternalLink, MapPin, Phone, RefreshCw, Save, Truck, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { businessConfig } from "@/config/business";
import { AdminApiError, adminApi, errorMessage } from "@/lib/admin/product-api";
import type { SiteSettings } from "@/lib/site-settings";
import { SettingsEnvironment } from "./settings-environment";
import {
  SettingsListField,
  SettingsSwitchField,
  SettingsTextAreaField,
  SettingsTextField,
} from "./settings-fields";
import styles from "./settings-section.module.css";

const SETTINGS_API = "/api/admin/settings";

type LoadState = "loading" | "ready" | "error" | "signed_out" | "forbidden";
type DeliveryKey = keyof SiteSettings["delivery"];
type ServiceFlag = Exclude<keyof SiteSettings["services"], "other">;

interface SettingsResponse {
  settings: SiteSettings;
  updatedAt: string | null;
  defaults: boolean;
  storedInvalid: boolean;
  canEdit: boolean;
}

interface SaveResponse extends SettingsResponse {
  changed: boolean;
  cacheReset: boolean;
}

/** Form values as typed (strings for every text and number field). */
interface SettingsForm {
  contacts: {
    phone: string;
    additionalPhones: string[];
    email: string;
    supportEmail: string;
    whatsapp: string;
    telegram: string;
    vk: string;
  };
  location: { address: string; latitude: string; longitude: string; twoGisUrl: string };
  workingHours: string;
  delivery: Record<DeliveryKey, { enabled: boolean; rules: string }>;
  services: Record<ServiceFlag, boolean> & { other: string[] };
}

type Issues = Record<string, string>;

const SIGNED_OUT_MESSAGE = "Сессия завершилась. Обновите страницу и войдите снова.";
const FORBIDDEN_MESSAGE = "Раздел «Настройки» доступен только сотрудникам магазина.";
const CONFLICT_RELOAD_CONFIRM =
  "Ваши несохранённые правки будут заменены актуальными данными. Продолжить?";

const DELIVERY_OPTIONS: Array<{ key: DeliveryKey; label: string; description: string }> = [
  {
    key: "pickup",
    label: "Самовывоз",
    description: "Покупатель забирает заказ в магазине.",
  },
  {
    key: "cityDelivery",
    label: "Доставка по городу",
    description: `Курьером по ${businessConfig.location.cityDative}.`,
  },
  {
    key: "regionalDelivery",
    label: "Доставка в другие города",
    description: "Транспортной компанией.",
  },
];

const SERVICE_OPTIONS: Array<{ key: ServiceFlag; label: string; description?: string }> = [
  { key: "tireService", label: "Шиномонтаж", description: "Покупатель может добавить шиномонтаж к заказу." },
  { key: "balancing", label: "Балансировка" },
  { key: "installation", label: "Установка колёс на автомобиль" },
  { key: "tireStorage", label: "Сезонное хранение шин" },
];

/** Field paths rendered by the form (server issues for others are listed above the save bar). */
const FIELD_PATHS = new Set([
  "contacts.phone",
  "contacts.additionalPhones",
  "contacts.email",
  "contacts.supportEmail",
  "contacts.whatsapp",
  "contacts.telegram",
  "contacts.vk",
  "location.address",
  "location.latitude",
  "location.longitude",
  "location.twoGisUrl",
  "workingHours",
  ...DELIVERY_OPTIONS.flatMap(({ key }) => [`delivery.${key}.enabled`, `delivery.${key}.rules`]),
  ...SERVICE_OPTIONS.map(({ key }) => `services.${key}`),
  "services.other",
]);

function isFieldPath(path: string): boolean {
  return FIELD_PATHS.has(path) || /^(contacts\.additionalPhones|services\.other)\.\d+$/.test(path);
}

function formFromSettings(settings: SiteSettings): SettingsForm {
  const text = (value: string | null) => value ?? "";
  const number = (value: number | null) => (value === null ? "" : String(value));
  return {
    contacts: {
      phone: text(settings.contacts.phone),
      additionalPhones: [...settings.contacts.additionalPhones],
      email: text(settings.contacts.email),
      supportEmail: text(settings.contacts.supportEmail),
      whatsapp: text(settings.contacts.whatsapp),
      telegram: text(settings.contacts.telegram),
      vk: text(settings.contacts.vk),
    },
    location: {
      address: text(settings.location.address),
      latitude: number(settings.location.latitude),
      longitude: number(settings.location.longitude),
      twoGisUrl: settings.location.twoGisUrl,
    },
    workingHours: text(settings.workingHours),
    delivery: {
      pickup: { enabled: settings.delivery.pickup.enabled, rules: text(settings.delivery.pickup.rules) },
      cityDelivery: { enabled: settings.delivery.cityDelivery.enabled, rules: text(settings.delivery.cityDelivery.rules) },
      regionalDelivery: {
        enabled: settings.delivery.regionalDelivery.enabled,
        rules: text(settings.delivery.regionalDelivery.rules),
      },
    },
    services: {
      tireService: settings.services.tireService,
      tireStorage: settings.services.tireStorage,
      balancing: settings.services.balancing,
      installation: settings.services.installation,
      other: [...settings.services.other],
    },
  };
}

/** Blank rows of the lists are dropped before saving (indexes then match the server's). */
function withoutBlankRows(form: SettingsForm): SettingsForm {
  const filled = (items: string[]) => items.filter((item) => item.trim() !== "");
  return {
    ...form,
    contacts: { ...form.contacts, additionalPhones: filled(form.contacts.additionalPhones) },
    services: { ...form.services, other: filled(form.services.other) },
  };
}

function parseCoordinate(value: string, limit: number): number | null | undefined {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : undefined;
}

/**
 * Form → request body. The server validates everything again (siteSettingsSchema);
 * here only what the browser must convert: coordinates and required fields.
 */
function settingsFromForm(form: SettingsForm): { settings: SiteSettings; issues: Issues } {
  const issues: Issues = {};
  const latitude = parseCoordinate(form.location.latitude, 90);
  const longitude = parseCoordinate(form.location.longitude, 180);
  if (latitude === undefined) issues["location.latitude"] = "Широта — число от -90 до 90, например 53.3761.";
  if (longitude === undefined) issues["location.longitude"] = "Долгота — число от -180 до 180, например 83.7564.";
  if (latitude === null && typeof longitude === "number") {
    issues["location.latitude"] = "Укажите и широту, и долготу или оставьте оба поля пустыми.";
  }
  if (longitude === null && typeof latitude === "number") {
    issues["location.longitude"] = "Укажите и широту, и долготу или оставьте оба поля пустыми.";
  }
  if (form.location.twoGisUrl.trim() === "") {
    issues["location.twoGisUrl"] = "Ссылка на 2ГИС обязательна: по ней покупатели открывают карту.";
  }
  const settings: SiteSettings = {
    // Empty strings are sent as is: the server stores them as null.
    contacts: { ...form.contacts, additionalPhones: [...form.contacts.additionalPhones] },
    location: {
      address: form.location.address,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      twoGisUrl: form.location.twoGisUrl,
    },
    workingHours: form.workingHours,
    delivery: {
      pickup: { ...form.delivery.pickup },
      cityDelivery: { ...form.delivery.cityDelivery },
      regionalDelivery: { ...form.delivery.regionalDelivery },
    },
    services: { ...form.services, other: [...form.services.other] },
  };
  return { settings, issues };
}

function withoutIssues(issues: Issues, path: string): Issues {
  const keys = Object.keys(issues).filter((key) => key === path || key.startsWith(`${path}.`));
  if (keys.length === 0) return issues;
  const next = { ...issues };
  for (const key of keys) delete next[key];
  return next;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * «Настройки»: store data shown on the site (contacts, address and map,
 * working hours, delivery, services). Administrators edit and save; managers
 * see the same values read-only. Values set in the server environment
 * (requisites, brand, catalog modes) are shown below, read-only.
 */
export function SettingsSection() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [server, setServer] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [initialForm, setInitialForm] = useState<SettingsForm | null>(null);
  const [issues, setIssues] = useState<Issues>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [focusIssue, setFocusIssue] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const reloadAnnouncement = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState((current) => (current === "ready" ? current : "loading"));
    adminApi<SettingsResponse>(SETTINGS_API, { signal: controller.signal })
      .then((result) => {
        const loaded = formFromSettings(result.settings);
        setServer(result);
        setForm(loaded);
        setInitialForm(loaded);
        setIssues({});
        setConflict(false);
        setFailure(null);
        setLoadState("ready");
        if (reloadAnnouncement.current) setStatus(reloadAnnouncement.current);
        reloadAnnouncement.current = null;
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name === "AbortError") return;
        if (error instanceof AdminApiError && error.status === 401) setLoadState("signed_out");
        else if (error instanceof AdminApiError && error.status === 403) setLoadState("forbidden");
        else {
          setLoadError(errorMessage(error, "Не удалось загрузить настройки."));
          setLoadState("error");
        }
      });
    return () => controller.abort();
  }, [reloadKey]);

  const dirty = useMemo(
    () => form !== null && initialForm !== null && JSON.stringify(form) !== JSON.stringify(initialForm),
    [form, initialForm],
  );
  const canEdit = server?.canEdit ?? false;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // After a failed save: move focus to the first marked field (DOM order = visual order).
  useEffect(() => {
    if (!focusIssue) return;
    setFocusIssue(false);
    const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    target?.focus();
  }, [focusIssue]);

  const change = useCallback((path: string, recipe: (current: SettingsForm) => SettingsForm) => {
    setForm((current) => (current ? recipe(current) : current));
    setIssues((current) => withoutIssues(current, path));
    setStatus("");
  }, []);

  function reload(announcement: string | null) {
    if (dirty && !window.confirm(CONFLICT_RELOAD_CONFIRM)) return;
    reloadAnnouncement.current = announcement;
    setStatus("");
    setFailure(null);
    setReloadKey((value) => value + 1);
  }

  function discardChanges() {
    if (!initialForm) return;
    if (!window.confirm("Отменить несохранённые изменения?")) return;
    setForm(initialForm);
    setIssues({});
    setFailure(null);
    setStatus("Изменения отменены.");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !server || !canEdit || saving) return;
    const cleaned = withoutBlankRows(form);
    setForm(cleaned);
    setStatus("");
    setFailure(null);
    const { settings, issues: localIssues } = settingsFromForm(cleaned);
    if (Object.keys(localIssues).length > 0) {
      setIssues(localIssues);
      setFailure("Настройки не сохранены: проверьте отмеченные поля.");
      setFocusIssue(true);
      return;
    }
    setSaving(true);
    try {
      const result = await adminApi<SaveResponse>(SETTINGS_API, {
        method: "PUT",
        json: { settings, expectedUpdatedAt: server.updatedAt },
      });
      const saved = formFromSettings(result.settings);
      setServer(result);
      setForm(saved);
      setInitialForm(saved);
      setIssues({});
      setConflict(false);
      setStatus(
        !result.changed
          ? "Изменений нет — сохранять нечего."
          : result.cacheReset
            ? "Настройки сохранены. Страницы сайта покажут новые данные при следующем открытии."
            : "Настройки сохранены. Страницы сайта обновятся в течение нескольких минут.",
      );
    } catch (error) {
      if (error instanceof AdminApiError && error.code === "SITE_SETTINGS_VERSION_CONFLICT") {
        setConflict(true);
        return;
      }
      if (error instanceof AdminApiError && error.status === 401) {
        setFailure(SIGNED_OUT_MESSAGE);
        return;
      }
      if (error instanceof AdminApiError && error.issues.length > 0) {
        setIssues(Object.fromEntries(error.issues.map((issue) => [issue.field, issue.message])));
        setFocusIssue(true);
        setFailure("Настройки не сохранены: проверьте отмеченные поля.");
        return;
      }
      setFailure(errorMessage(error, "Настройки не сохранены. Повторите попытку."));
    } finally {
      setSaving(false);
    }
  }

  const intro = (
    <div className="admin-page-intro">
      <div>
        <p className="eyebrow">Магазин</p>
        <h1>Настройки магазина</h1>
        <span>Контакты, адрес, часы работы, доставка и услуги — для всех страниц сайта.</span>
      </div>
      {loadState === "ready" && (
        <button className="admin-secondary-button" type="button" onClick={() => reload("Загружены актуальные настройки.")}>
          <RefreshCw size={16} aria-hidden="true" /> Обновить
        </button>
      )}
    </div>
  );

  if (loadState !== "ready" || !form || !server) {
    return (
      <>
        {intro}
        <div className={styles.layout}>
          <article className="admin-card">
            <div className={styles.state} role={loadState === "loading" ? "status" : "alert"}>
              {loadState === "loading" && <span>Загружаем настройки…</span>}
              {loadState === "signed_out" && <strong>{SIGNED_OUT_MESSAGE}</strong>}
              {loadState === "forbidden" && <strong>{FORBIDDEN_MESSAGE}</strong>}
              {loadState === "error" && (
                <>
                  <strong>{loadError}</strong>
                  <button type="button" className="admin-secondary-button" onClick={() => setReloadKey((value) => value + 1)}>
                    Повторить
                  </button>
                </>
              )}
            </div>
          </article>
          {(loadState === "error" || loadState === "loading") && <SettingsEnvironment settings={null} />}
        </div>
      </>
    );
  }

  const readOnly = !canEdit;
  const unplacedIssues = Object.entries(issues).filter(([path]) => !isFieldPath(path));
  const text = (path: string) => issues[path];

  return (
    <>
      {intro}
      <div className={styles.layout}>
        {readOnly && (
          <p className={styles.notice} role="note">
            <strong>Только просмотр.</strong>
            Изменять настройки может только администратор магазина. Если данные устарели, сообщите администратору.
          </p>
        )}
        {server.storedInvalid ? (
          <p className={`${styles.notice} ${styles.noticeWarn}`} role="note">
            <strong>Сохранённые настройки не прошли проверку.</strong>
            Сайт сейчас показывает значения по умолчанию с сервера (они в форме ниже).
            {canEdit ? " Проверьте поля и сохраните — это заменит повреждённую запись." : ""}
          </p>
        ) : (
          server.defaults && (
            <p className={`${styles.notice} ${styles.noticeWarn}`} role="note">
              <strong>Настройки ещё не сохранялись.</strong>
              Сейчас действуют значения по умолчанию из переменных окружения сервера.
              {canEdit ? " После первого сохранения сайт будет брать данные из этого раздела." : ""}
            </p>
          )
        )}
        {conflict && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <strong>Настройки изменил другой сотрудник, пока форма была открыта.</strong>
            Ваши правки не сохранены. Загрузите актуальные данные и внесите изменения снова.
            <div className={styles.noticeActions}>
              <button type="button" className={`admin-primary-button ${styles.smallButton}`} onClick={() => reload("Загружены актуальные настройки.")}>
                <RefreshCw size={14} aria-hidden="true" /> Загрузить актуальные данные
              </button>
            </div>
          </div>
        )}

        <form ref={formRef} onSubmit={(event) => void save(event)} noValidate aria-label="Настройки магазина">
          <fieldset className={styles.fieldset} disabled={readOnly}>
            <legend className="sr-only">Данные магазина на сайте</legend>
            <div className={styles.columns}>
              <div className={styles.column}>
                <article className="admin-card">
                  <div className="admin-card-head">
                    <div><p className="eyebrow">Связь</p><h2>Контакты</h2></div>
                    <Phone aria-hidden="true" />
                  </div>
                  <div className={`${styles.cardBody} ${styles.grid}`}>
                    <SettingsTextField
                      path="contacts.phone"
                      label="Основной телефон"
                      type="tel"
                      inputMode="tel"
                      placeholder="+7 (3852) 00-00-00"
                      maxLength={24}
                      value={form.contacts.phone}
                      error={text("contacts.phone")}
                      hint="В шапке сайта, на странице контактов и в документах."
                      onChange={(value) => change("contacts.phone", (current) => ({ ...current, contacts: { ...current.contacts, phone: value } }))}
                    />
                    <SettingsTextField
                      path="contacts.email"
                      label="Email магазина"
                      type="email"
                      inputMode="email"
                      maxLength={254}
                      value={form.contacts.email}
                      error={text("contacts.email")}
                      hint="Показывается покупателям на сайте."
                      onChange={(value) => change("contacts.email", (current) => ({ ...current, contacts: { ...current.contacts, email: value } }))}
                    />
                    <SettingsListField
                      path="contacts.additionalPhones"
                      label="Дополнительные телефоны"
                      itemLabel="Дополнительный телефон"
                      addLabel="Добавить телефон"
                      emptyText="Дополнительных телефонов нет."
                      hint="До 5 номеров."
                      type="tel"
                      inputMode="tel"
                      placeholder="+7 (3852) 00-00-00"
                      maxItems={5}
                      maxLength={24}
                      items={form.contacts.additionalPhones}
                      errors={issues}
                      readOnly={readOnly}
                      onChange={(items) => change("contacts.additionalPhones", (current) => ({ ...current, contacts: { ...current.contacts, additionalPhones: items } }))}
                    />
                    <SettingsTextField
                      path="contacts.supportEmail"
                      label="Email для обращений и уведомлений"
                      type="email"
                      inputMode="email"
                      maxLength={254}
                      wide
                      value={form.contacts.supportEmail}
                      error={text("contacts.supportEmail")}
                      hint="Указывается в документах для обращений покупателей; на него приходят письма о новых заказах и заявках на подбор. Если пусто — используется email магазина."
                      onChange={(value) => change("contacts.supportEmail", (current) => ({ ...current, contacts: { ...current.contacts, supportEmail: value } }))}
                    />
                    <SettingsTextField
                      path="contacts.whatsapp"
                      label="WhatsApp"
                      type="url"
                      inputMode="url"
                      placeholder="https://wa.me/7…"
                      maxLength={500}
                      value={form.contacts.whatsapp}
                      error={text("contacts.whatsapp")}
                      onChange={(value) => change("contacts.whatsapp", (current) => ({ ...current, contacts: { ...current.contacts, whatsapp: value } }))}
                    />
                    <SettingsTextField
                      path="contacts.telegram"
                      label="Telegram"
                      type="url"
                      inputMode="url"
                      placeholder="https://t.me/…"
                      maxLength={500}
                      value={form.contacts.telegram}
                      error={text("contacts.telegram")}
                      onChange={(value) => change("contacts.telegram", (current) => ({ ...current, contacts: { ...current.contacts, telegram: value } }))}
                    />
                    <SettingsTextField
                      path="contacts.vk"
                      label="ВКонтакте"
                      type="url"
                      inputMode="url"
                      placeholder="https://vk.com/…"
                      maxLength={500}
                      wide
                      value={form.contacts.vk}
                      error={text("contacts.vk")}
                      hint="Ссылки — только https://. Пустое поле — ссылка на сайте не показывается."
                      onChange={(value) => change("contacts.vk", (current) => ({ ...current, contacts: { ...current.contacts, vk: value } }))}
                    />
                  </div>
                </article>

                <article className="admin-card">
                  <div className="admin-card-head">
                    <div><p className="eyebrow">Магазин</p><h2>Адрес и карта</h2></div>
                    <MapPin aria-hidden="true" />
                  </div>
                  <div className={`${styles.cardBody} ${styles.grid}`}>
                    <SettingsTextField
                      path="location.address"
                      label="Адрес магазина"
                      maxLength={300}
                      wide
                      value={form.location.address}
                      error={text("location.address")}
                      hint={`Например: ${businessConfig.location.city}, ул. Попова, 1. Используется на странице контактов, в документах и в разметке для поисковиков.`}
                      onChange={(value) => change("location.address", (current) => ({ ...current, location: { ...current.location, address: value } }))}
                    />
                    <SettingsTextField
                      path="location.latitude"
                      label="Широта"
                      inputMode="decimal"
                      placeholder="53.3761"
                      maxLength={20}
                      value={form.location.latitude}
                      error={text("location.latitude")}
                      hint="Из карточки магазина в 2ГИС или Яндекс Картах, через точку. Нужны для разметки поисковиков; можно оставить пустыми."
                      onChange={(value) => change("location.latitude", (current) => ({ ...current, location: { ...current.location, latitude: value } }))}
                    />
                    <SettingsTextField
                      path="location.longitude"
                      label="Долгота"
                      inputMode="decimal"
                      placeholder="83.7564"
                      maxLength={20}
                      value={form.location.longitude}
                      error={text("location.longitude")}
                      onChange={(value) => change("location.longitude", (current) => ({ ...current, location: { ...current.location, longitude: value } }))}
                    />
                    <SettingsTextField
                      path="location.twoGisUrl"
                      label="Ссылка на карточку в 2ГИС"
                      type="url"
                      inputMode="url"
                      placeholder="https://2gis.ru/…"
                      maxLength={500}
                      required
                      wide
                      value={form.location.twoGisUrl}
                      error={text("location.twoGisUrl")}
                      hint="Открывается кнопкой «2ГИС» на странице контактов. Только https://."
                      onChange={(value) => change("location.twoGisUrl", (current) => ({ ...current, location: { ...current.location, twoGisUrl: value } }))}
                    />
                    {/^https:\/\//.test(server.settings.location.twoGisUrl) && (
                      <a className={styles.mapLink} href={server.settings.location.twoGisUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={13} aria-hidden="true" /> Открыть сохранённую ссылку
                      </a>
                    )}
                  </div>
                </article>

                <article className="admin-card">
                  <div className="admin-card-head">
                    <div><p className="eyebrow">График</p><h2>Часы работы</h2></div>
                    <Clock aria-hidden="true" />
                  </div>
                  <div className={styles.cardBody}>
                    <SettingsTextField
                      path="workingHours"
                      label="Часы работы"
                      maxLength={200}
                      value={form.workingHours}
                      error={text("workingHours")}
                      placeholder="Пн–Пт 9:00–19:00, Сб 10:00–16:00, Вс — выходной"
                      hint="Так, как увидят покупатели. Пустое поле — часы на сайте не показываются."
                      onChange={(value) => change("workingHours", (current) => ({ ...current, workingHours: value }))}
                    />
                  </div>
                </article>
              </div>

              <div className={styles.column}>
                <article className="admin-card">
                  <div className="admin-card-head">
                    <div><p className="eyebrow">Получение заказа</p><h2>Доставка</h2></div>
                    <Truck aria-hidden="true" />
                  </div>
                  <div className={styles.cardBody}>
                    <p className={styles.hint}>
                      Выключенный способ сразу перестаёт приниматься в новых заказах (сервер проверяет его при
                      оформлении); уже оформленные заказы не меняются. Если выключить все способы, оформить заказ на
                      сайте будет нельзя. Стоимость доставки здесь не задаётся.
                    </p>
                    {DELIVERY_OPTIONS.map(({ key, label, description }) => (
                      <div className={styles.option} key={key}>
                        <SettingsSwitchField
                          path={`delivery.${key}.enabled`}
                          label={label}
                          description={description}
                          checked={form.delivery[key].enabled}
                          error={text(`delivery.${key}.enabled`)}
                          onChange={(checked) => change(`delivery.${key}.enabled`, (current) => ({
                            ...current,
                            delivery: { ...current.delivery, [key]: { ...current.delivery[key], enabled: checked } },
                          }))}
                        />
                        <SettingsTextAreaField
                          path={`delivery.${key}.rules`}
                          label={`Условия: ${label.toLowerCase()}`}
                          maxLength={1000}
                          value={form.delivery[key].rules}
                          error={text(`delivery.${key}.rules`)}
                          hint="Сроки, стоимость, ограничения — как увидит покупатель при оформлении и в документах. До 1000 символов."
                          onChange={(value) => change(`delivery.${key}.rules`, (current) => ({
                            ...current,
                            delivery: { ...current.delivery, [key]: { ...current.delivery[key], rules: value } },
                          }))}
                        />
                      </div>
                    ))}
                  </div>
                </article>

                <article className="admin-card">
                  <div className="admin-card-head">
                    <div><p className="eyebrow">Возможности</p><h2>Услуги</h2></div>
                    <Wrench aria-hidden="true" />
                  </div>
                  <div className={styles.cardBody}>
                    {SERVICE_OPTIONS.map(({ key, label, description }) => (
                      <SettingsSwitchField
                        key={key}
                        path={`services.${key}`}
                        label={label}
                        description={description}
                        checked={form.services[key]}
                        error={text(`services.${key}`)}
                        onChange={(checked) => change(`services.${key}`, (current) => ({
                          ...current,
                          services: { ...current.services, [key]: checked },
                        }))}
                      />
                    ))}
                    <SettingsListField
                      path="services.other"
                      label="Другие услуги"
                      itemLabel="Услуга"
                      addLabel="Добавить услугу"
                      emptyText="Других услуг нет."
                      hint="До 10 названий, каждое не длиннее 80 символов."
                      maxItems={10}
                      maxLength={80}
                      items={form.services.other}
                      errors={issues}
                      readOnly={readOnly}
                      onChange={(items) => change("services.other", (current) => ({ ...current, services: { ...current.services, other: items } }))}
                    />
                  </div>
                </article>
              </div>
            </div>
          </fieldset>

          {failure && (
            <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
              <strong>{failure}</strong>
              {unplacedIssues.length > 0 && (
                <ul>
                  {unplacedIssues.map(([path, message]) => (
                    <li key={path}>{path ? `${path}: ` : ""}{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {canEdit && (
            <div className={styles.saveBar}>
              <p className={`${styles.saveState} ${dirty ? styles.dirty : ""}`}>
                {dirty
                  ? "Есть несохранённые изменения"
                  : server.updatedAt
                    ? `Сохранено ${formatDateTime(server.updatedAt)}`
                    : "Действуют значения по умолчанию"}
              </p>
              <button
                type="button"
                className="admin-secondary-button"
                disabled={!dirty || saving}
                onClick={discardChanges}
              >
                Отменить изменения
              </button>
              <button
                type="submit"
                className="admin-primary-button"
                disabled={saving || (!dirty && !server.storedInvalid)}
              >
                <Save size={16} aria-hidden="true" /> {saving ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          )}
        </form>

        {/* Polite announcements (saved, reloaded); errors use role="alert" above. */}
        <p className={status ? `${styles.notice} ${styles.noticeSuccess}` : "sr-only"} role="status" aria-live="polite">
          {status}
        </p>

        <SettingsEnvironment settings={server.settings} />
      </div>
    </>
  );
}

"use client";

import Link from "next/link";
import { BarChart3, Check, Cookie, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  COOKIE_CONSENT_UPDATED_EVENT,
  type CookieConsentPreferences,
  OPEN_COOKIE_SETTINGS_EVENT,
  readCookieConsentPreferences,
  saveCookieConsentPreferences,
} from "@/lib/cookie-consent";

declare global {
  interface Window {
    ym?: YandexMetrikaFunction;
  }
}

interface YandexMetrikaFunction {
  (...argumentsList: unknown[]): void;
  a?: unknown[][];
  l?: number;
}

interface PublicSiteConfiguration {
  yandexMetrikaCounterId: number | null;
}

/**
 * Loads Yandex Metrika only after the visitor has explicitly allowed analytics.
 * Necessary site storage continues to work when analytics is rejected.
 */
function YandexMetrika({
  analyticsAllowed,
}: {
  analyticsAllowed: boolean;
}) {
  useEffect(() => {
    let effectCancelled = false;

    async function configureMetrika() {
      const configurationResponse = await fetch("/api/public-config", {
        cache: "no-store",
      });
      if (!configurationResponse.ok || effectCancelled) return;

      const configuration =
        (await configurationResponse.json()) as PublicSiteConfiguration;
      const counterId = configuration.yandexMetrikaCounterId;
      if (!counterId || effectCancelled) return;

      const disablePropertyName = `disableYaCounter${counterId}`;
      Object.assign(window, {
        [disablePropertyName]: !analyticsAllowed,
      });

      if (!analyticsAllowed) return;

      if (!window.ym) {
        const queuedMetrikaFunction: YandexMetrikaFunction = (
          ...argumentsList: unknown[]
        ) => {
          queuedMetrikaFunction.a = queuedMetrikaFunction.a || [];
          queuedMetrikaFunction.a.push(argumentsList);
        };
        queuedMetrikaFunction.l = Date.now();

        window.ym = queuedMetrikaFunction;
        const metrikaScript = document.createElement("script");
        metrikaScript.async = true;
        metrikaScript.src = "https://mc.yandex.ru/metrika/tag.js";
        metrikaScript.dataset.apexMetrika = String(counterId);
        document.head.appendChild(metrikaScript);
      }

      const initializationMarker = `apexMetrikaInitialized${counterId}`;
      if (!document.documentElement.dataset[initializationMarker]) {
        window.ym?.(counterId, "init", {
          accurateTrackBounce: true,
          clickmap: true,
          trackLinks: true,
          webvisor: false,
        });
        document.documentElement.dataset[initializationMarker] = "true";
      }
    }

    void configureMetrika();

    return () => {
      effectCancelled = true;
    };
  }, [analyticsAllowed]);

  return null;
}

/**
 * Owns the cookie banner, detailed settings dialog, and analytics consent state.
 */
export function PrivacyTools() {
  const [preferences, setPreferences] =
    useState<CookieConsentPreferences | null>(null);
  const [consentReadFromBrowser, setConsentReadFromBrowser] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analyticsSelection, setAnalyticsSelection] = useState(false);

  useEffect(() => {
    const storedPreferences = readCookieConsentPreferences();
    setPreferences(storedPreferences);
    setAnalyticsSelection(storedPreferences?.analytics ?? false);
    setConsentReadFromBrowser(true);

    function showSettings() {
      const currentPreferences = readCookieConsentPreferences();
      setAnalyticsSelection(currentPreferences?.analytics ?? false);
      setSettingsOpen(true);
    }

    function updatePreferences(event: Event) {
      const customEvent =
        event as CustomEvent<CookieConsentPreferences>;
      setPreferences(customEvent.detail);
    }

    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, showSettings);
    window.addEventListener(
      COOKIE_CONSENT_UPDATED_EVENT,
      updatePreferences,
    );

    return () => {
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, showSettings);
      window.removeEventListener(
        COOKIE_CONSENT_UPDATED_EVENT,
        updatePreferences,
      );
    };
  }, []);

  const persistSelection = useCallback((analyticsAllowed: boolean) => {
    const updatedPreferences =
      saveCookieConsentPreferences(analyticsAllowed);
    setPreferences(updatedPreferences);
    setSettingsOpen(false);
  }, []);

  if (!consentReadFromBrowser) return null;

  return (
    <>
      {preferences && (
        <YandexMetrika analyticsAllowed={preferences.analytics} />
      )}

      {!preferences && !settingsOpen && (
        <aside
          className="cookie-banner"
          aria-label="Настройки файлов cookie"
        >
          <div className="cookie-banner-icon" aria-hidden="true">
            <Cookie size={23} />
          </div>
          <div className="cookie-banner-copy">
            <strong>Cookie под вашим контролем</strong>
            <p>
              Необходимые хранилища поддерживают корзину и вход. Яндекс
              Метрика включится только с вашего согласия. Подробнее — в{" "}
              <Link href="/legal/cookies">политике cookie</Link>.
            </p>
          </div>
          <div className="cookie-banner-actions">
            <button
              className="cookie-secondary-button"
              onClick={() => persistSelection(false)}
            >
              Только необходимые
            </button>
            <button
              className="cookie-secondary-button"
              onClick={() => setSettingsOpen(true)}
            >
              Настроить
            </button>
            <button
              className="cookie-primary-button"
              onClick={() => persistSelection(true)}
            >
              Принять все
            </button>
          </div>
        </aside>
      )}

      {settingsOpen && (
        <div
          className="cookie-settings-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && preferences) {
              setSettingsOpen(false);
            }
          }}
        >
          <section
            className="cookie-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-settings-title"
          >
            <header>
              <div>
                <p className="eyebrow">Центр приватности</p>
                <h2 id="cookie-settings-title">Настройки cookie</h2>
              </div>
              {preferences && (
                <button
                  className="cookie-close-button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Закрыть настройки cookie"
                >
                  <X size={20} />
                </button>
              )}
            </header>

            <p className="cookie-settings-intro">
              Вы можете изменить выбор в любое время. Необходимые данные
              используются для функций, которые вы запросили; аналитика
              помогает улучшать магазин.
            </p>

            <div className="cookie-category">
              <span className="cookie-category-icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <strong>Необходимые</strong>
                <p>
                  Корзина, авторизация, безопасность и сохранение выбранных
                  настроек. Отключить их на сайте нельзя.
                </p>
              </div>
              <span className="cookie-always-on">
                <Check size={14} /> Всегда
              </span>
            </div>

            <label className="cookie-category selectable">
              <span className="cookie-category-icon">
                <BarChart3 size={20} />
              </span>
              <div>
                <strong>Аналитические</strong>
                <p>
                  Яндекс Метрика: посещаемость, источники переходов и
                  обезличенные действия. Вебвизор отключен.
                </p>
              </div>
              <input
                type="checkbox"
                checked={analyticsSelection}
                onChange={(event) =>
                  setAnalyticsSelection(event.target.checked)
                }
                aria-label="Разрешить аналитические cookie"
              />
              <span className="cookie-switch" aria-hidden="true" />
            </label>

            <footer>
              <Link href="/legal/cookies">Политика cookie</Link>
              <div>
                <button
                  className="cookie-secondary-button"
                  onClick={() => persistSelection(false)}
                >
                  Отклонить аналитику
                </button>
                <button
                  className="cookie-primary-button"
                  onClick={() => persistSelection(analyticsSelection)}
                >
                  Сохранить выбор
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

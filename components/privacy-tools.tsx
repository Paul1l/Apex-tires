"use client";

import Link from "next/link";
import { BarChart3, Check, Cookie, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/use-dialog-focus";
import {
  ANALYTICS_REVOKED_NOTICE_KEY,
  clearYandexMetrikaStorage,
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

const ANALYTICS_REVOKED_MESSAGE =
  "Аналитика отключена: Яндекс Метрика больше не работает, её cookie на этом сайте удалены.";

/**
 * Owns the cookie banner, detailed settings dialog, and analytics consent state.
 */
export function PrivacyTools() {
  const [preferences, setPreferences] =
    useState<CookieConsentPreferences | null>(null);
  const [consentReadFromBrowser, setConsentReadFromBrowser] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analyticsSelection, setAnalyticsSelection] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState("");

  useEffect(() => {
    let noticeIsPending = false;
    try {
      noticeIsPending = Boolean(
        window.sessionStorage.getItem(ANALYTICS_REVOKED_NOTICE_KEY),
      );
    } catch {
      // sessionStorage unavailable: nothing to show.
    }
    if (!noticeIsPending) return;
    // Let the live region mount first so that screen readers announce it.
    const timeoutId = window.setTimeout(() => {
      try {
        window.sessionStorage.removeItem(ANALYTICS_REVOKED_NOTICE_KEY);
      } catch {
        // Already shown once; nothing else to clean up.
      }
      setPrivacyNotice(ANALYTICS_REVOKED_MESSAGE);
    }, 600);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!privacyNotice) return;
    const timeoutId = window.setTimeout(() => setPrivacyNotice(""), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [privacyNotice]);

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
    const analyticsWasAllowed =
      readCookieConsentPreferences()?.analytics === true;
    const updatedPreferences =
      saveCookieConsentPreferences(analyticsAllowed);
    setPreferences(updatedPreferences);
    setSettingsOpen(false);

    if (analyticsWasAllowed && !analyticsAllowed) {
      // Consent withdrawn: remove Metrika's cookies and storage. A counter
      // that already runs on this page cannot be unloaded, so the page is
      // reloaded without it; the notice is shown after the reload.
      clearYandexMetrikaStorage();
      const metrikaIsLoaded =
        Boolean(window.ym) ||
        Boolean(document.querySelector("script[data-apex-metrika]"));
      if (metrikaIsLoaded) {
        try {
          window.sessionStorage.setItem(ANALYTICS_REVOKED_NOTICE_KEY, "1");
        } catch {
          // The reload still stops the counter; only the notice is lost.
        }
        window.location.reload();
        return;
      }
      setPrivacyNotice(ANALYTICS_REVOKED_MESSAGE);
    }
  }, []);

  const settingsOverlayReference = useRef<HTMLDivElement>(null);
  useDialogFocus(settingsOpen, settingsOverlayReference, () => {
    // Before the first choice the dialog must be answered, not dismissed.
    if (preferences) setSettingsOpen(false);
  });

  if (!consentReadFromBrowser) return null;

  return (
    <>
      <div className="privacy-notice-region" role="status" aria-live="polite" data-dialog-keep-active="">
        {privacyNotice && (
          <div className="privacy-notice">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>{privacyNotice}</span>
            <button
              type="button"
              onClick={() => setPrivacyNotice("")}
              aria-label="Скрыть уведомление"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
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
          ref={settingsOverlayReference}
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
            tabIndex={-1}
            data-autofocus
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

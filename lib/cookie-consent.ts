export const COOKIE_CONSENT_STORAGE_KEY = "apex.cookie-consent.v1";
export const COOKIE_CONSENT_UPDATED_EVENT = "apex:cookie-consent-updated";
export const OPEN_COOKIE_SETTINGS_EVENT = "apex:open-cookie-settings";
const COOKIE_CONSENT_VALIDITY_MILLISECONDS = 365 * 24 * 60 * 60 * 1000;

export interface CookieConsentPreferences {
  version: 1;
  necessary: true;
  analytics: boolean;
  updatedAt: string;
}

/**
 * Reads and validates the versioned consent record stored by this browser.
 */
export function readCookieConsentPreferences(): CookieConsentPreferences | null {
  try {
    const storedValue = window.localStorage.getItem(
      COOKIE_CONSENT_STORAGE_KEY,
    );
    if (!storedValue) return null;

    const parsedValue = JSON.parse(
      storedValue,
    ) as Partial<CookieConsentPreferences>;

    if (
      parsedValue.version !== 1 ||
      parsedValue.necessary !== true ||
      typeof parsedValue.analytics !== "boolean" ||
      typeof parsedValue.updatedAt !== "string"
    ) {
      return null;
    }

    const consentAge =
      Date.now() - new Date(parsedValue.updatedAt).getTime();
    if (
      !Number.isFinite(consentAge) ||
      consentAge < 0 ||
      consentAge > COOKIE_CONSENT_VALIDITY_MILLISECONDS
    ) {
      window.localStorage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
      return null;
    }

    return parsedValue as CookieConsentPreferences;
  } catch {
    return null;
  }
}

/**
 * Persists the visitor's optional analytics choice and notifies open UI.
 */
export function saveCookieConsentPreferences(
  analyticsAllowed: boolean,
): CookieConsentPreferences {
  const preferences: CookieConsentPreferences = {
    version: 1,
    necessary: true,
    analytics: analyticsAllowed,
    updatedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(
    COOKIE_CONSENT_STORAGE_KEY,
    JSON.stringify(preferences),
  );
  window.dispatchEvent(
    new CustomEvent<CookieConsentPreferences>(
      COOKIE_CONSENT_UPDATED_EVENT,
      { detail: preferences },
    ),
  );

  return preferences;
}

/**
 * Opens the global settings dialog without coupling the footer to its component.
 */
export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT));
}

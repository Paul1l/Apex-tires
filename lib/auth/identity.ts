export type AuthenticationIntent = "login" | "register";

const BLOCKED_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class IdentityValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IdentityValidationError";
    this.code = code;
  }
}

/**
 * Normalizes and validates an email used for passwordless authentication.
 * Personal Gmail mailboxes are intentionally unavailable by the product rule.
 */
export function normalizeEmailAddress(rawEmail: string): string {
  const normalizedEmail = rawEmail.trim().toLowerCase();
  if (
    normalizedEmail.length > 254 ||
    !EMAIL_PATTERN.test(normalizedEmail)
  ) {
    throw new IdentityValidationError(
      "INVALID_EMAIL",
      "Укажите корректный адрес электронной почты.",
    );
  }

  const emailDomain = normalizedEmail.split("@").at(-1) ?? "";
  if (BLOCKED_EMAIL_DOMAINS.has(emailDomain)) {
    throw new IdentityValidationError(
      "GMAIL_NOT_ALLOWED",
      "Регистрация с адресами Gmail недоступна. Используйте другую почту.",
    );
  }

  return normalizedEmail;
}

export function maskEmailAddress(email: string): string {
  const [localPart, domain] = email.split("@");
  const visiblePrefix = localPart.slice(0, Math.min(2, localPart.length));
  return `${visiblePrefix}${"•".repeat(Math.max(2, localPart.length - visiblePrefix.length))}@${domain}`;
}

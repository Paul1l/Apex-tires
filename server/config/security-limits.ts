/**
 * Abuse-protection thresholds. These are defensive limits, not business rules:
 * defaults are conservative and every value can be overridden through env.
 * Windows are fixed in code and documented in docs/VDS_DEPLOYMENT.md.
 */
export interface RateLimitRule {
  /** Namespace of the bucket key, e.g. `orders:ip`. */
  scope: string;
  limit: number;
  windowSeconds: number;
}

export interface SecurityLimits {
  orders: {
    perIp: RateLimitRule;
    perPhone: RateLimitRule;
    perEmail: RateLimitRule;
    maximumActiveReservationsPerContact: number;
  };
  fitmentRequests: { perIp: RateLimitRule; perPhone: RateLimitRule };
  guestCartWrites: { perIp: RateLimitRule };
  authCodeRequests: { perIp: RateLimitRule };
  oneC: { perIp: RateLimitRule };
  otp: { maximumFailedAttemptsPerEmail: number; failedAttemptsWindowSeconds: number };
}

const HOUR = 3_600;

interface LimitDefinition {
  variable: string;
  fallback: number;
  maximum: number;
}

const LIMIT_DEFINITIONS = {
  ordersPerIp: { variable: "RATE_LIMIT_ORDERS_PER_IP", fallback: 10, maximum: 100_000 },
  ordersPerContact: { variable: "RATE_LIMIT_ORDERS_PER_CONTACT", fallback: 5, maximum: 100_000 },
  activeReservationsPerContact: {
    variable: "ORDER_MAX_ACTIVE_RESERVATIONS_PER_CONTACT",
    fallback: 3,
    maximum: 1_000,
  },
  fitmentRequestsPerIp: { variable: "RATE_LIMIT_FITMENT_REQUESTS_PER_IP", fallback: 5, maximum: 100_000 },
  fitmentRequestsPerPhone: {
    variable: "RATE_LIMIT_FITMENT_REQUESTS_PER_PHONE",
    fallback: 3,
    maximum: 100_000,
  },
  guestCartWritesPerIp: { variable: "RATE_LIMIT_GUEST_CART_WRITES_PER_IP", fallback: 120, maximum: 1_000_000 },
  authCodeRequestsPerIp: { variable: "RATE_LIMIT_AUTH_CODE_REQUESTS_PER_IP", fallback: 30, maximum: 100_000 },
  oneCRequestsPerIp: { variable: "RATE_LIMIT_ONEC_REQUESTS_PER_IP", fallback: 120, maximum: 1_000_000 },
  otpFailedAttemptsPerEmail: {
    variable: "OTP_MAX_FAILED_ATTEMPTS_PER_EMAIL",
    fallback: 15,
    maximum: 1_000,
  },
} satisfies Record<string, LimitDefinition>;

type LimitName = keyof typeof LIMIT_DEFINITIONS;

export function readSecurityLimits(
  source: Record<string, string | undefined> = process.env,
): SecurityLimits {
  const invalidVariables: string[] = [];
  const values = {} as Record<LimitName, number>;
  for (const [name, definition] of Object.entries(LIMIT_DEFINITIONS) as Array<[LimitName, LimitDefinition]>) {
    const raw = source[definition.variable]?.trim();
    if (!raw) {
      values[name] = definition.fallback;
      continue;
    }
    const value = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < 1 || value > definition.maximum) {
      invalidVariables.push(definition.variable);
      continue;
    }
    values[name] = value;
  }
  if (invalidVariables.length > 0) {
    throw new Error(`Некорректная конфигурация backend: ${invalidVariables.join(", ")}`);
  }

  return {
    orders: {
      perIp: { scope: "orders:ip", limit: values.ordersPerIp, windowSeconds: HOUR },
      perPhone: { scope: "orders:phone", limit: values.ordersPerContact, windowSeconds: HOUR },
      perEmail: { scope: "orders:email", limit: values.ordersPerContact, windowSeconds: HOUR },
      maximumActiveReservationsPerContact: values.activeReservationsPerContact,
    },
    fitmentRequests: {
      perIp: { scope: "fitment-requests:ip", limit: values.fitmentRequestsPerIp, windowSeconds: HOUR },
      perPhone: { scope: "fitment-requests:phone", limit: values.fitmentRequestsPerPhone, windowSeconds: HOUR },
    },
    guestCartWrites: {
      perIp: { scope: "guest-cart:ip", limit: values.guestCartWritesPerIp, windowSeconds: 600 },
    },
    authCodeRequests: {
      perIp: { scope: "auth-request-code:ip", limit: values.authCodeRequestsPerIp, windowSeconds: HOUR },
    },
    oneC: {
      perIp: { scope: "1c:ip", limit: values.oneCRequestsPerIp, windowSeconds: 60 },
    },
    otp: {
      maximumFailedAttemptsPerEmail: values.otpFailedAttemptsPerEmail,
      failedAttemptsWindowSeconds: 24 * HOUR,
    },
  };
}

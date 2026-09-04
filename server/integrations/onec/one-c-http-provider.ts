import { setTimeout as delay } from "node:timers/promises";
import type { ServerEnvironment } from "../../config/environment";
import type {
  IncrementalSyncRequest,
  SendOrderOptions,
  SentOrderResponse,
} from "../erp/erp-integration-provider";
import type { ApplicationLogger, JsonValue } from "../../types/common";
import { ApplicationError } from "../../utils/errors";
import { OneCProvider } from "./one-c-provider";

interface OneCEndpoints {
  products: string;
  prices: string;
  stocks: string;
  orders: string;
  orderStatuses: string;
  health: string;
}

export interface OneCHttpProviderOptions {
  baseUrl: string;
  apiKey?: string;
  apiKeyHeader?: string;
  username?: string;
  password?: string;
  timeoutMilliseconds: number;
  safeRetryCount: number;
  endpoints?: Partial<OneCEndpoints>;
  logger?: ApplicationLogger;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: JsonValue;
  idempotencyKey?: string;
}

const DEFAULT_ENDPOINTS: Readonly<OneCEndpoints> = Object.freeze({
  products: "/catalog/products",
  prices: "/catalog/prices",
  stocks: "/catalog/stocks",
  orders: "/orders",
  orderStatuses: "/orders/status",
  health: "/health",
});

function createAuthorizationHeaders(
  options: OneCHttpProviderOptions,
): Record<string, string> {
  if (options.apiKey) {
    return { [options.apiKeyHeader ?? "X-API-Key"]: options.apiKey };
  }

  if (!options.username || !options.password) {
    throw new Error("Для HTTP-подключения к 1С не заданы учетные данные.");
  }

  const credentials = Buffer.from(
    `${options.username}:${options.password}`,
    "utf8",
  ).toString("base64");
  return { Authorization: `Basic ${credentials}` };
}

function responseCanBeRetried(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function createChangedSinceQuery(request: IncrementalSyncRequest = {}): string {
  return request.changedSince
    ? `?changedSince=${encodeURIComponent(request.changedSince)}`
    : "";
}

export class OneCHttpProvider extends OneCProvider {
  private readonly baseUrl: string;
  private readonly timeoutMilliseconds: number;
  private readonly safeRetryCount: number;
  private readonly authorizationHeaders: Record<string, string>;
  private readonly endpoints: OneCEndpoints;
  private readonly logger?: ApplicationLogger;

  constructor(options: OneCHttpProviderOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMilliseconds = options.timeoutMilliseconds;
    this.safeRetryCount = options.safeRetryCount;
    this.authorizationHeaders = createAuthorizationHeaders(options);
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...options.endpoints };
    this.logger = options.logger;
  }

  async request(endpoint: string, options: RequestOptions = {}): Promise<unknown> {
    const method = options.method ?? "GET";
    const idempotencyKey = options.idempotencyKey;
    const maximumAttempts =
      method === "GET" || idempotencyKey ? this.safeRetryCount + 1 : 1;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        this.timeoutMilliseconds,
      );

      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...this.authorizationHeaders,
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: abortController.signal,
        });

        if (!response.ok) {
          if (responseCanBeRetried(response.status) && attempt < maximumAttempts) {
            await delay(250 * 2 ** (attempt - 1));
            continue;
          }

          throw new ApplicationError({
            code: "ONEC_HTTP_ERROR",
            message: `1С вернула HTTP ${response.status}.`,
            statusCode: 502,
          });
        }

        if (response.status === 204) return null;
        return await response.json();
      } catch (error) {
        const retryableNetworkError =
          !(error instanceof ApplicationError) || error.code === "ONEC_HTTP_ERROR";

        if (retryableNetworkError && attempt < maximumAttempts) {
          this.logger?.warn(
            { attempt, endpoint, method },
            "Retrying a safe 1C request",
          );
          await delay(250 * 2 ** (attempt - 1));
          continue;
        }

        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError({
          code: "ONEC_UNAVAILABLE",
          message: "1С временно недоступна.",
          statusCode: 503,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new ApplicationError({
      code: "ONEC_UNAVAILABLE",
      message: "1С временно недоступна.",
      statusCode: 503,
    });
  }

  getProducts(request?: IncrementalSyncRequest): Promise<unknown> {
    return this.request(`${this.endpoints.products}${createChangedSinceQuery(request)}`);
  }

  getPrices(request?: IncrementalSyncRequest): Promise<unknown> {
    return this.request(`${this.endpoints.prices}${createChangedSinceQuery(request)}`);
  }

  getStocks(request?: IncrementalSyncRequest): Promise<unknown> {
    return this.request(`${this.endpoints.stocks}${createChangedSinceQuery(request)}`);
  }

  async sendOrder(
    order: JsonValue,
    { idempotencyKey }: SendOrderOptions,
  ): Promise<SentOrderResponse> {
    const response = await this.request(this.endpoints.orders, {
      method: "POST",
      body: order,
      idempotencyKey,
    });
    if (typeof response !== "object" || response === null) return {};
    const externalOrderId = Reflect.get(response, "externalOrderId");
    return typeof externalOrderId === "string" ? { externalOrderId } : {};
  }

  getOrderStatus(externalOrderId: string): Promise<unknown> {
    return this.request(
      `${this.endpoints.orderStatuses}/${encodeURIComponent(externalOrderId)}`,
    );
  }

  healthCheck(): Promise<unknown> {
    return this.request(this.endpoints.health);
  }
}

export function createOneCProvider(
  environment: ServerEnvironment,
  logger: ApplicationLogger,
): OneCHttpProvider {
  if (!environment.ONEC_BASE_URL) {
    throw new Error("ONEC_BASE_URL не настроен.");
  }

  return new OneCHttpProvider({
    baseUrl: environment.ONEC_BASE_URL,
    apiKey: environment.ONEC_API_KEY,
    apiKeyHeader: environment.ONEC_API_KEY_HEADER,
    username: environment.ONEC_USERNAME,
    password: environment.ONEC_PASSWORD,
    timeoutMilliseconds: environment.ONEC_REQUEST_TIMEOUT_MS,
    safeRetryCount: environment.ONEC_SAFE_RETRY_COUNT,
    logger,
  });
}

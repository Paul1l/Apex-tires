import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { FixedWindowRateLimiter } from "@/server/security/fixed-window-rate-limiter";
import { applicationLogger } from "@/server/types/common";
import { requestHasValidApiKey } from "@/server/utils/authentication";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import {
  batchEnvelopeSchema,
  formatValidationIssues,
  orderStatusSchema,
  priceSchema,
  productFitmentsSchema,
  productSchema,
  stockSchema,
} from "@/server/validators/one-c-schemas";
import type { SynchronizationResponse } from "@/server/repositories/integration-sync-log-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const integrationRateLimiter = new FixedWindowRateLimiter(120, 60_000);

interface RouteContext {
  params: Promise<{ action: string[] }>;
}

function jsonWithNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function synchronizationResponse(result: SynchronizationResponse): NextResponse {
  return jsonWithNoStore(result, result.failed > 0 ? 207 : 200);
}

function validateIntegrationRequest(request: Request) {
  if (!databaseIsConfigured()) {
    throw new ApplicationError({
      code: "DATABASE_NOT_CONFIGURED",
      message: "PostgreSQL для интеграции ещё не настроен.",
      statusCode: 503,
    });
  }

  const services = createApplicationServices();
  const integrationApiKey = services.environment.INTEGRATION_API_KEY;
  if (!integrationApiKey) {
    throw new ApplicationError({
      code: "INTEGRATION_NOT_CONFIGURED",
      message: "Ключ API интеграции ещё не настроен.",
      statusCode: 503,
    });
  }

  if (!requestHasValidApiKey(request, integrationApiKey)) {
    throw new ApplicationError({
      code: "UNAUTHORIZED",
      message: "Не удалось подтвердить доступ к API.",
      statusCode: 401,
    });
  }

  const clientAddress =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rateLimit = integrationRateLimiter.consume(clientAddress);
  if (!rateLimit.allowed) {
    throw new ApplicationError({
      code: "RATE_LIMIT_EXCEEDED",
      message: `Превышен лимит запросов. Повторите через ${rateLimit.retryAfter} сек.`,
      statusCode: 429,
    });
  }

  return services;
}

async function parseBatchEnvelope(request: Request) {
  const validationResult = batchEnvelopeSchema.safeParse(
    await readJsonRequest(request, 10_000_000),
  );
  if (!validationResult.success) {
    throw new ApplicationError({
      code: "VALIDATION_ERROR",
      message: "Пакет не соответствует контракту API 1С.",
      statusCode: 422,
      details: formatValidationIssues(validationResult.error),
    });
  }
  return validationResult.data;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const services = validateIntegrationRequest(request);
    const action = (await context.params).action.join("/");

    if (action === "health") {
      return jsonWithNoStore(await services.integrationStatusService.getHealth());
    }

    if (action === "orders") {
      const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
      const limit = Number.isInteger(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 500)
        : 100;
      return jsonWithNoStore(
        await services.orderIntegrationService.getOrdersForOneC(limit),
      );
    }

    throw new ApplicationError({
      code: "ENDPOINT_NOT_FOUND",
      message: "Запрошенный метод интеграции не найден.",
      statusCode: 404,
    });
  } catch (error) {
    applicationLogger.error({ error }, "1C integration GET request failed");
    const safeError = toSafeError(error);
    return jsonWithNoStore(safeError.body, safeError.statusCode);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const services = validateIntegrationRequest(request);
    const action = (await context.params).action.join("/");
    const envelope = await parseBatchEnvelope(request);

    switch (action) {
      case "products":
      case "products/batch":
        return synchronizationResponse(
          await services.synchronizationService.synchronizeProducts(
            envelope,
            productSchema,
          ),
        );
      case "prices":
      case "prices/batch":
        return synchronizationResponse(
          await services.synchronizationService.synchronizePrices(
            envelope,
            priceSchema,
          ),
        );
      case "stocks":
      case "stocks/batch":
        return synchronizationResponse(
          await services.synchronizationService.synchronizeStocks(
            envelope,
            stockSchema,
          ),
        );
      case "fitments":
      case "fitments/batch":
        return synchronizationResponse(
          await services.synchronizationService.synchronizeFitments(
            envelope,
            productFitmentsSchema,
          ),
        );
      case "order-statuses":
      case "order-statuses/batch":
        return synchronizationResponse(
          await services.orderIntegrationService.synchronizeOrderStatuses(
            envelope,
            orderStatusSchema,
          ),
        );
      default:
        throw new ApplicationError({
          code: "ENDPOINT_NOT_FOUND",
          message: "Запрошенный метод интеграции не найден.",
          statusCode: 404,
        });
    }
  } catch (error) {
    applicationLogger.error({ error }, "1C integration POST request failed");
    const safeError = toSafeError(error);
    return jsonWithNoStore(safeError.body, safeError.statusCode);
  }
}

import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { readSecurityLimits } from "@/server/config/security-limits";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { validateCreateOrder } from "@/server/validators/order-schemas";
import { getAuthenticatedUser } from "@/server/security/request-auth";
import { requireSameOrigin } from "@/server/security/request-origin";
import { clientIpRateLimitKey, getClientIp } from "@/server/security/client-ip";
import {
  enforceRateLimit,
  normalizeEmailForLimits,
} from "@/server/security/rate-limit-policies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOO_MANY_ORDERS_MESSAGE =
  "Слишком много заказов за короткое время. Для срочного заказа позвоните менеджеру.";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "ORDER_STORAGE_NOT_CONFIGURED",
        message:
          "Приём реальных заказов пока не подключён. Позвоните менеджеру или попробуйте позже.",
        statusCode: 503,
      });
    }

    const services = createApplicationServices();
    const limits = readSecurityLimits();
    const clientIp = getClientIp(request);
    await enforceRateLimit(
      services.rateLimiter,
      limits.orders.perIp,
      clientIpRateLimitKey(clientIp),
      { message: TOO_MANY_ORDERS_MESSAGE },
    );

    const validationResult = validateCreateOrder(await readJsonRequest(request, 100_000));
    if (!validationResult.success || !validationResult.data) {
      throw new ApplicationError({
        code: "VALIDATION_ERROR",
        message: validationResult.message,
        statusCode: 422,
        details: validationResult.details,
      });
    }

    const order = validationResult.data;
    await enforceRateLimit(services.rateLimiter, limits.orders.perPhone, order.customer.phone, {
      message: TOO_MANY_ORDERS_MESSAGE,
    });
    await enforceRateLimit(
      services.rateLimiter,
      limits.orders.perEmail,
      normalizeEmailForLimits(order.customer.email),
      { message: TOO_MANY_ORDERS_MESSAGE },
    );

    const authenticatedUser = await getAuthenticatedUser(request);
    const createdOrder = await services.orderService.createOrder(order, {
      userId: authenticatedUser?.id,
      requesterAddress: clientIp,
      userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    });
    return NextResponse.json(
      {
        ok: true,
        order: {
          id: createdOrder.id,
          number: createdOrder.number,
          duplicate: createdOrder.duplicate ?? false,
        },
      },
      { status: createdOrder.duplicate ? 200 : 201 },
    );
  } catch (error) {
    applicationLogger.error({ error }, "Order creation failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

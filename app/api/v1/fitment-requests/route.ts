import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
  getRateLimiter,
} from "@/server/bootstrap/application-services";
import { readSecurityLimits } from "@/server/config/security-limits";
import { applicationLogger } from "@/server/types/common";
import { clientIpRateLimitKey, getClientIp } from "@/server/security/client-ip";
import { enforceRateLimit } from "@/server/security/rate-limit-policies";
import { requireSameOrigin } from "@/server/security/request-origin";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { createFitmentRequestSchema } from "@/server/validators/fitment-request-schema";
import { formatValidationIssues } from "@/server/validators/one-c-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_ERROR = {
  code: "RATE_LIMITED",
  message: "Слишком много заявок.",
};

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const limits = readSecurityLimits();
    const rateLimiter = getRateLimiter();
    await enforceRateLimit(
      rateLimiter,
      limits.fitmentRequests.perIp,
      clientIpRateLimitKey(getClientIp(request)),
      RATE_LIMIT_ERROR,
    );
    if (!databaseIsConfigured()) {
      throw new ApplicationError({
        code: "FITMENT_REQUEST_STORAGE_NOT_CONFIGURED",
        message: "Приём заявок на подбор пока не подключён.",
        statusCode: 503,
      });
    }

    const validationResult = createFitmentRequestSchema.safeParse(
      await readJsonRequest(request, 50_000),
    );
    if (!validationResult.success) {
      throw new ApplicationError({
        code: "VALIDATION_ERROR",
        message: "Проверьте автомобиль, имя, российский телефон и согласие.",
        statusCode: 422,
        details: formatValidationIssues(validationResult.error),
      });
    }
    await enforceRateLimit(
      rateLimiter,
      limits.fitmentRequests.perPhone,
      validationResult.data.customerPhone,
      RATE_LIMIT_ERROR,
    );

    const fitmentRequest =
      await createApplicationServices().fitmentRequestService.create(
        validationResult.data,
      );
    return NextResponse.json({ ok: true, request: fitmentRequest }, { status: 201 });
  } catch (error) {
    applicationLogger.error({ error }, "Fitment request creation failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

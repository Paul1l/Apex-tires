import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { FixedWindowRateLimiter } from "@/server/security/fixed-window-rate-limiter";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { createFitmentRequestSchema } from "@/server/validators/fitment-request-schema";
import { formatValidationIssues } from "@/server/validators/one-c-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rateLimiter = new FixedWindowRateLimiter(5, 60 * 60 * 1_000);

export async function POST(request: Request) {
  try {
    const requesterAddress =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const rateLimit = rateLimiter.consume(requesterAddress);
    if (!rateLimit.allowed) {
      throw new ApplicationError({
        code: "RATE_LIMITED",
        message: "Слишком много заявок. Повторите попытку позже.",
        statusCode: 429,
      });
    }
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

import { NextResponse } from "next/server";
import {
  createApplicationServices,
  databaseIsConfigured,
} from "@/server/bootstrap/application-services";
import { applicationLogger } from "@/server/types/common";
import { requestHasValidApiKey } from "@/server/utils/authentication";
import { ApplicationError, toSafeError } from "@/server/utils/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROVIDER_NOT_CONFIGURED_MESSAGE =
  "Провайдер уведомлений не настроен, уведомления остаются в очереди.";

/**
 * Sends queued notifications (cron, every minute). Without a configured
 * provider (Postbox) the job succeeds without touching the outbox: nothing
 * is claimed or marked failed, so the queue is delivered once the provider is
 * set up, and cron does not report an error every minute.
 */
export async function POST(request: Request) {
  try {
    if (!databaseIsConfigured() || !process.env.INTERNAL_JOB_SECRET) {
      throw new ApplicationError({
        code: "NOTIFICATION_JOB_NOT_CONFIGURED",
        message: "Обработчик уведомлений пока не настроен.",
        statusCode: 503,
      });
    }
    if (
      !requestHasValidApiKey(
        request,
        process.env.INTERNAL_JOB_SECRET,
        "X-Job-Key",
      )
    ) {
      throw new ApplicationError({
        code: "UNAUTHORIZED",
        message: "Неверный ключ фонового задания.",
        statusCode: 401,
      });
    }
    const { notificationService } = createApplicationServices();
    if (!notificationService.hasProviders()) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        failed: 0,
        providerConfigured: false,
        queued: await notificationService.countUnsent(),
        message: PROVIDER_NOT_CONFIGURED_MESSAGE,
      });
    }
    const result = await notificationService.processPending(20);
    return NextResponse.json({ ok: result.failed === 0, ...result });
  } catch (error) {
    applicationLogger.error({ error }, "Notification job failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

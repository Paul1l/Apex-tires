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

export async function POST(request: Request) {
  try {
    if (
      !databaseIsConfigured() ||
      !process.env.INTERNAL_JOB_SECRET ||
      !process.env.YANDEX_POSTBOX_ACCESS_KEY_ID ||
      !process.env.YANDEX_POSTBOX_SECRET_ACCESS_KEY ||
      !process.env.YANDEX_POSTBOX_FROM_EMAIL
    ) {
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
    const result =
      await createApplicationServices().notificationService.processPending(20);
    return NextResponse.json({ ok: result.failed === 0, ...result });
  } catch (error) {
    applicationLogger.error({ error }, "Notification job failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

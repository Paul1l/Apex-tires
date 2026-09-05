import { ApplicationError } from "../utils/errors";

export function requireSameOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).origin;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expectedOrigin)) {
    throw new ApplicationError({ code: "UNTRUSTED_ORIGIN", message: "Отправьте запрос со страницы магазина.", statusCode: 403 });
  }
}

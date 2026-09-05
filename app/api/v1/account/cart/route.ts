import { NextResponse } from "next/server";
import { createApplicationServices, databaseIsConfigured } from "@/server/bootstrap/application-services";
import { getAuthenticatedUser } from "@/server/security/request-auth";
import { applicationLogger } from "@/server/types/common";
import { ApplicationError, toSafeError } from "@/server/utils/errors";
import { readJsonRequest } from "@/server/utils/http";
import { cartLinesSchema, type CartLinesInput } from "@/server/validators/cart-schema";
import { createSecureDigest, generateOpaqueToken } from "@/lib/auth/security";
import { GUEST_CART_COOKIE_NAME, SESSION_LIFETIME_SECONDS } from "@/lib/auth/session";
import type { PersistedCartLine } from "@/server/repositories/cart-repository";
import { requireSameOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readCookie(request: Request, name: string): string | null {
  const item = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  const token = item?.slice(name.length + 1);
  return token && /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : null;
}

async function executeCartOperation(
  request: Request,
  operation: (owner: { userId?: string; anonymousHash?: string }) => Promise<PersistedCartLine[]>,
) {
  try {
    requireSameOrigin(request);
    if (!databaseIsConfigured()) throw new ApplicationError({
      code: "CART_STORAGE_NOT_CONFIGURED", message: "Хранение корзины пока не подключено.", statusCode: 503,
    });
    const securitySecret = process.env.OTP_CODE_PEPPER;
    if (!securitySecret) throw new ApplicationError({
      code: "CART_SECURITY_NOT_CONFIGURED", message: "Безопасное хранение гостевой корзины пока не настроено.", statusCode: 503,
    });
    const services = createApplicationServices();
    const user = await getAuthenticatedUser(request);
    const existingGuestToken = readCookie(request, GUEST_CART_COOKIE_NAME);
    if (user) {
      if (existingGuestToken) {
        await services.cartService.mergeAnonymousCart(user.id, await createSecureDigest(securitySecret, existingGuestToken));
      }
      const items = await operation({ userId: user.id });
      const products = await services.catalogService.getProductsByIds(items.map((item) => item.productId));
      const response = NextResponse.json({ ok: true, items, products }, { headers: { "Cache-Control": "private, no-store" } });
      if (existingGuestToken) response.cookies.delete(GUEST_CART_COOKIE_NAME);
      return response;
    }
    const guestToken = existingGuestToken ?? generateOpaqueToken();
    const anonymousHash = await createSecureDigest(securitySecret, guestToken);
    const items = await operation({ anonymousHash });
    const products = await services.catalogService.getProductsByIds(items.map((item) => item.productId));
    const response = NextResponse.json({ ok: true, items, products }, { headers: { "Cache-Control": "private, no-store" } });
    if (!existingGuestToken) response.cookies.set(GUEST_CART_COOKIE_NAME, guestToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      maxAge: SESSION_LIFETIME_SECONDS, path: "/",
    });
    return response;
  } catch (error) {
    applicationLogger.error({ error }, "Cart request failed");
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
}

export async function GET(request: Request) {
  return executeCartOperation(request, ({ userId, anonymousHash }) =>
    userId
      ? createApplicationServices().cartService.getCart(userId)
      : createApplicationServices().cartService.getAnonymousCart(anonymousHash as string),
  );
}

export async function PUT(request: Request) {
  let payload: CartLinesInput;
  try {
    const validation = cartLinesSchema.safeParse(await readJsonRequest(request, 100_000));
    if (!validation.success) throw new ApplicationError({
      code: "VALIDATION_ERROR", message: "Проверьте состав корзины.", statusCode: 422,
    });
    payload = validation.data;
  } catch (error) {
    const safeError = toSafeError(error);
    return NextResponse.json(safeError.body, { status: safeError.statusCode });
  }
  return executeCartOperation(request, ({ userId, anonymousHash }) =>
    userId
      ? createApplicationServices().cartService.replaceCart(userId, payload.items)
      : createApplicationServices().cartService.replaceAnonymousCart(anonymousHash as string, payload.items),
  );
}

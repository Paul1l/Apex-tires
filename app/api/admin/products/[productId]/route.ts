import { revalidateStorefrontProduct } from "@/server/cache/storefront-revalidation";
import { requireUserRole } from "@/server/security/request-auth";
import {
  ADMIN_CATALOG_JSON_LIMIT_BYTES,
  adminErrorResponse,
  adminJson,
  parseRouteId,
  requireCatalogDatabase,
} from "@/server/services/admin-catalog-http";
import { productNotFound } from "@/server/services/admin-catalog-product-service";
import { createAdminCatalogServices } from "@/server/services/admin-catalog-services";
import { readJsonRequest } from "@/server/utils/http";
import { updateProductSchema } from "@/server/validators/admin-product-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ productId: string }> };

async function readProductId(context: RouteContext): Promise<string> {
  return parseRouteId((await context.params).productId, "INVALID_PRODUCT_ID", "Некорректный идентификатор товара.");
}

/** Everything the editor shows: card, price, stock per warehouse, photos, locks, version. */
export async function GET(request: Request, context: RouteContext) {
  try {
    requireCatalogDatabase();
    await requireUserRole(request, ["manager", "admin"]);
    const product = await createAdminCatalogServices().products.getEditorData(await readProductId(context));
    if (!product) throw productNotFound();
    return adminJson({ ok: true, product });
  } catch (error) {
    return adminErrorResponse(error, "products.get");
  }
}

/**
 * Saves changed card fields, price and stock in one transaction. `version`
 * must match the stored one (409 PRODUCT_VERSION_CONFLICT otherwise); fields
 * owned by 1C are refused for 1C products (409 PRODUCT_SOURCE_CONFLICT).
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    requireCatalogDatabase();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const productId = await readProductId(context);
    const input = updateProductSchema.parse(await readJsonRequest(request, ADMIN_CATALOG_JSON_LIMIT_BYTES));
    const result = await createAdminCatalogServices().products.update(actor.id, productId, input);
    if (result.changed) revalidateStorefrontProduct("admin-product-updated", result);
    return adminJson({ ok: true, changed: result.changed, version: result.version });
  } catch (error) {
    return adminErrorResponse(error, "products.update");
  }
}

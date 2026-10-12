import { revalidateStorefrontProduct } from "@/server/cache/storefront-revalidation";
import { requireUserRole } from "@/server/security/request-auth";
import {
  adminErrorResponse,
  adminJson,
  parseRouteId,
  requireCatalogDatabase,
} from "@/server/services/admin-catalog-http";
import { createAdminCatalogServices } from "@/server/services/admin-catalog-services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ productId: string; fitmentId: string }> };

/**
 * Revokes a fitment (verified = false): it stops applying to every product of
 * this size, the row stays for history and can be verified again.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireCatalogDatabase();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const params = await context.params;
    const productId = parseRouteId(params.productId, "INVALID_PRODUCT_ID", "Некорректный идентификатор товара.");
    const fitmentId = parseRouteId(params.fitmentId, "INVALID_FITMENT_ID", "Некорректный идентификатор применимости.");
    const result = await createAdminCatalogServices().fitments.revoke(actor.id, productId, fitmentId);
    revalidateStorefrontProduct("admin-fitment-revoked", result.product);
    return adminJson({ ok: true });
  } catch (error) {
    return adminErrorResponse(error, "products.fitments.revoke");
  }
}

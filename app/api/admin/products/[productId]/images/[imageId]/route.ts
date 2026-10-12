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

type RouteContext = { params: Promise<{ productId: string; imageId: string }> };

/** Deletes a photo record; a file is deleted only if the site stored it for this product. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireCatalogDatabase();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const params = await context.params;
    const productId = parseRouteId(params.productId, "INVALID_PRODUCT_ID", "Некорректный идентификатор товара.");
    const imageId = parseRouteId(params.imageId, "INVALID_IMAGE_ID", "Некорректный идентификатор фото.");
    const result = await createAdminCatalogServices().images.deleteImage(actor.id, productId, imageId);
    revalidateStorefrontProduct("admin-product-image-deleted", result.product);
    return adminJson({ ok: true, images: result.images });
  } catch (error) {
    return adminErrorResponse(error, "products.images.delete");
  }
}

import { revalidateStorefrontProduct } from "@/server/cache/storefront-revalidation";
import { requireUserRole } from "@/server/security/request-auth";
import {
  adminErrorResponse,
  adminJson,
  parseRouteId,
  requireCatalogDatabase,
} from "@/server/services/admin-catalog-http";
import { createAdminCatalogServices } from "@/server/services/admin-catalog-services";
import { isMultipartRequest, readImageUpload } from "@/server/storage/image-upload-request";
import { readJsonRequest } from "@/server/utils/http";
import { addImageUrlSchema, updateImagesSchema } from "@/server/validators/admin-product-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ productId: string }> };

async function readProductId(context: RouteContext): Promise<string> {
  return parseRouteId((await context.params).productId, "INVALID_PRODUCT_ID", "Некорректный идентификатор товара.");
}

/**
 * Adds a photo:
 * - multipart/form-data with `file` (JPEG/PNG/WebP by content, size limit
 *   PRODUCT_IMAGE_MAX_BYTES) and optional `alt` — stored under UPLOADS_DIR;
 * - application/json {url: "https://…", alt} — a link, nothing is downloaded.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    requireCatalogDatabase();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const productId = await readProductId(context);
    const services = createAdminCatalogServices();
    let result;
    if (isMultipartRequest(request)) {
      const { storage, environment } = await services.images.requireUploads();
      const upload = await readImageUpload(request, environment.productImageMaxBytes);
      result = await services.images.addUploadedImage(actor.id, productId, upload, storage, environment.productImageMaxCount);
    } else {
      const input = addImageUrlSchema.parse(await readJsonRequest(request, 10_000));
      result = await services.images.addImageByUrl(actor.id, productId, input);
    }
    revalidateStorefrontProduct("admin-product-image-added", result.product);
    return adminJson({ ok: true, images: result.images }, 201);
  } catch (error) {
    return adminErrorResponse(error, "products.images.add");
  }
}

/** Order (first photo is the main one) and alt texts of the editable photos. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    requireCatalogDatabase();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const productId = await readProductId(context);
    const input = updateImagesSchema.parse(await readJsonRequest(request, 50_000));
    const result = await createAdminCatalogServices().images.updateImages(actor.id, productId, input);
    revalidateStorefrontProduct("admin-product-images-updated", result.product);
    return adminJson({ ok: true, images: result.images });
  } catch (error) {
    return adminErrorResponse(error, "products.images.update");
  }
}

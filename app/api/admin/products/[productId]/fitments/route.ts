import { revalidateStorefrontProduct } from "@/server/cache/storefront-revalidation";
import { requireUserRole } from "@/server/security/request-auth";
import {
  adminErrorResponse,
  adminJson,
  parseRouteId,
  requireCatalogDatabase,
} from "@/server/services/admin-catalog-http";
import { productNotFound } from "@/server/services/admin-catalog-product-service";
import { createAdminCatalogServices } from "@/server/services/admin-catalog-services";
import { readJsonRequest } from "@/server/utils/http";
import { addFitmentSchema } from "@/server/validators/admin-product-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ productId: string }> };

async function readProductId(context: RouteContext): Promise<string> {
  return parseRouteId((await context.params).productId, "INVALID_PRODUCT_ID", "Некорректный идентификатор товара.");
}

/** Verified vehicle fitments that the storefront applies to this product (by its size). */
export async function GET(request: Request, context: RouteContext) {
  try {
    requireCatalogDatabase();
    await requireUserRole(request, ["manager", "admin"]);
    const fitments = await createAdminCatalogServices().fitments.list(await readProductId(context));
    if (!fitments) throw productNotFound();
    return adminJson({ ok: true, ...fitments });
  } catch (error) {
    return adminErrorResponse(error, "products.fitments.list");
  }
}

/** Adds a verified manual fitment: vehicle from the reference + the product's size. */
export async function POST(request: Request, context: RouteContext) {
  try {
    requireCatalogDatabase();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const productId = await readProductId(context);
    const input = addFitmentSchema.parse(await readJsonRequest(request, 10_000));
    const result = await createAdminCatalogServices().fitments.add(actor.id, productId, input);
    revalidateStorefrontProduct("admin-fitment-added", result.product);
    return adminJson({ ok: true, fitmentId: result.fitmentId, created: result.created }, result.created ? 201 : 200);
  } catch (error) {
    return adminErrorResponse(error, "products.fitments.add");
  }
}

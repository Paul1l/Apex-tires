import { revalidateStorefrontProduct } from "@/server/cache/storefront-revalidation";
import { requireUserRole } from "@/server/security/request-auth";
import {
  ADMIN_CATALOG_JSON_LIMIT_BYTES,
  adminErrorResponse,
  adminJson,
  requireCatalogDatabase,
} from "@/server/services/admin-catalog-http";
import { createAdminCatalogServices } from "@/server/services/admin-catalog-services";
import { readJsonRequest } from "@/server/utils/http";
import { parseCreateProductInput } from "@/server/services/admin-catalog-rules";
import { adminProductListQuerySchema } from "@/server/validators/admin-product-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Staff product list: every product (also without a price), search by SKU,
 * article, name, model or brand, filters and pages of up to 100 rows.
 * Stored stock, reserves and 1C identifiers are shown as they are.
 */
export async function GET(request: Request) {
  try {
    requireCatalogDatabase();
    await requireUserRole(request, ["manager", "admin"]);
    const query = adminProductListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    return adminJson(await createAdminCatalogServices().products.list(query));
  } catch (error) {
    return adminErrorResponse(error, "products.list");
  }
}

/** Creates a product (source manual) with optional price and stock. */
export async function POST(request: Request) {
  try {
    requireCatalogDatabase();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    // All schema problems and all missing required fields in one answer.
    const input = parseCreateProductInput(await readJsonRequest(request, ADMIN_CATALOG_JSON_LIMIT_BYTES));
    const product = await createAdminCatalogServices().products.create(actor.id, input);
    revalidateStorefrontProduct("admin-product-created", product);
    return adminJson({ ok: true, product }, 201);
  } catch (error) {
    return adminErrorResponse(error, "products.create");
  }
}

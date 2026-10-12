import { revalidateStorefrontCatalog } from "@/server/cache/storefront-revalidation";
import { requireUserRole } from "@/server/security/request-auth";
import {
  adminErrorResponse,
  adminJson,
  requireCatalogDatabase,
} from "@/server/services/admin-catalog-http";
import { createAdminCatalogServices } from "@/server/services/admin-catalog-services";
import { readJsonRequest } from "@/server/utils/http";
import { createBrandSchema } from "@/server/validators/admin-product-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireCatalogDatabase();
    await requireUserRole(request, ["manager", "admin"]);
    return adminJson({ ok: true, items: await createAdminCatalogServices().references.listBrands() });
  } catch (error) {
    return adminErrorResponse(error, "brands.list");
  }
}

/** Creates a brand; an existing brand with the same name (any case) is returned instead. */
export async function POST(request: Request) {
  try {
    requireCatalogDatabase();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const input = createBrandSchema.parse(await readJsonRequest(request, 5_000));
    const result = await createAdminCatalogServices().references.createBrand(actor.id, input.name);
    if (result.created) revalidateStorefrontCatalog("admin-brand-created");
    return adminJson({ ok: true, ...result }, result.created ? 201 : 200);
  } catch (error) {
    return adminErrorResponse(error, "brands.create");
  }
}

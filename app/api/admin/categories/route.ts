import { requireUserRole } from "@/server/security/request-auth";
import {
  adminErrorResponse,
  adminJson,
  requireCatalogDatabase,
} from "@/server/services/admin-catalog-http";
import { createAdminCatalogServices } from "@/server/services/admin-catalog-services";
import { readJsonRequest } from "@/server/utils/http";
import { createCategorySchema } from "@/server/validators/admin-product-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireCatalogDatabase();
    await requireUserRole(request, ["manager", "admin"]);
    return adminJson({ ok: true, items: await createAdminCatalogServices().references.listCategories() });
  } catch (error) {
    return adminErrorResponse(error, "categories.list");
  }
}

/** Creates a category; one with the same name under the same parent is returned instead. */
export async function POST(request: Request) {
  try {
    requireCatalogDatabase();
    const actor = await requireUserRole(request, ["manager", "admin"]);
    const input = createCategorySchema.parse(await readJsonRequest(request, 5_000));
    const result = await createAdminCatalogServices().references.createCategory(actor.id, input);
    return adminJson({ ok: true, ...result }, result.created ? 201 : 200);
  } catch (error) {
    return adminErrorResponse(error, "categories.create");
  }
}

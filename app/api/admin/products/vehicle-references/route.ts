import { requireUserRole } from "@/server/security/request-auth";
import {
  adminErrorResponse,
  adminJson,
  requireCatalogDatabase,
} from "@/server/services/admin-catalog-http";
import { createAdminCatalogServices } from "@/server/services/admin-catalog-services";
import { vehicleReferenceQuerySchema } from "@/server/validators/admin-product-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vehicle reference for adding fitments: ?level=makes, then
 * ?level=models|generations|modifications&parentId=<uuid>. Lists every
 * active entry, also those without fitments yet.
 */
export async function GET(request: Request) {
  try {
    requireCatalogDatabase();
    await requireUserRole(request, ["manager", "admin"]);
    const query = vehicleReferenceQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    return adminJson({ ok: true, items: await createAdminCatalogServices().fitments.listVehicleReferences(query) });
  } catch (error) {
    return adminErrorResponse(error, "products.vehicle-references");
  }
}

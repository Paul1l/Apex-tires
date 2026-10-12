import { requireUserRole } from "@/server/security/request-auth";
import {
  adminErrorResponse,
  adminJson,
  requireCatalogDatabase,
} from "@/server/services/admin-catalog-http";
import { createAdminCatalogServices } from "@/server/services/admin-catalog-services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Active warehouses (read only; they come from CSV import and the 1C exchange). */
export async function GET(request: Request) {
  try {
    requireCatalogDatabase();
    await requireUserRole(request, ["manager", "admin"]);
    return adminJson({ ok: true, items: await createAdminCatalogServices().references.listWarehouses() });
  } catch (error) {
    return adminErrorResponse(error, "warehouses.list");
  }
}

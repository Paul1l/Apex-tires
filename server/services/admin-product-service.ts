import type { Pool } from "pg";
import type { z } from "zod";
import { withTransaction } from "../database/postgres-client";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import { ApplicationError } from "../utils/errors";
import type { bulkProductSchema } from "../validators/admin-product-schema";

export async function updateSelectedProducts(pool: Pool, actorUserId: string, input: z.infer<typeof bulkProductSchema>): Promise<number> {
  return withTransaction(pool, async (database) => {
    const products = await database.query<{ id: string; source_system: string }>("SELECT id,source_system FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [input.productIds]);
    if (products.rows.length !== input.productIds.length) throw new ApplicationError({ code: "PRODUCT_NOT_FOUND", message: "Часть выбранных товаров не найдена. Обновите список.", statusCode: 409 });
    if (products.rows.some((product) => product.source_system === "1c")) throw new ApplicationError({ code: "PRODUCT_SOURCE_CONFLICT", message: "Выбранные товары управляются 1С. Измените их в учётной системе.", statusCode: 409 });
    if (input.action === "activate" || input.action === "deactivate") {
      await database.query("UPDATE products SET is_active=$2,updated_at=NOW() WHERE id=ANY($1::uuid[])", [input.productIds, input.action === "activate"]);
    } else {
      const isBrand = input.action === "change_brand";
      const target = await database.query<{ id: string; name: string }>(isBrand ? "SELECT id,name FROM brands WHERE id=$1 AND is_active FOR SHARE" : "SELECT id,name FROM categories WHERE id=$1 AND is_active FOR SHARE", [input.targetId]);
      if (!target.rows.length) throw new ApplicationError({ code: "TARGET_UNAVAILABLE", message: "Выбранная категория или бренд недоступны.", statusCode: 422 });
      await database.query(isBrand ? "UPDATE products SET brand_id=$2,brand=$3,updated_at=NOW() WHERE id=ANY($1::uuid[])" : "UPDATE products SET category_id=$2,category=$3,updated_at=NOW() WHERE id=ANY($1::uuid[])", [input.productIds, target.rows[0].id, target.rows[0].name]);
    }
    await new AdminAuditRepository().record(database, { actorUserId, action: `products.bulk.${input.action}`, entityType: "products", details: { productIds: input.productIds, targetId: input.targetId ?? null } });
    return products.rows.length;
  });
}

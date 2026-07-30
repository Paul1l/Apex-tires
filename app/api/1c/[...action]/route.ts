import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const productSchema = z.object({
  externalId: z.string().min(1),
  sku: z.string().min(1),
  kind: z.enum(["tire", "wheel"]),
  brand: z.string().min(1),
  model: z.string().min(1),
  subtitle: z.string().default(""),
  width: z.number().int().nonnegative().default(0),
  profile: z.number().int().nonnegative().default(0),
  diameter: z.number().int().positive(),
  season: z.enum(["summer", "winter", "all-season", "none"]).default("none"),
  studded: z.boolean().default(false),
  runflat: z.boolean().default(false),
  pcd: z.string().optional(),
  offset: z.number().int().optional(),
  centerBore: z.number().optional(),
  color: z.string().optional(),
  country: z.string().optional(),
  tags: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
});

const productImportSchema = z.object({
  version: z.literal("1.0"),
  syncId: z.string().min(1),
  products: z.array(productSchema).max(1000),
});

const stockPriceSchema = z.object({
  version: z.literal("1.0"),
  syncId: z.string().min(1),
  rows: z.array(
    z.object({
      externalId: z.string().min(1),
      warehouseCode: z.string().min(1),
      warehouseName: z.string().min(1),
      quantity: z.number().int().nonnegative(),
      reserved: z.number().int().nonnegative().default(0),
      price: z.number().nonnegative(),
      oldPrice: z.number().nonnegative().optional(),
      currency: z.literal("RUB").default("RUB"),
    }),
  ).max(5000),
});

async function environment() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env as CloudflareEnv;
  } catch {
    return {
      ONEC_SHARED_SECRET: process.env.ONEC_SHARED_SECRET,
    } as CloudflareEnv;
  }
}

function sameToken(left: string, right: string) {
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function authorize(request: NextRequest) {
  const env = await environment();
  const configured = env.ONEC_SHARED_SECRET || process.env.ONEC_SHARED_SECRET || "";
  if (!configured) {
    return {
      response: NextResponse.json(
        { ok: false, code: "INTEGRATION_NOT_CONFIGURED", message: "ONEC_SHARED_SECRET is not configured" },
        { status: 503 },
      ),
      env,
    };
  }
  const provided = request.headers.get("x-1c-token") || "";
  if (!provided || !sameToken(configured, provided)) {
    return {
      response: NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", message: "Invalid X-1C-Token" },
        { status: 401 },
      ),
      env,
    };
  }
  return { response: null, env };
}

function route(params: { action: string[] }) {
  return params.action.join("/");
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ action: string[] }> },
) {
  const params = await context.params;
  const action = route(params);

  if (action === "health") {
    const env = await environment();
    return NextResponse.json({
      ok: true,
      service: "apex-1c-gateway",
      apiVersion: "1.0",
      secretConfigured: Boolean(env.ONEC_SHARED_SECRET || process.env.ONEC_SHARED_SECRET),
      databaseConfigured: Boolean(env.DB),
      timestamp: new Date().toISOString(),
    });
  }

  const auth = await authorize(request);
  if (auth.response) return auth.response;

  if (action === "orders/export") {
    if (!auth.env.DB) {
      return NextResponse.json({
        ok: true,
        mode: "validation-only",
        orders: [],
        cursor: null,
        message: "Database binding is not configured; no orders are persisted yet.",
      });
    }

    const rows = await auth.env.DB.prepare(
      `SELECT id, number, customer_name, customer_email, customer_phone, status,
              total_kopecks, delivery_method, delivery_address, comment, created_at
       FROM orders
       WHERE onec_exported_at IS NULL
       ORDER BY created_at ASC
       LIMIT 100`,
    ).all();

    return NextResponse.json({
      ok: true,
      orders: rows.results,
      cursor: rows.results.length === 100 ? rows.results.at(-1)?.id : null,
    });
  }

  return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string[] }> },
) {
  const params = await context.params;
  const action = route(params);
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 5_000_000) {
    return NextResponse.json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const auth = await authorize(request);
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }

  if (action === "import/products") {
    const parsed = productImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: "VALIDATION_ERROR", issues: parsed.error.flatten() },
        { status: 422 },
      );
    }

    if (!auth.env.DB) {
      return NextResponse.json({
        ok: true,
        mode: "validation-only",
        syncId: parsed.data.syncId,
        accepted: parsed.data.products.length,
        persisted: 0,
        message: "Payload is valid. Add the DB binding to enable persistence.",
      }, { status: 202 });
    }

    const now = new Date().toISOString();
    const statements = parsed.data.products.map((product) =>
      auth.env.DB!.prepare(
        `INSERT INTO products (
          id, external_id, sku, kind, brand, model, subtitle, width, profile, diameter,
          season, studded, runflat, pcd, offset, center_bore, color, country, tags_json,
          is_active, is_featured, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(external_id) DO UPDATE SET
          sku=excluded.sku, kind=excluded.kind, brand=excluded.brand, model=excluded.model,
          subtitle=excluded.subtitle, width=excluded.width, profile=excluded.profile,
          diameter=excluded.diameter, season=excluded.season, studded=excluded.studded,
          runflat=excluded.runflat, pcd=excluded.pcd, offset=excluded.offset,
          center_bore=excluded.center_bore, color=excluded.color, country=excluded.country,
          tags_json=excluded.tags_json, is_active=excluded.is_active,
          is_featured=excluded.is_featured, updated_at=excluded.updated_at`,
      ).bind(
        crypto.randomUUID(),
        product.externalId,
        product.sku,
        product.kind,
        product.brand,
        product.model,
        product.subtitle,
        product.width,
        product.profile,
        product.diameter,
        product.season,
        Number(product.studded),
        Number(product.runflat),
        product.pcd || null,
        product.offset ?? null,
        product.centerBore ?? null,
        product.color || null,
        product.country || null,
        JSON.stringify(product.tags),
        Number(product.isActive),
        Number(product.isFeatured),
        now,
        now,
      ),
    );
    await auth.env.DB.batch(statements);
    return NextResponse.json({
      ok: true,
      syncId: parsed.data.syncId,
      accepted: parsed.data.products.length,
      persisted: parsed.data.products.length,
    });
  }

  if (action === "import/stock-prices") {
    const parsed = stockPriceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: "VALIDATION_ERROR", issues: parsed.error.flatten() },
        { status: 422 },
      );
    }

    if (!auth.env.DB) {
      return NextResponse.json({
        ok: true,
        mode: "validation-only",
        syncId: parsed.data.syncId,
        accepted: parsed.data.rows.length,
        persisted: 0,
        message: "Payload is valid. Add the DB binding to enable persistence.",
      }, { status: 202 });
    }

    const now = new Date().toISOString();
    const statements = parsed.data.rows.flatMap((row) => [
      auth.env.DB!.prepare(
        `INSERT INTO inventories (id, product_id, warehouse_code, warehouse_name, quantity, reserved, updated_at)
         SELECT ?, id, ?, ?, ?, ?, ? FROM products WHERE external_id = ?
         ON CONFLICT(product_id, warehouse_code) DO UPDATE SET
           warehouse_name=excluded.warehouse_name, quantity=excluded.quantity,
           reserved=excluded.reserved, updated_at=excluded.updated_at`,
      ).bind(crypto.randomUUID(), row.warehouseCode, row.warehouseName, row.quantity, row.reserved, now, row.externalId),
      auth.env.DB!.prepare(
        `INSERT INTO prices (id, product_id, price_type, amount_kopecks, old_amount_kopecks, currency, updated_at)
         SELECT ?, id, 'retail', ?, ?, ?, ? FROM products WHERE external_id = ?
         ON CONFLICT(product_id, price_type) DO UPDATE SET
           amount_kopecks=excluded.amount_kopecks, old_amount_kopecks=excluded.old_amount_kopecks,
           currency=excluded.currency, updated_at=excluded.updated_at`,
      ).bind(crypto.randomUUID(), Math.round(row.price * 100), row.oldPrice ? Math.round(row.oldPrice * 100) : null, row.currency, now, row.externalId),
    ]);
    await auth.env.DB.batch(statements);
    return NextResponse.json({
      ok: true,
      syncId: parsed.data.syncId,
      accepted: parsed.data.rows.length,
      persisted: parsed.data.rows.length,
    });
  }

  return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
}

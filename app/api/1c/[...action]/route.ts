import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const MAXIMUM_REQUEST_SIZE_BYTES = 5_000_000;
const DATABASE_BATCH_SIZE = 100;

type RuntimeDatabase = NonNullable<CloudflareEnv["DB"]>;
type RuntimePreparedStatement = ReturnType<RuntimeDatabase["prepare"]>;

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

const stockAndPriceImportSchema = z.object({
  version: z.literal("1.0"),
  syncId: z.string().min(1),
  rows: z
    .array(
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
    )
    .max(5000),
});

const fitmentRowSchema = z
  .object({
    externalId: z.string().min(1),
    make: z.string().min(1).max(100),
    model: z.string().min(1).max(150),
    generation: z.string().max(100).optional(),
    yearFrom: z.number().int().min(1950).max(2100).optional(),
    yearTo: z.number().int().min(1950).max(2100).optional(),
    isOem: z.boolean().default(false),
  })
  .refine(
    (fitment) =>
      fitment.yearFrom === undefined ||
      fitment.yearTo === undefined ||
      fitment.yearFrom <= fitment.yearTo,
    {
      message: "yearFrom must not be greater than yearTo",
      path: ["yearTo"],
    },
  );

const fitmentImportSchema = z.object({
  version: z.literal("1.0"),
  syncId: z.string().min(1),
  rows: z.array(fitmentRowSchema).max(5000),
});

const orderAcknowledgementSchema = z.object({
  version: z.literal("1.0"),
  syncId: z.string().min(1),
  orderIds: z.array(z.string().min(1)).min(1).max(100),
});

interface AuthorizedOneCRequest {
  errorResponse: NextResponse | null;
  runtimeEnvironment: CloudflareEnv;
}

interface ExportedOrderDatabaseRow {
  id: string;
  number: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string;
  status: string;
  total_kopecks: number;
  delivery_method: string;
  delivery_address: string | null;
  comment: string | null;
  created_at: string;
  item_id: string | null;
  sku_snapshot: string | null;
  title_snapshot: string | null;
  quantity: number | null;
  price_kopecks: number | null;
}

interface ExportedOrder {
  id: string;
  number: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  status: string;
  totalKopecks: number;
  deliveryMethod: string;
  deliveryAddress: string | null;
  comment: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    sku: string;
    title: string;
    quantity: number;
    priceKopecks: number;
  }>;
}

/**
 * Reads Cloudflare bindings in production and process variables during local
 * development. Keeping this logic in one place makes configuration failures
 * visible and predictable.
 */
async function getRuntimeEnvironment(): Promise<CloudflareEnv> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env as CloudflareEnv;
  } catch {
    return {
      ONEC_SHARED_SECRET: process.env.ONEC_SHARED_SECRET,
    } as CloudflareEnv;
  }
}

/**
 * Compares secrets without returning early on the first different character.
 * It is a lightweight protection for a shared integration token.
 */
function constantTimeEquals(firstValue: string, secondValue: string): boolean {
  const comparisonLength = Math.max(firstValue.length, secondValue.length);
  let difference = firstValue.length ^ secondValue.length;

  for (let index = 0; index < comparisonLength; index += 1) {
    difference |=
      (firstValue.charCodeAt(index) || 0) ^
      (secondValue.charCodeAt(index) || 0);
  }

  return difference === 0;
}

/**
 * Validates the X-1C-Token header and returns the runtime bindings required by
 * the endpoint. The health method deliberately does not require a token.
 */
async function authorizeOneCRequest(
  request: NextRequest,
): Promise<AuthorizedOneCRequest> {
  const runtimeEnvironment = await getRuntimeEnvironment();
  const configuredSecret =
    runtimeEnvironment.ONEC_SHARED_SECRET ||
    process.env.ONEC_SHARED_SECRET ||
    "";

  if (!configuredSecret) {
    return {
      errorResponse: NextResponse.json(
        {
          ok: false,
          code: "INTEGRATION_NOT_CONFIGURED",
          message: "ONEC_SHARED_SECRET is not configured",
        },
        { status: 503 },
      ),
      runtimeEnvironment,
    };
  }

  const providedSecret = request.headers.get("x-1c-token") || "";
  if (
    !providedSecret ||
    !constantTimeEquals(configuredSecret, providedSecret)
  ) {
    return {
      errorResponse: NextResponse.json(
        {
          ok: false,
          code: "UNAUTHORIZED",
          message: "Invalid X-1C-Token",
        },
        { status: 401 },
      ),
      runtimeEnvironment,
    };
  }

  return { errorResponse: null, runtimeEnvironment };
}

function getRequestedOneCAction(params: { action: string[] }): string {
  return params.action.join("/");
}

/**
 * D1 limits the practical size of a batch. Chunking makes large stock imports
 * predictable instead of attempting thousands of statements at once.
 */
async function executeStatementsInChunks(
  database: RuntimeDatabase,
  statements: RuntimePreparedStatement[],
): Promise<void> {
  for (
    let startIndex = 0;
    startIndex < statements.length;
    startIndex += DATABASE_BATCH_SIZE
  ) {
    const statementChunk = statements.slice(
      startIndex,
      startIndex + DATABASE_BATCH_SIZE,
    );
    await database.batch(statementChunk);
  }
}

async function synchronizationWasCompleted(
  database: RuntimeDatabase,
  synchronizationId: string,
): Promise<boolean> {
  const existingRun = await database
    .prepare(
      "SELECT id FROM sync_runs WHERE id = ? AND status = 'success' LIMIT 1",
    )
    .bind(synchronizationId)
    .first();

  return Boolean(existingRun);
}

async function recordSuccessfulSynchronization(
  database: RuntimeDatabase,
  options: {
    synchronizationId: string;
    direction: "import" | "export";
    entity: string;
    processedRecords: number;
    startedAt: string;
  },
): Promise<void> {
  const finishedAt = new Date().toISOString();

  await database
    .prepare(
      `INSERT INTO sync_runs (
        id, direction, entity, status, records_total, records_processed,
        started_at, finished_at
      ) VALUES (?, ?, ?, 'success', ?, ?, ?, ?)`,
    )
    .bind(
      options.synchronizationId,
      options.direction,
      options.entity,
      options.processedRecords,
      options.processedRecords,
      options.startedAt,
      finishedAt,
    )
    .run();
}

function groupOrderRows(
  databaseRows: ExportedOrderDatabaseRow[],
): ExportedOrder[] {
  const ordersById = new Map<string, ExportedOrder>();

  for (const databaseRow of databaseRows) {
    let order = ordersById.get(databaseRow.id);

    if (!order) {
      order = {
        id: databaseRow.id,
        number: databaseRow.number,
        customerName: databaseRow.customer_name,
        customerEmail: databaseRow.customer_email,
        customerPhone: databaseRow.customer_phone,
        status: databaseRow.status,
        totalKopecks: databaseRow.total_kopecks,
        deliveryMethod: databaseRow.delivery_method,
        deliveryAddress: databaseRow.delivery_address,
        comment: databaseRow.comment,
        createdAt: databaseRow.created_at,
        items: [],
      };
      ordersById.set(databaseRow.id, order);
    }

    if (
      databaseRow.item_id &&
      databaseRow.sku_snapshot &&
      databaseRow.title_snapshot &&
      databaseRow.quantity !== null &&
      databaseRow.price_kopecks !== null
    ) {
      order.items.push({
        id: databaseRow.item_id,
        sku: databaseRow.sku_snapshot,
        title: databaseRow.title_snapshot,
        quantity: databaseRow.quantity,
        priceKopecks: databaseRow.price_kopecks,
      });
    }
  }

  return Array.from(ordersById.values());
}

/**
 * Health and order export endpoints consumed by a scheduled job in 1C.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ action: string[] }> },
) {
  const requestedAction = getRequestedOneCAction(await context.params);

  if (requestedAction === "health") {
    const runtimeEnvironment = await getRuntimeEnvironment();
    return NextResponse.json({
      ok: true,
      service: "apex-1c-gateway",
      apiVersion: "1.0",
      secretConfigured: Boolean(
        runtimeEnvironment.ONEC_SHARED_SECRET ||
          process.env.ONEC_SHARED_SECRET,
      ),
      databaseConfigured: Boolean(runtimeEnvironment.DB),
      mode:
        runtimeEnvironment.ONEC_SHARED_SECRET && runtimeEnvironment.DB
          ? "active"
          : "validation-only",
      timestamp: new Date().toISOString(),
    });
  }

  const authorization = await authorizeOneCRequest(request);
  if (authorization.errorResponse) return authorization.errorResponse;

  if (requestedAction !== "orders/export") {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const database = authorization.runtimeEnvironment.DB;
  if (!database) {
    return NextResponse.json({
      ok: true,
      mode: "validation-only",
      orders: [],
      hasMore: false,
      message:
        "Database binding is not configured; no orders are persisted yet.",
    });
  }

  const queryResult = await database
    .prepare(
      `WITH selected_orders AS (
        SELECT id
        FROM orders
        WHERE onec_exported_at IS NULL
        ORDER BY created_at ASC
        LIMIT 100
      )
      SELECT
        orders.id, orders.number, orders.customer_name,
        orders.customer_email, orders.customer_phone, orders.status,
        orders.total_kopecks, orders.delivery_method,
        orders.delivery_address, orders.comment, orders.created_at,
        order_items.id AS item_id, order_items.sku_snapshot,
        order_items.title_snapshot, order_items.quantity,
        order_items.price_kopecks
      FROM orders
      INNER JOIN selected_orders ON selected_orders.id = orders.id
      LEFT JOIN order_items ON order_items.order_id = orders.id
      ORDER BY orders.created_at ASC, order_items.id ASC`,
    )
    .all<ExportedOrderDatabaseRow>();

  const orders = groupOrderRows(queryResult.results);

  return NextResponse.json({
    ok: true,
    orders,
    hasMore: orders.length === 100,
  });
}

/**
 * Product, stock, price, vehicle fitment and order acknowledgement endpoints
 * used by 1C.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string[] }> },
) {
  const requestedAction = getRequestedOneCAction(await context.params);
  const contentLength = Number(request.headers.get("content-length") || "0");

  if (contentLength > MAXIMUM_REQUEST_SIZE_BYTES) {
    return NextResponse.json(
      { ok: false, code: "PAYLOAD_TOO_LARGE" },
      { status: 413 },
    );
  }

  const authorization = await authorizeOneCRequest(request);
  if (authorization.errorResponse) return authorization.errorResponse;

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  if (requestedAction === "import/products") {
    const validationResult = productImportSchema.safeParse(requestBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION_ERROR",
          issues: validationResult.error.flatten(),
        },
        { status: 422 },
      );
    }

    const { products, syncId } = validationResult.data;
    const database = authorization.runtimeEnvironment.DB;
    if (!database) {
      return NextResponse.json(
        {
          ok: true,
          mode: "validation-only",
          syncId,
          accepted: products.length,
          persisted: 0,
          message:
            "Payload is valid. Add the DB binding to enable persistence.",
        },
        { status: 202 },
      );
    }

    if (await synchronizationWasCompleted(database, syncId)) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        syncId,
        accepted: products.length,
        persisted: 0,
      });
    }

    const synchronizationStartedAt = new Date().toISOString();
    const productStatements = products.map((product) =>
      database
        .prepare(
          `INSERT INTO products (
            id, external_id, sku, kind, brand, model, subtitle, width, profile,
            diameter, season, studded, runflat, pcd, offset, center_bore, color,
            country, tags_json, is_active, is_featured, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(external_id) DO UPDATE SET
            sku=excluded.sku, kind=excluded.kind, brand=excluded.brand,
            model=excluded.model, subtitle=excluded.subtitle,
            width=excluded.width, profile=excluded.profile,
            diameter=excluded.diameter, season=excluded.season,
            studded=excluded.studded, runflat=excluded.runflat,
            pcd=excluded.pcd, offset=excluded.offset,
            center_bore=excluded.center_bore, color=excluded.color,
            country=excluded.country, tags_json=excluded.tags_json,
            is_active=excluded.is_active, is_featured=excluded.is_featured,
            updated_at=excluded.updated_at`,
        )
        .bind(
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
          synchronizationStartedAt,
          synchronizationStartedAt,
        ),
    );

    await executeStatementsInChunks(database, productStatements);
    await recordSuccessfulSynchronization(database, {
      synchronizationId: syncId,
      direction: "import",
      entity: "products",
      processedRecords: products.length,
      startedAt: synchronizationStartedAt,
    });

    return NextResponse.json({
      ok: true,
      syncId,
      accepted: products.length,
      persisted: products.length,
    });
  }

  if (requestedAction === "import/stock-prices") {
    const validationResult =
      stockAndPriceImportSchema.safeParse(requestBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION_ERROR",
          issues: validationResult.error.flatten(),
        },
        { status: 422 },
      );
    }

    const { rows, syncId } = validationResult.data;
    const database = authorization.runtimeEnvironment.DB;
    if (!database) {
      return NextResponse.json(
        {
          ok: true,
          mode: "validation-only",
          syncId,
          accepted: rows.length,
          persisted: 0,
          message:
            "Payload is valid. Add the DB binding to enable persistence.",
        },
        { status: 202 },
      );
    }

    if (await synchronizationWasCompleted(database, syncId)) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        syncId,
        accepted: rows.length,
        persisted: 0,
      });
    }

    const synchronizationStartedAt = new Date().toISOString();
    const stockAndPriceStatements = rows.flatMap((row) => [
      database
        .prepare(
          `INSERT INTO inventories (
            id, product_id, warehouse_code, warehouse_name, quantity, reserved,
            updated_at
          )
          SELECT ?, id, ?, ?, ?, ?, ? FROM products WHERE external_id = ?
          ON CONFLICT(product_id, warehouse_code) DO UPDATE SET
            warehouse_name=excluded.warehouse_name,
            quantity=excluded.quantity, reserved=excluded.reserved,
            updated_at=excluded.updated_at`,
        )
        .bind(
          crypto.randomUUID(),
          row.warehouseCode,
          row.warehouseName,
          row.quantity,
          row.reserved,
          synchronizationStartedAt,
          row.externalId,
        ),
      database
        .prepare(
          `INSERT INTO prices (
            id, product_id, price_type, amount_kopecks,
            old_amount_kopecks, currency, updated_at
          )
          SELECT ?, id, 'retail', ?, ?, ?, ? FROM products WHERE external_id = ?
          ON CONFLICT(product_id, price_type) DO UPDATE SET
            amount_kopecks=excluded.amount_kopecks,
            old_amount_kopecks=excluded.old_amount_kopecks,
            currency=excluded.currency, updated_at=excluded.updated_at`,
        )
        .bind(
          crypto.randomUUID(),
          Math.round(row.price * 100),
          row.oldPrice ? Math.round(row.oldPrice * 100) : null,
          row.currency,
          synchronizationStartedAt,
          row.externalId,
        ),
    ]);

    await executeStatementsInChunks(database, stockAndPriceStatements);
    await recordSuccessfulSynchronization(database, {
      synchronizationId: syncId,
      direction: "import",
      entity: "stock-prices",
      processedRecords: rows.length,
      startedAt: synchronizationStartedAt,
    });

    return NextResponse.json({
      ok: true,
      syncId,
      accepted: rows.length,
      persisted: rows.length,
    });
  }

  if (requestedAction === "import/fitments") {
    const validationResult = fitmentImportSchema.safeParse(requestBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION_ERROR",
          issues: validationResult.error.flatten(),
        },
        { status: 422 },
      );
    }

    const { rows, syncId } = validationResult.data;
    const database = authorization.runtimeEnvironment.DB;
    if (!database) {
      return NextResponse.json(
        {
          ok: true,
          mode: "validation-only",
          syncId,
          accepted: rows.length,
          persisted: 0,
          message:
            "Payload is valid. Add the DB binding to enable persistence.",
        },
        { status: 202 },
      );
    }

    if (await synchronizationWasCompleted(database, syncId)) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        syncId,
        accepted: rows.length,
        persisted: 0,
      });
    }

    const synchronizationStartedAt = new Date().toISOString();
    const affectedExternalIds = Array.from(
      new Set(rows.map((fitment) => fitment.externalId)),
    );
    const deletePreviousFitments = affectedExternalIds.map((externalId) =>
      database
        .prepare(
          `DELETE FROM fitments
           WHERE product_id IN (
             SELECT id FROM products WHERE external_id = ?
           )`,
        )
        .bind(externalId),
    );
    const insertCurrentFitments = rows.map((fitment) =>
      database
        .prepare(
          `INSERT INTO fitments (
            id, product_id, make, model, generation, year_from, year_to, is_oem
          )
          SELECT ?, id, ?, ?, ?, ?, ?, ?
          FROM products
          WHERE external_id = ?`,
        )
        .bind(
          crypto.randomUUID(),
          fitment.make,
          fitment.model,
          fitment.generation || null,
          fitment.yearFrom ?? null,
          fitment.yearTo ?? null,
          Number(fitment.isOem),
          fitment.externalId,
        ),
    );

    await executeStatementsInChunks(database, deletePreviousFitments);
    await executeStatementsInChunks(database, insertCurrentFitments);
    await recordSuccessfulSynchronization(database, {
      synchronizationId: syncId,
      direction: "import",
      entity: "fitments",
      processedRecords: rows.length,
      startedAt: synchronizationStartedAt,
    });

    return NextResponse.json({
      ok: true,
      syncId,
      accepted: rows.length,
      persisted: rows.length,
    });
  }

  if (requestedAction === "orders/acknowledge") {
    const validationResult =
      orderAcknowledgementSchema.safeParse(requestBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION_ERROR",
          issues: validationResult.error.flatten(),
        },
        { status: 422 },
      );
    }

    const { orderIds, syncId } = validationResult.data;
    const database = authorization.runtimeEnvironment.DB;
    if (!database) {
      return NextResponse.json(
        {
          ok: true,
          mode: "validation-only",
          syncId,
          accepted: orderIds.length,
          acknowledged: 0,
          message:
            "Payload is valid. Add the DB binding to enable persistence.",
        },
        { status: 202 },
      );
    }

    if (await synchronizationWasCompleted(database, syncId)) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        syncId,
        accepted: orderIds.length,
        acknowledged: 0,
      });
    }

    const synchronizationStartedAt = new Date().toISOString();
    const acknowledgementStatements = orderIds.map((orderId) =>
      database
        .prepare(
          `UPDATE orders
           SET onec_exported_at = ?, updated_at = ?
           WHERE id = ? AND onec_exported_at IS NULL`,
        )
        .bind(
          synchronizationStartedAt,
          synchronizationStartedAt,
          orderId,
        ),
    );

    await executeStatementsInChunks(database, acknowledgementStatements);
    await recordSuccessfulSynchronization(database, {
      synchronizationId: syncId,
      direction: "export",
      entity: "orders",
      processedRecords: orderIds.length,
      startedAt: synchronizationStartedAt,
    });

    return NextResponse.json({
      ok: true,
      syncId,
      accepted: orderIds.length,
      acknowledged: orderIds.length,
    });
  }

  return NextResponse.json(
    { ok: false, code: "NOT_FOUND" },
    { status: 404 },
  );
}

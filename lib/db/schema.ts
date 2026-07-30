import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash"),
    role: text("role", { enum: ["customer", "manager", "admin"] }).notNull().default("customer"),
    status: text("status", { enum: ["active", "blocked"] }).notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_uq").on(table.email)],
);

export const otpChallenges = sqliteTable(
  "otp_challenges",
  {
    id: text("id").primaryKey(),
    emailHash: text("email_hash").notNull(),
    requesterHash: text("requester_hash").notNull(),
    intent: text("intent", { enum: ["login", "register"] }).notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("otp_challenges_email_idx").on(table.emailHash, table.createdAt),
    index("otp_challenges_requester_idx").on(
      table.requesterHash,
      table.createdAt,
    ),
    index("otp_challenges_expiry_idx").on(table.expiresAt),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("sessions_token_uq").on(table.tokenHash), index("sessions_user_idx").on(table.userId)],
);

export const consents = sqliteTable(
  "consents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    purpose: text("purpose", {
      enum: ["registration", "checkout", "callback", "analytics"],
    }).notNull(),
    documentSlug: text("document_slug").notNull(),
    documentVersion: text("document_version").notNull(),
    grantedAt: text("granted_at").notNull(),
    revokedAt: text("revoked_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    source: text("source").notNull(),
  },
  (table) => [
    index("consents_user_idx").on(table.userId, table.grantedAt),
    index("consents_purpose_idx").on(table.purpose, table.grantedAt),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    externalId: text("external_id"),
    sku: text("sku").notNull(),
    kind: text("kind", { enum: ["tire", "wheel"] }).notNull(),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    width: integer("width").notNull().default(0),
    profile: integer("profile").notNull().default(0),
    diameter: integer("diameter").notNull(),
    season: text("season", { enum: ["summer", "winter", "all-season", "none"] }).notNull().default("none"),
    studded: integer("studded", { mode: "boolean" }).notNull().default(false),
    runflat: integer("runflat", { mode: "boolean" }).notNull().default(false),
    pcd: text("pcd"),
    offset: integer("offset"),
    centerBore: real("center_bore"),
    color: text("color"),
    country: text("country"),
    rating: real("rating").notNull().default(0),
    reviews: integer("reviews").notNull().default(0),
    tagsJson: text("tags_json").notNull().default("[]"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isFeatured: integer("is_featured", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("products_sku_uq").on(table.sku),
    uniqueIndex("products_external_uq").on(table.externalId),
    index("products_size_idx").on(table.kind, table.width, table.profile, table.diameter),
    index("products_brand_idx").on(table.brand),
  ],
);

export const productImages = sqliteTable(
  "product_images",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("product_images_product_idx").on(table.productId)],
);

export const inventories = sqliteTable(
  "inventories",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    warehouseCode: text("warehouse_code").notNull(),
    warehouseName: text("warehouse_name").notNull(),
    quantity: integer("quantity").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("inventories_product_warehouse_uq").on(table.productId, table.warehouseCode)],
);

export const prices = sqliteTable(
  "prices",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    priceType: text("price_type").notNull().default("retail"),
    amountKopecks: integer("amount_kopecks").notNull(),
    oldAmountKopecks: integer("old_amount_kopecks"),
    currency: text("currency").notNull().default("RUB"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("prices_product_type_uq").on(table.productId, table.priceType)],
);

export const fitments = sqliteTable(
  "fitments",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    make: text("make").notNull(),
    model: text("model").notNull(),
    generation: text("generation"),
    yearFrom: integer("year_from"),
    yearTo: integer("year_to"),
    isOem: integer("is_oem", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [index("fitments_vehicle_idx").on(table.make, table.model, table.yearFrom, table.yearTo)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    userId: text("user_id").references(() => users.id),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone").notNull(),
    status: text("status").notNull().default("new"),
    totalKopecks: integer("total_kopecks").notNull(),
    deliveryMethod: text("delivery_method").notNull().default("courier"),
    deliveryAddress: text("delivery_address"),
    comment: text("comment"),
    onecExportedAt: text("onec_exported_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("orders_number_uq").on(table.number), index("orders_status_idx").on(table.status)],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull().references(() => products.id),
    skuSnapshot: text("sku_snapshot").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    priceKopecks: integer("price_kopecks").notNull(),
  },
  (table) => [index("order_items_order_idx").on(table.orderId)],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    direction: text("direction", { enum: ["import", "export"] }).notNull(),
    entity: text("entity").notNull(),
    status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
    recordsTotal: integer("records_total").notNull().default(0),
    recordsProcessed: integer("records_processed").notNull().default(0),
    errorMessage: text("error_message"),
    cursor: text("cursor"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => [index("sync_runs_entity_idx").on(table.entity, table.startedAt)],
);

export const adminAuditLog = sqliteTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("admin_audit_actor_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
    index("admin_audit_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);

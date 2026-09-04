import assert from "node:assert/strict";
import test from "node:test";
import { secretsAreEqual } from "../utils/authentication.js";
import {
  batchEnvelopeSchema,
  priceSchema,
  productSchema,
  stockSchema,
} from "../validators/one-c-schemas.js";

test("integration secrets use an exact comparison", () => {
  assert.equal(secretsAreEqual("secret-value", "secret-value"), true);
  assert.equal(secretsAreEqual("secret-value", "secret-valuE"), false);
  assert.equal(secretsAreEqual("secret-value", ""), false);
});

test("product batch accepts stable external identifiers", () => {
  const envelope = batchEnvelopeSchema.parse({
    apiVersion: "1.0",
    idempotencyKey: "products-2026-09-04T10:00:00Z",
    mode: "incremental",
    items: [
      {
        externalId: "b9602d2f-13a6-4edc-a9a4-c923cc184c75",
        sku: "TYRE-001",
        name: "Шина Ikon Autograph Aqua 3",
        brand: "Ikon",
        model: "Autograph Aqua 3",
        kind: "tire",
        width: 205,
        profile: 55,
        diameter: 16,
      },
    ],
  });

  assert.equal(envelope.items.length, 1);
  assert.equal(productSchema.parse(envelope.items[0]).season, "none");
});

test("prices and stocks reject negative values", () => {
  assert.equal(
    priceSchema.safeParse({ externalId: "p-1", price: -1 }).success,
    false,
  );
  assert.equal(
    stockSchema.safeParse({
      externalId: "p-1",
      warehouseExternalId: "w-1",
      warehouseCode: "MAIN",
      warehouseName: "Основной",
      quantity: 2,
      reserved: 3,
    }).success,
    false,
  );
});

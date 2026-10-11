import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { businessConfig } from "../../config/business.js";
import { VehicleReferenceService } from "../services/vehicle-reference-service.js";
import { parseOptionalVehicleYear } from "../validators/vehicle-query.js";

const STORE = "https://store.example";
const environment = process.env as Record<string, string | undefined>;
const catalogConfig = businessConfig.catalog as { dataMode: "database" | "preview" };

test("year parameter: absent, empty or blank means 'not specified'", () => {
  for (const value of [null, "", " ", "  \t"]) {
    assert.deepEqual(parseOptionalVehicleYear(value, 1950, 2027), { valid: true, year: undefined });
  }
  assert.deepEqual(parseOptionalVehicleYear("2020", 1950, 2027), { valid: true, year: 2020 });
  assert.deepEqual(parseOptionalVehicleYear(" 2020 ", 1950, 2027), { valid: true, year: 2020 });
  for (const value of ["abc", "20x0", "2020.5", "-2020", "1949", "2028", "20200", "0x7E4"]) {
    assert.deepEqual(parseOptionalVehicleYear(value, 1950, 2027), { valid: false }, value);
  }
});

interface RecordedQuery { text: string; values?: unknown[] }

/** Database catalog mode with a fake pool that records queries. */
async function withDatabaseCatalog(
  rowsFor: (text: string) => unknown[],
  run: (queries: RecordedQuery[]) => Promise<void>,
) {
  const queries: RecordedQuery[] = [];
  const previous = {
    DATABASE_URL: environment.DATABASE_URL,
    DATABASE_SSL_MODE: environment.DATABASE_SSL_MODE,
    dataMode: catalogConfig.dataMode,
    pool: globalThis.apexPostgresPool,
  };
  environment.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
  environment.DATABASE_SSL_MODE = "disable";
  catalogConfig.dataMode = "database";
  globalThis.apexPostgresPool = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      const rows = rowsFor(text);
      return { rows, rowCount: rows.length };
    },
  } as unknown as Pool;
  try {
    await run(queries);
  } finally {
    catalogConfig.dataMode = previous.dataMode;
    globalThis.apexPostgresPool = previous.pool;
    for (const key of ["DATABASE_URL", "DATABASE_SSL_MODE"] as const) {
      if (previous[key] === undefined) delete environment[key];
      else environment[key] = previous[key];
    }
  }
}

async function getJson(handler: (request: NextRequest) => Promise<Response>, path: string) {
  const response = await handler(new NextRequest(`${STORE}${path}`));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("database: models with «Не уточнять год» (empty or absent year) are listed for all years", async () => {
  await withDatabaseCatalog(
    (text) => (text.trimStart().startsWith("SELECT DISTINCT car_models.name") ? [{ value: "Camry" }, { value: "Corolla" }] : []),
    async (queries) => {
      const { GET } = await import("../../app/api/vehicles/models/route.js");
      for (const path of ["/api/vehicles/models?make=Toyota&year=", "/api/vehicles/models?make=Toyota"]) {
        const { status, body } = await getJson(GET, path);
        assert.equal(status, 200, path);
        assert.deepEqual(Object.keys(body), ["ok", "source", "make", "year", "items"]);
        assert.deepEqual([body.source, body.year], ["postgresql", null]);
        assert.deepEqual((body.items as Array<{ name: string }>).map((item) => item.name), ["Camry", "Corolla"]);
        // No year filter in the query.
        assert.deepEqual(queries.at(-1)?.values, ["Toyota", null]);
      }
      const withYear = await getJson(GET, "/api/vehicles/models?make=Toyota&year=2020");
      assert.deepEqual([withYear.status, withYear.body.year], [200, 2020]);
      assert.deepEqual(queries.at(-1)?.values, ["Toyota", 2020]);
      for (const year of ["abc", "1949", "3000", "2020.5"]) {
        const invalid = await getJson(GET, `/api/vehicles/models?make=Toyota&year=${year}`);
        assert.deepEqual([invalid.status, invalid.body.code], [422, "INVALID_YEAR"], year);
      }
    },
  );
});

test("database: generations and fitment products accept an empty year", async () => {
  await withDatabaseCatalog(
    (text) => (text.trimStart().startsWith("SELECT DISTINCT car_generations.name") ? [{ value: "E210" }] : []),
    async (queries) => {
      const generations = await import("../../app/api/vehicles/generations/route.js");
      for (const year of ["", "%20"]) {
        const { status, body } = await getJson(
          generations.GET,
          `/api/vehicles/generations?make=Toyota&model=Corolla&year=${year}`,
        );
        assert.equal(status, 200, `year=${year}`);
        assert.deepEqual(body.items, [{ id: "e210", name: "E210" }]);
        assert.deepEqual(queries.at(-1)?.values, ["Toyota", "Corolla", null]);
      }
      const invalid = await getJson(generations.GET, "/api/vehicles/generations?make=Toyota&model=Corolla&year=abc");
      assert.deepEqual([invalid.status, invalid.body.code], [422, "INVALID_VEHICLE"]);

      const fitments = await import("../../app/api/v1/fitments/products/route.js");
      const empty = await getJson(fitments.GET, "/api/v1/fitments/products?make=Toyota&model=Corolla&generation=E210&year=");
      assert.equal(empty.status, 200);
      const wrong = await getJson(fitments.GET, "/api/v1/fitments/products?make=Toyota&model=Corolla&generation=E210&year=abc");
      assert.deepEqual([wrong.status, wrong.body.code], [422, "INVALID_VEHICLE"]);
    },
  );
});

test("preview: models without a year use the 'all models of the make' list", async () => {
  const calls: string[] = [];
  globalThis.apexVehicleReferenceService = new VehicleReferenceService({
    fetch: (async (input: string | URL | Request) => {
      calls.push(String(input));
      return Response.json({ Results: [{ Make_ID: 1, Make_Name: "TOYOTA", Model_ID: 1, Model_Name: "Sequoia" }] });
    }) as typeof fetch,
  });
  try {
    const { GET } = await import("../../app/api/vehicles/models/route.js");
    for (const path of ["/api/vehicles/models?make=Toyota&year=", "/api/vehicles/models?make=Toyota"]) {
      const { status, body } = await getJson(GET, path);
      assert.deepEqual([status, body.year], [200, null], path);
      assert.ok((body.items as Array<{ name: string }>).some((item) => item.name === "Sequoia"));
    }
    // One cached vPIC call for both requests, without a model year.
    assert.equal(calls.length, 1);
    assert.match(calls[0], /GetModelsForMake\/TOYOTA\?format=json$/);
    const invalid = await getJson(GET, "/api/vehicles/models?make=Toyota&year=abc");
    assert.deepEqual([invalid.status, invalid.body.code], [422, "INVALID_YEAR"]);
  } finally {
    globalThis.apexVehicleReferenceService = undefined;
  }
});

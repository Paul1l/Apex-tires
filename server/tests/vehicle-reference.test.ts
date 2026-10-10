import assert from "node:assert/strict";
import test from "node:test";
import { seedProducts } from "../../lib/catalog-data.js";
import {
  getSupplementalModelsForMake,
  getSupplementalVehicleMakes,
} from "../../lib/vehicle-catalog.js";
import {
  BoundedTtlCache,
  VEHICLE_CACHE_CONTROL,
  VEHICLE_FALLBACK_TTL_MILLISECONDS,
  VEHICLE_MAKES_TTL_MILLISECONDS,
  VEHICLE_MODELS_TTL_MILLISECONDS,
  VehicleReferenceService,
  vehicleReferenceCacheControl,
} from "../services/vehicle-reference-service.js";

type FetchMode = "ok" | "fail" | "hang";

function fakeVpic() {
  const calls: string[] = [];
  let mode: FetchMode = "ok";
  const fetchImplementation = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (mode === "fail") return new Response("unavailable", { status: 503 });
    if (mode === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    if (url.includes("GetMakesForVehicleType")) {
      return Response.json({ Results: [{ MakeId: 448, MakeName: "TOYOTA" }, { MakeId: 1, MakeName: "TESTMAKE" }] });
    }
    return Response.json({
      Results: [
        { Make_ID: 448, Make_Name: "TOYOTA", Model_ID: 2469, Model_Name: "Camry" },
        { Make_ID: 448, Make_Name: "TOYOTA", Model_ID: 9999, Model_Name: "Sequoia" },
        { Make_ID: 1, Make_Name: "OTHER", Model_ID: 1, Model_Name: "Ignored" },
      ],
    });
  }) as typeof fetch;
  return {
    calls,
    fetch: fetchImplementation,
    setMode(next: FetchMode) {
      mode = next;
    },
  };
}

function service(vpic: ReturnType<typeof fakeVpic>, clock: { now: number }, options: { maximumModelEntries?: number; timeoutMilliseconds?: number } = {}) {
  return new VehicleReferenceService({
    fetch: vpic.fetch,
    now: () => clock.now,
    timeoutMilliseconds: options.timeoutMilliseconds ?? 200,
    maximumModelEntries: options.maximumModelEntries,
  });
}

test("makes are loaded from vPIC once and then served from memory for 24 hours", async () => {
  const vpic = fakeVpic();
  const clock = { now: 0 };
  const reference = service(vpic, clock);

  const first = await reference.getMakes();
  assert.equal(first.cache, "miss");
  assert.equal(first.source, "vpic+regional");
  assert.equal(vpic.calls.length, 3);
  assert.ok(first.items.some((make) => make.name === "Testmake"));
  assert.ok(first.items.some((make) => make.name === "LADA"));

  clock.now += VEHICLE_MAKES_TTL_MILLISECONDS - 1;
  const second = await reference.getMakes();
  assert.equal(second.cache, "hit");
  assert.deepEqual(second.items, first.items);
  assert.equal(vpic.calls.length, 3);

  clock.now += 1;
  assert.equal((await reference.getMakes()).cache, "miss");
  assert.equal(vpic.calls.length, 6);
});

test("vPIC failure: regional list quickly, reused for a short time, then vPIC is asked again", async () => {
  const vpic = fakeVpic();
  vpic.setMode("fail");
  const clock = { now: 0 };
  const reference = service(vpic, clock);

  const fallback = await reference.getMakes();
  assert.deepEqual([fallback.source, fallback.cache], ["regional-fallback", "stale"]);
  assert.ok(fallback.items.some((make) => make.name === "Toyota"));
  const callsAfterFailure = vpic.calls.length;

  clock.now += VEHICLE_FALLBACK_TTL_MILLISECONDS - 1;
  const reused = await reference.getMakes();
  assert.deepEqual([reused.source, reused.cache], ["regional-fallback", "stale"]);
  assert.equal(vpic.calls.length, callsAfterFailure);

  vpic.setMode("ok");
  clock.now += 1;
  const recovered = await reference.getMakes();
  assert.deepEqual([recovered.source, recovered.cache], ["vpic+regional", "miss"]);
});

test("an expired vPIC copy is preferred to the regional list when vPIC fails", async () => {
  const vpic = fakeVpic();
  const clock = { now: 0 };
  const reference = service(vpic, clock);
  const loaded = await reference.getModels("Toyota", 2020);
  clock.now += VEHICLE_MODELS_TTL_MILLISECONDS;
  vpic.setMode("fail");
  const stale = await reference.getModels("Toyota", 2020);
  assert.deepEqual([stale.source, stale.cache], [loaded.source, "stale"]);
  assert.deepEqual(stale.items, loaded.items);
});

test("a slow vPIC answer is cut off by the timeout and the fallback is returned", async () => {
  const vpic = fakeVpic();
  vpic.setMode("hang");
  const reference = service(vpic, { now: 0 }, { timeoutMilliseconds: 30 });
  const startedAt = Date.now();
  const result = await reference.getModels("Toyota", 2020);
  assert.ok(Date.now() - startedAt < 2_000);
  assert.deepEqual([result.source, result.cache], ["regional-fallback", "stale"]);
  assert.ok(result.items.some((model) => model.name === "Camry"));
});

test("models: merged with the regional list, shared per make/year, concurrent requests share one call", async () => {
  const vpic = fakeVpic();
  const reference = service(vpic, { now: 0 });
  const [first, second] = await Promise.all([
    reference.getModels("Toyota", 2020),
    reference.getModels("toyota ", 2020),
  ]);
  assert.equal(vpic.calls.length, 1);
  assert.match(vpic.calls[0], /GetModelsForMakeYear\/make\/TOYOTA\/modelyear\/2020/);
  assert.deepEqual(first.items, second.items);
  assert.equal(first.source, "vpic+regional");
  const names = first.items.map((model) => model.name);
  assert.ok(names.includes("Sequoia"));
  assert.ok(names.includes("Land Cruiser Prado"));
  assert.equal(names.filter((name) => name === "Camry").length, 1);
  assert.equal(names.includes("Ignored"), false);
  assert.equal((await reference.getModels("TOYOTA", 2020)).cache, "hit");
  // Years before 1995 share one "all models of the make" entry.
  await reference.getModels("Toyota", 1980);
  await reference.getModels("Toyota", 1990);
  assert.equal(vpic.calls.length, 2);
  assert.match(vpic.calls[1], /GetModelsForMake\/TOYOTA\?/);
});

test("the models cache is bounded: least recently used entries are evicted", async () => {
  const vpic = fakeVpic();
  const reference = service(vpic, { now: 0 }, { maximumModelEntries: 2 });
  await reference.getModels("Toyota", 2020);
  await reference.getModels("Toyota", 2021);
  await reference.getModels("Toyota", 2020); // refreshes 2020
  await reference.getModels("Toyota", 2022); // evicts 2021
  assert.equal(vpic.calls.length, 3);
  assert.equal((await reference.getModels("Toyota", 2020)).cache, "hit");
  assert.equal((await reference.getModels("Toyota", 2021)).cache, "miss");

  const cache = new BoundedTtlCache<number>(3, () => 0);
  for (let index = 0; index < 10; index += 1) cache.set(String(index), index, 1_000);
  assert.equal(cache.size, 3);
});

test("cache headers: long for vPIC data, short for fallback answers", () => {
  assert.equal(vehicleReferenceCacheControl("makes", { cache: "hit" }), VEHICLE_CACHE_CONTROL.makes);
  assert.equal(vehicleReferenceCacheControl("models", { cache: "miss" }), VEHICLE_CACHE_CONTROL.models);
  assert.equal(vehicleReferenceCacheControl("makes", { cache: "stale" }), VEHICLE_CACHE_CONTROL.fallback);
  for (const value of [VEHICLE_CACHE_CONTROL.makes, VEHICLE_CACHE_CONTROL.models, VEHICLE_CACHE_CONTROL.fallback, VEHICLE_CACHE_CONTROL.database]) {
    assert.match(value, /^public, max-age=\d+, s-maxage=\d+, stale-while-revalidate=\d+$/);
  }
});

test("preview routes: same response shape, cache headers and cache status", async () => {
  const vpic = fakeVpic();
  globalThis.apexVehicleReferenceService = new VehicleReferenceService({ fetch: vpic.fetch });
  try {
    const makesRoute = await import("../../app/api/vehicles/makes/route.js");
    const first = await makesRoute.GET();
    const second = await makesRoute.GET();
    assert.equal(first.headers.get("x-vehicle-cache"), "miss");
    assert.equal(second.headers.get("x-vehicle-cache"), "hit");
    assert.equal(second.headers.get("cache-control"), VEHICLE_CACHE_CONTROL.makes);
    const body = (await second.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ["ok", "source", "items"]);
    assert.equal(body.source, "vpic+regional");

    const { NextRequest } = await import("next/server");
    const modelsRoute = await import("../../app/api/vehicles/models/route.js");
    const response = await modelsRoute.GET(
      new NextRequest("https://store.example/api/vehicles/models?make=Kia&year=2020"),
    );
    const models = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(models), ["ok", "source", "make", "year", "items"]);
    assert.deepEqual([models.make, models.year], ["Kia", 2020]);
    assert.equal(response.headers.get("cache-control"), VEHICLE_CACHE_CONTROL.models);
  } finally {
    globalThis.apexVehicleReferenceService = undefined;
  }
});

test("every make of the regional list has models, including the demo catalog cars", () => {
  const makes = getSupplementalVehicleMakes();
  for (const make of makes) {
    assert.ok(getSupplementalModelsForMake(make.name).length > 0, make.name);
  }
  // The preview catalog matches "<make> <model>" against compatibleCars.
  const choices = new Set(
    makes.flatMap((make) =>
      getSupplementalModelsForMake(make.name).map((model) => `${make.name} ${model.name}`.toLocaleLowerCase("ru")),
    ),
  );
  const demoCars = new Set(seedProducts.flatMap((product) => product.compatibleCars));
  assert.ok(demoCars.size > 0);
  for (const car of demoCars) assert.ok(choices.has(car.toLocaleLowerCase("ru")), car);
});

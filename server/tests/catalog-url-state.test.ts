import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalogHref,
  hasCatalogUrlState,
  parseCatalogUrlState,
  serializeCatalogUrlState,
  withoutOneTimeParameters,
} from "../../lib/catalog-url-state.js";
import type { CatalogFilters } from "../../lib/types.js";

function defaults(kind: CatalogFilters["kind"] = "all", inStock = false): CatalogFilters {
  return {
    kind,
    seasons: [],
    brands: [],
    width: "",
    profile: "",
    diameter: "",
    minPrice: 0,
    maxPrice: 60000,
    inStock,
    studded: false,
    runflat: false,
    carMake: "",
    carModel: "",
    carYear: "",
    carGeneration: "",
    query: "",
    sort: "popular",
  };
}

test("default catalog state has no query parameters", () => {
  assert.equal(serializeCatalogUrlState({ filters: defaults(), page: 1 }, defaults()).toString(), "");
  assert.equal(
    serializeCatalogUrlState({ filters: defaults("tire", true), page: 1 }, defaults("tire", true)).toString(),
    "",
  );
  assert.equal(hasCatalogUrlState("?utm_source=vk&cart=open"), false);
  assert.equal(hasCatalogUrlState("?brand=Michelin"), true);
});

test("every filter survives a round trip through the address", () => {
  const pageDefaults = defaults("tire", true);
  const filters: CatalogFilters = {
    ...pageDefaults,
    kind: "all",
    seasons: ["winter", "all-season"],
    brands: ["Michelin", "K&K"],
    width: "225",
    profile: "45",
    diameter: "17.5",
    maxPrice: 31000,
    inStock: false,
    studded: true,
    runflat: true,
    carMake: "Toyota",
    carModel: "Camry",
    carYear: "2021",
    carGeneration: "XV70",
    carModification: "2.5 AT",
    query: "pilot sport",
    sort: "price-desc",
  };
  const parameters = serializeCatalogUrlState({ filters, page: 3 }, pageDefaults);
  const restored = parseCatalogUrlState(parameters.toString(), pageDefaults);
  assert.deepEqual(restored, { filters, page: 3 });
  assert.equal(parameters.get("type"), "all");
  assert.equal(parameters.get("stock"), "0");
});

test("the page category is the default and is not repeated in the address", () => {
  const wheels = defaults("wheel");
  assert.equal(serializeCatalogUrlState({ filters: wheels, page: 1 }, wheels).has("type"), false);
  assert.equal(parseCatalogUrlState("", wheels).filters.kind, "wheel");
  assert.equal(parseCatalogUrlState("?type=tire", wheels).filters.kind, "tire");
});

test("invalid or out-of-range values fall back to the defaults", () => {
  const { filters, page } = parseCatalogUrlState(
    "?type=boats&season=summer,spring&width=N/A&profile=5&diameter=99&price=abc" +
      "&stock=yes&studded=true&sort=rating&page=-2&year=1800&make=Toyota",
    defaults(),
  );
  assert.equal(filters.kind, "all");
  assert.deepEqual(filters.seasons, ["summer"]);
  assert.equal(filters.width, "");
  assert.equal(filters.profile, "");
  assert.equal(filters.diameter, "");
  assert.equal(filters.maxPrice, 60000);
  assert.equal(filters.inStock, false);
  assert.equal(filters.studded, false);
  // "По рейтингу" exists only when ratings are enabled.
  assert.equal(filters.sort, "popular");
  assert.equal(parseCatalogUrlState("?sort=rating", defaults(), { ratingSortEnabled: true }).filters.sort, "rating");
  // A vehicle needs both make and model.
  assert.equal(filters.carMake, "");
  assert.equal(page, 1);
  assert.equal(parseCatalogUrlState("?page=99999", defaults()).page, 10000);
  assert.equal(parseCatalogUrlState(`?q=${"x".repeat(121)}`, defaults()).filters.query, "");
});

test("price is snapped to the slider and kept within its bounds", () => {
  assert.equal(parseCatalogUrlState("?price=12345", defaults()).filters.maxPrice, 12000);
  assert.equal(parseCatalogUrlState("?price=100", defaults()).filters.maxPrice, 10000);
  assert.equal(parseCatalogUrlState("?price=900000", defaults()).filters.maxPrice, 60000);
});

test("wheels drop tire-only filters from a hand-edited link", () => {
  const { filters } = parseCatalogUrlState(
    "?type=wheel&season=winter&width=225&profile=45&diameter=18&studded=1&runflat=1",
    defaults(),
  );
  assert.deepEqual(
    { seasons: filters.seasons, width: filters.width, profile: filters.profile, studded: filters.studded, runflat: filters.runflat, diameter: filters.diameter },
    { seasons: [], width: "", profile: "", studded: false, runflat: false, diameter: "18" },
  );
});

test("brands and search text are cleaned and limited like the API", () => {
  const { filters } = parseCatalogUrlState(
    `?brand=${encodeURIComponent(" Michelin ,Michelin,,Pirelli\u0007")}&q=${encodeURIComponent("  ice zero  ")}`,
    defaults(),
  );
  assert.deepEqual(filters.brands, ["Michelin", "Pirelli"]);
  assert.equal(filters.query, "ice zero");
  const manyBrands = Array.from({ length: 60 }, (_, index) => `Brand${String(index).padStart(3, "0")}`).join(",");
  const limited = parseCatalogUrlState(`?brand=${manyBrands}`, defaults()).filters.brands;
  assert.ok(limited.join(",").length <= 500);
  assert.ok(limited.length > 1);
});

test("the address keeps other parameters and the hash, drops one-time ones", () => {
  const parameters = serializeCatalogUrlState(
    { filters: { ...defaults(), brands: ["Michelin", "Pirelli"], query: "лето" }, page: 1 },
    defaults(),
  );
  const href = buildCatalogHref(
    { pathname: "/shiny", search: "?utm_source=vk&brand=Old&cart=open&page=4", hash: "#catalog" },
    parameters,
  );
  assert.equal(href, "/shiny?q=%D0%BB%D0%B5%D1%82%D0%BE&brand=Michelin,Pirelli&utm_source=vk#catalog");
  assert.equal(
    buildCatalogHref({ pathname: "/", search: "?cart=open", hash: "" }, new URLSearchParams()),
    "/",
  );
  assert.equal(
    withoutOneTimeParameters({ pathname: "/", search: "?cart=open&brand=Michelin", hash: "#selector" }),
    "/?brand=Michelin#selector",
  );
});

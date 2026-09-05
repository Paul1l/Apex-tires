import assert from "node:assert/strict";
import test from "node:test";
import { catalogQuerySchema } from "../validators/catalog-query-schema";
import { normalizeCatalogSearch } from "../services/catalog-search-parser";

test("catalog rejects unbounded pages, unknown sorting and invalid filters", () => {
  for (const input of [{ pageSize: 100000 }, { page: -1 }, { sort: "popular" }, { width: "N/A" }, { inStock: "yes" }]) {
    assert.equal(catalogQuerySchema.safeParse(input).success, false);
  }
  assert.equal(catalogQuerySchema.parse({ type: "wheel", width: "7.5" }).width, 7.5);
});

test("complete tire search becomes size filters without guessing ambiguous requests", () => {
  const result = normalizeCatalogSearch(catalogQuerySchema.parse({ search: "225 45 R18" }));
  assert.equal(result.width, 225);
  assert.equal(result.profile, 45);
  assert.equal(result.diameter, 18);
  assert.equal(result.search, undefined);
  assert.equal(normalizeCatalogSearch(catalogQuerySchema.parse({ search: "5 112 r18" })).search, "5 112 r18");
});

import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PRODUCT_SLUG_LENGTH, decodeProductRouteSlug } from "../../app/tires/route-slug.js";
import {
  parseProductSitemapPage,
  productSitemapPageCount,
  productSitemapPageExists,
} from "../../app/sitemaps/product-sitemap-pages.js";
import { SITEMAP_PAGE_SIZE } from "../services/sitemap-service.js";
import { createProductSlug } from "../utils/product-slug.js";

test("product slugs are decoded from the percent-encoded route parameter", () => {
  const slug = createProductSlug("Nordman 8 205/55 R16 94T XL шипованная", "T5D-SKU-T1");
  assert.equal(decodeProductRouteSlug(encodeURIComponent(slug)), slug);
  assert.equal(decodeProductRouteSlug(slug), slug, "an already decoded slug stays the same");
  assert.equal(decodeProductRouteSlug("product-0123456789abcdef"), "product-0123456789abcdef");
});

test("malformed percent-encoding is rejected (404, not 500)", () => {
  for (const raw of ["%E0%A4%A", "%C0%AF", "%", "%zz", "abc%"]) {
    assert.equal(decodeProductRouteSlug(raw), null, raw);
  }
});

test("control characters never reach the database query", () => {
  for (const raw of ["%00", "abc%00def", "%0A", "%1F", "%7F", "%C2%85", "%E2%80%8B", "a%09b"]) {
    assert.equal(decodeProductRouteSlug(raw), null, raw);
  }
});

test("path separators, whitespace and oversized values are rejected", () => {
  assert.equal(decodeProductRouteSlug("a%2Fb"), null);
  assert.equal(decodeProductRouteSlug("a%5Cb"), null);
  assert.equal(decodeProductRouteSlug("a%20b"), null);
  assert.equal(decodeProductRouteSlug(""), null);
  assert.equal(decodeProductRouteSlug("a".repeat(MAX_PRODUCT_SLUG_LENGTH)), "a".repeat(MAX_PRODUCT_SLUG_LENGTH));
  assert.equal(decodeProductRouteSlug("a".repeat(MAX_PRODUCT_SLUG_LENGTH + 1)), null);
  assert.equal(decodeProductRouteSlug(encodeURIComponent("ш".repeat(MAX_PRODUCT_SLUG_LENGTH + 1))), null);
  assert.equal(decodeProductRouteSlug("%41".repeat(10_000)), null, "huge encoded values are not decoded");
});

test("the longest generated slug is accepted", () => {
  const slug = createProductSlug("я".repeat(500), "S".repeat(200));
  assert.ok(slug.length <= MAX_PRODUCT_SLUG_LENGTH);
  assert.equal(decodeProductRouteSlug(encodeURIComponent(slug)), slug);
});

test("product sitemap page names: canonical numbers only", () => {
  assert.equal(parseProductSitemapPage("products-0.xml"), 0);
  assert.equal(parseProductSitemapPage("products-12.xml"), 12);
  for (const name of ["products-x.xml", "products-01.xml", "products--1.xml", "products-1.5.xml", "products-123456.xml", "products-1.xml.gz", "static.xml", "products-.xml"]) {
    assert.equal(parseProductSitemapPage(name), null, name);
  }
});

test("product sitemap pages outside the index are not found", () => {
  assert.equal(productSitemapPageCount(0), 0);
  assert.equal(productSitemapPageCount(46), 1);
  assert.equal(productSitemapPageCount(SITEMAP_PAGE_SIZE), 1);
  assert.equal(productSitemapPageCount(SITEMAP_PAGE_SIZE + 1), 2);

  assert.equal(productSitemapPageExists(0, 46), true);
  assert.equal(productSitemapPageExists(1, 46), false, "QA-12: products-1.xml with 46 products");
  assert.equal(productSitemapPageExists(0, 0), false, "no products → no product pages");
  assert.equal(productSitemapPageExists(1, SITEMAP_PAGE_SIZE + 1), true);
  assert.equal(productSitemapPageExists(-1, 46), false);
});

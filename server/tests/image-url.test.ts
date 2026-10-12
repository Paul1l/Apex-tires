import assert from "node:assert/strict";
import test from "node:test";
import { isSafeImageUrl, toSafeImageUrl } from "../validators/image-url.js";
import { productSchema } from "../validators/one-c-schemas.js";

const tire = {
  externalId: "e1",
  sku: "s1",
  name: "Шина",
  brand: "Ikon",
  model: "Autograph",
  kind: "tire",
  width: 205,
  profile: 55,
  diameter: 16,
  season: "summer",
};

test("only https URLs and site-relative paths are accepted", () => {
  for (const url of [
    "https://storage.example.ru/products/tyre-001.webp",
    "https://cdn.example.ru/фото шины.jpg",
    "/assets/products/tyre-001.webp",
  ]) {
    assert.equal(isSafeImageUrl(url), true, url);
  }
  for (const url of [
    "javascript:alert(document.domain)",
    "JAVASCRIPT:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "file:///etc/passwd",
    "http://169.254.169.254/latest",
    "//evil.example/pixel.gif",
    "/\\evil.example/pixel.gif",
    "/\t/evil.example/pixel.gif",
    " https://storage.example.ru/a.jpg",
    "https://user:password@storage.example.ru/a.jpg",
    "ftp://storage.example.ru/a.jpg",
    "relative/path.jpg",
    "",
    `https://example.ru/${"a".repeat(2_000)}`,
  ]) {
    assert.equal(isSafeImageUrl(url), false, url);
  }
  assert.equal(isSafeImageUrl(null), false);
});

test("product import schema (1C and CSV) rejects unsafe image URLs", () => {
  const unsafe = productSchema.safeParse({ ...tire, images: [{ url: "javascript:alert(1)" }] });
  assert.equal(unsafe.success, false);
  const http = productSchema.safeParse({ ...tire, images: [{ url: "http://storage.example.ru/a.jpg" }] });
  assert.equal(http.success, false);
  const safe = productSchema.safeParse({
    ...tire,
    images: [{ url: "  https://storage.example.ru/a.jpg  " }, { url: "/assets/b.webp" }],
  });
  assert.equal(safe.success, true);
  assert.equal(safe.success && safe.data.images[0].url, "https://storage.example.ru/a.jpg");
});

test("stored unsafe URLs are dropped when read back", () => {
  assert.equal(toSafeImageUrl("javascript:alert(1)"), null);
  assert.equal(toSafeImageUrl("data:image/png;base64,AAAA"), null);
  assert.equal(toSafeImageUrl(null), null);
  assert.equal(toSafeImageUrl("https://storage.example.ru/a.jpg"), "https://storage.example.ru/a.jpg");
});

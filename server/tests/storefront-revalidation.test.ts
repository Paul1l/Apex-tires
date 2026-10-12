import assert from "node:assert/strict";
import test from "node:test";
import {
  STOREFRONT_CATALOG_PATHS,
  revalidateStorefrontCatalog,
} from "../cache/storefront-revalidation.js";

const environment = process.env as Record<string, string | undefined>;

test("storefront revalidation resets the three ISR catalog pages", () => {
  const paths: string[] = [];
  assert.equal(revalidateStorefrontCatalog("test", (path) => paths.push(path)), true);
  assert.deepEqual(paths, ["/", "/shiny", "/diski"]);
  assert.deepEqual([...STOREFRONT_CATALOG_PATHS], paths);
});

test("a revalidation failure is reported, not thrown, and the other pages are still reset", () => {
  const paths: string[] = [];
  const result = revalidateStorefrontCatalog("test", (path) => {
    if (path === "/shiny") throw new Error("cache unavailable");
    paths.push(path);
  });
  assert.equal(result, false);
  assert.deepEqual(paths, ["/", "/diski"]);
});

test("outside a Next.js request (CLI import) revalidation is a logged no-op", () => {
  assert.equal(revalidateStorefrontCatalog("cli"), false);
});

test("the internal revalidation job requires the job key", async () => {
  const previous = environment.INTERNAL_JOB_SECRET;
  try {
    const { POST } = await import("../../app/api/internal/jobs/catalog-revalidation/route.js");
    delete environment.INTERNAL_JOB_SECRET;
    const disabled = await POST(new Request("https://store.example/api/internal/jobs/catalog-revalidation", {
      method: "POST",
      headers: { "X-Job-Key": "anything" },
    }));
    assert.equal(disabled.status, 401);

    environment.INTERNAL_JOB_SECRET = "j".repeat(40);
    const deniedHeaders: Array<Record<string, string>> = [{}, { "X-Job-Key": "wrong" }, { "X-Job-Key": "j".repeat(39) }];
    for (const headers of deniedHeaders) {
      const denied = await POST(new Request("https://store.example/api/internal/jobs/catalog-revalidation", {
        method: "POST",
        headers,
      }));
      assert.equal(denied.status, 401);
    }
  } finally {
    if (previous === undefined) delete environment.INTERNAL_JOB_SECRET;
    else environment.INTERNAL_JOB_SECRET = previous;
  }
});

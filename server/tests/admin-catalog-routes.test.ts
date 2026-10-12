import assert from "node:assert/strict";
import test from "node:test";

const PRODUCT_ID = "4b0c7f6e-1d1a-4c55-9d43-6f0f3a2b8c11";
const OTHER_ID = "5b0c7f6e-1d1a-4c55-9d43-6f0f3a2b8c11";
const environment = process.env as Record<string, string | undefined>;

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function routes(): Promise<Array<{ name: string; method: string; handler: Handler; params: Record<string, string>; body?: string }>> {
  const products = await import("../../app/api/admin/products/route.js");
  const product = await import("../../app/api/admin/products/[productId]/route.js");
  const images = await import("../../app/api/admin/products/[productId]/images/route.js");
  const image = await import("../../app/api/admin/products/[productId]/images/[imageId]/route.js");
  const fitments = await import("../../app/api/admin/products/[productId]/fitments/route.js");
  const fitment = await import("../../app/api/admin/products/[productId]/fitments/[fitmentId]/route.js");
  const references = await import("../../app/api/admin/products/vehicle-references/route.js");
  const brands = await import("../../app/api/admin/brands/route.js");
  const categories = await import("../../app/api/admin/categories/route.js");
  const warehouses = await import("../../app/api/admin/warehouses/route.js");
  const id = { productId: PRODUCT_ID };
  return [
    { name: "products GET", method: "GET", handler: products.GET as unknown as Handler, params: {} },
    { name: "products POST", method: "POST", handler: products.POST as unknown as Handler, params: {}, body: "{}" },
    { name: "product GET", method: "GET", handler: product.GET as unknown as Handler, params: id },
    { name: "product PATCH", method: "PATCH", handler: product.PATCH as unknown as Handler, params: id, body: "{}" },
    { name: "images POST", method: "POST", handler: images.POST as unknown as Handler, params: id, body: "{}" },
    { name: "images PATCH", method: "PATCH", handler: images.PATCH as unknown as Handler, params: id, body: "{}" },
    { name: "image DELETE", method: "DELETE", handler: image.DELETE as unknown as Handler, params: { ...id, imageId: OTHER_ID } },
    { name: "fitments GET", method: "GET", handler: fitments.GET as unknown as Handler, params: id },
    { name: "fitments POST", method: "POST", handler: fitments.POST as unknown as Handler, params: id, body: "{}" },
    { name: "fitment DELETE", method: "DELETE", handler: fitment.DELETE as unknown as Handler, params: { ...id, fitmentId: OTHER_ID } },
    { name: "vehicle references GET", method: "GET", handler: references.GET as unknown as Handler, params: {} },
    { name: "brands GET", method: "GET", handler: brands.GET as unknown as Handler, params: {} },
    { name: "brands POST", method: "POST", handler: brands.POST as unknown as Handler, params: {}, body: "{}" },
    { name: "categories GET", method: "GET", handler: categories.GET as unknown as Handler, params: {} },
    { name: "categories POST", method: "POST", handler: categories.POST as unknown as Handler, params: {}, body: "{}" },
    { name: "warehouses GET", method: "GET", handler: warehouses.GET as unknown as Handler, params: {} },
  ];
}

function call(
  route: { method: string; handler: Handler; params: Record<string, string>; body?: string },
  headers: Record<string, string> = {},
) {
  return route.handler(new Request("https://store.example/api/admin/test", {
    method: route.method,
    headers: { ...(route.body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: route.body,
  }), { params: Promise.resolve(route.params) });
}

async function withEnvironment(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, environment[key]]));
  const { error, warn, info } = console;
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
    console.error = error;
    console.warn = warn;
    console.info = info;
  }
}

test("admin catalog API: 503 without PostgreSQL, before reading anything", async () => {
  await withEnvironment({ DATABASE_URL: undefined }, async () => {
    for (const route of await routes()) {
      const response = await call(route);
      assert.equal(response.status, 503, route.name);
      assert.equal((await response.json()).code, "CATALOG_STORAGE_NOT_CONFIGURED", route.name);
      assert.equal(response.headers.get("cache-control"), "private, no-store", route.name);
    }
  });
});

test("admin catalog API: staff session required, cross-site requests refused", async () => {
  await withEnvironment({
    // No connection is opened: without a session cookie the user is never looked up.
    DATABASE_URL: "postgresql://nobody@127.0.0.1:1/none",
    DATABASE_SSL_MODE: "disable",
    OTP_CODE_PEPPER: "t21b-route-test-pepper-0123456789abcdef",
  }, async () => {
    for (const route of await routes()) {
      const anonymous = await call(route, { Origin: "https://store.example" });
      assert.equal(anonymous.status, 401, route.name);
      assert.equal((await anonymous.json()).code, "AUTHENTICATION_REQUIRED", route.name);
      if (route.method === "GET") continue;
      const refusedHeaders: Array<Record<string, string>> = [{ "Sec-Fetch-Site": "cross-site" }, { Origin: "https://evil.example" }, {}];
      for (const headers of refusedHeaders) {
        const refused = await call(route, headers);
        assert.equal(refused.status, 403, `${route.name} ${JSON.stringify(headers)}`);
        assert.equal((await refused.json()).code, "UNTRUSTED_ORIGIN", route.name);
      }
    }
  });
});

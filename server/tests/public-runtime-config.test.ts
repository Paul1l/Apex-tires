import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readYandexMetrikaCounterId } from "../config/public-runtime-config.js";

const cloudflareContextSymbol = Symbol.for("__cloudflare-context__");
const globalScope = globalThis as Record<symbol, unknown>;

test("Node.js runtime (next start) reads the counter from process.env", () => {
  delete globalScope[cloudflareContextSymbol];
  assert.equal(readYandexMetrikaCounterId({ YANDEX_METRIKA_COUNTER_ID: "98765432" }), 98765432);
  assert.equal(readYandexMetrikaCounterId({ YANDEX_METRIKA_COUNTER_ID: " 98765432 " }), 98765432);
  assert.equal(readYandexMetrikaCounterId({}), null);
  assert.equal(readYandexMetrikaCounterId({ YANDEX_METRIKA_COUNTER_ID: "abc" }), null);
});

test("Cloudflare Workers read vars from the request context, with process.env as fallback", () => {
  try {
    globalScope[cloudflareContextSymbol] = { env: { YANDEX_METRIKA_COUNTER_ID: "11223344" }, ctx: {}, cf: {} };
    assert.equal(readYandexMetrikaCounterId({ YANDEX_METRIKA_COUNTER_ID: "98765432" }), 11223344);
    // next dev: wrangler's context has no such var, .env.local provides it.
    globalScope[cloudflareContextSymbol] = { env: {}, ctx: {}, cf: {} };
    assert.equal(readYandexMetrikaCounterId({ YANDEX_METRIKA_COUNTER_ID: "98765432" }), 98765432);
  } finally {
    delete globalScope[cloudflareContextSymbol];
  }
});

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return listSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

test("no runtime code uses the async Cloudflare context (it starts workerd under next start)", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const offenders = ["app", "server", "lib", "components"]
    .flatMap((directory) => listSourceFiles(path.join(root, directory)))
    .filter((file) => !file.includes(`${path.sep}tests${path.sep}`))
    .filter((file) => /getCloudflareContext\(\s*\{\s*async\s*:\s*true/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("next.config initializes the Cloudflare dev context only for next dev", async () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../../next.config.ts"), "utf8");
  assert.match(source, /if \(phase === PHASE_DEVELOPMENT_SERVER\) \{\s*void initOpenNextCloudflareForDev\(\);/);
  assert.equal(source.match(/initOpenNextCloudflareForDev\(\)/g)?.length, 1);
  const { default: createNextConfig } = await import("../../next.config.js");
  const config = createNextConfig("phase-production-server");
  assert.equal(config.poweredByHeader, false);
  assert.equal(typeof config.headers, "function");
});

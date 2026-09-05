import assert from "node:assert/strict";
import test from "node:test";
import { readCsvUpload } from "../utils/csv-upload";
import { requireSameOrigin } from "../security/request-origin";

test("CSV multipart preserves case-sensitive boundaries and filename", async () => {
  const boundary = "APEXMixedCaseBoundary";
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="products.csv"\r\nContent-Type: text/csv\r\n\r\nsku,name\nA,Шина\r\n--${boundary}--\r\n`;
  const upload = await readCsvUpload(new Request("https://store.example/api/import", {
    method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body,
  }));
  assert.equal(upload.filename, "products.csv");
  assert.equal(await new Response(upload.stream).text(), "sku,name\nA,Шина");
});

test("CSV upload rejects oversized content and malformed encoded filenames", async () => {
  await assert.rejects(() => readCsvUpload(new Request("https://store.example/api/import", {
    method: "POST", headers: { "Content-Type": "text/csv", "Content-Length": "200000001" }, body: "sku",
  })), { code: "CSV_FILE_TOO_LARGE" });
  await assert.rejects(() => readCsvUpload(new Request("https://store.example/api/import", {
    method: "POST", headers: { "Content-Type": "text/csv", "X-File-Name": "%invalid" }, body: "sku",
  })), { code: "INVALID_FILENAME" });
});

test("Cookie-authorized mutations reject cross-site requests", () => {
  assert.throws(() => requireSameOrigin(new Request("https://store.example/api/orders", {
    method: "POST", headers: { "Sec-Fetch-Site": "cross-site" },
  })), { code: "UNTRUSTED_ORIGIN" });
  assert.doesNotThrow(() => requireSameOrigin(new Request("https://store.example/api/products")));
});

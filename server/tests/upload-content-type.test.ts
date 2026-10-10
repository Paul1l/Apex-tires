import assert from "node:assert/strict";
import test from "node:test";
import { readCsvUpload } from "../utils/csv-upload.js";

function upload(headers: Record<string, string>, body: string) {
  return readCsvUpload(new Request("https://store.example/api/admin/imports/products", { method: "POST", headers, body }));
}

test("CSV upload answers 415 for JSON and other non-CSV bodies instead of a 500", async () => {
  for (const contentType of ["application/json", "text/plain", "application/x-www-form-urlencoded"]) {
    await assert.rejects(upload({ "Content-Type": contentType }, '{"rows":[]}'), {
      code: "UNSUPPORTED_MEDIA_TYPE",
      statusCode: 415,
    });
  }
  await assert.rejects(
    readCsvUpload(new Request("https://store.example/api/admin/imports/fitments", { method: "POST", body: new Uint8Array([1]) })),
    { code: "UNSUPPORTED_MEDIA_TYPE", statusCode: 415 },
  );
});

test("broken multipart bodies are a 422 with a clear message", async () => {
  await assert.rejects(upload({ "Content-Type": "multipart/form-data" }, "not a form"), {
    code: "INVALID_MULTIPART",
    statusCode: 422,
  });
  await assert.rejects(upload({ "Content-Type": "multipart/form-data; boundary=abc" }, "garbage without parts"), {
    code: "INVALID_MULTIPART",
    statusCode: 422,
  });
});

test("supported CSV uploads still pass", async () => {
  const streamed = await upload({ "Content-Type": "text/csv; charset=utf-8", "X-File-Name": "products.csv" }, "sku\nA");
  assert.equal(streamed.filename, "products.csv");
  assert.equal(await new Response(streamed.stream).text(), "sku\nA");
});

import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../utils/errors.js";
import { isJsonContentType, readJsonRequest } from "../utils/http.js";

function streamingRequest(totalChunks: number, chunkBytes: number, contentType = "application/json") {
  const chunk = new Uint8Array(chunkBytes).fill(0x61);
  const progress = { pulledBytes: 0, cancelled: false };
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalChunks) {
        controller.close();
        return;
      }
      sent += 1;
      progress.pulledBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      progress.cancelled = true;
    },
  });
  const request = new Request("https://store.example/api/auth/verify-code", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, progress };
}

function isApplicationError(code: string, statusCode: number) {
  return (error: unknown) =>
    error instanceof ApplicationError && error.code === code && error.statusCode === statusCode;
}

test("oversized chunked body is rejected without reading the whole stream", async () => {
  // 40 MiB without Content-Length against a 20 000-byte limit.
  const { request, progress } = streamingRequest(40, 1024 * 1024);
  await assert.rejects(readJsonRequest(request, 20_000), isApplicationError("REQUEST_TOO_LARGE", 413));
  assert.ok(progress.pulledBytes <= 3 * 1024 * 1024, `read ${progress.pulledBytes} bytes`);
  assert.equal(progress.cancelled, true, "the stream must be cancelled");
});

test("Content-Length above the limit is rejected before reading", async () => {
  const request = new Request("https://store.example/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "50000000" },
    body: "{}",
  });
  await assert.rejects(readJsonRequest(request, 20_000), isApplicationError("REQUEST_TOO_LARGE", 413));
});

test("small chunked JSON bodies within the limit are parsed", async () => {
  const encoder = new TextEncoder();
  const parts = ['{"items":[', '{"productId":"a","quantity":2}', "]}"];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  const request = new Request("https://store.example/api", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.deepEqual(await readJsonRequest(request, 1_000), { items: [{ productId: "a", quantity: 2 }] });
});

test("non-JSON content types are rejected with 415 (cross-site text/plain forms)", async () => {
  const body = '{"challengeId":"11111111-1111-4111-8111-111111111111","code":"123456","x":"="}';
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const request = new Request("https://store.example/api/auth/verify-code", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
    await assert.rejects(readJsonRequest(request, 20_000), isApplicationError("UNSUPPORTED_MEDIA_TYPE", 415));
  }
  const withoutType = new Request("https://store.example/api", { method: "POST", body: new Uint8Array([123, 125]) });
  await assert.rejects(readJsonRequest(withoutType), isApplicationError("UNSUPPORTED_MEDIA_TYPE", 415));
});

test("JSON content type detection accepts parameters and casing", () => {
  assert.equal(isJsonContentType("application/json"), true);
  assert.equal(isJsonContentType("Application/JSON; charset=UTF-8"), true);
  assert.equal(isJsonContentType("application/jsonp"), false);
  assert.equal(isJsonContentType("text/json"), false);
  assert.equal(isJsonContentType(null), false);
});

test("UTF-8 BOM is skipped and invalid UTF-8 is reported as invalid JSON", async () => {
  const withBom = new Request("https://store.example/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"apiVersion":"1.0"}')]),
  });
  assert.deepEqual(await readJsonRequest(withBom), { apiVersion: "1.0" });

  const invalidUtf8 = new Request("https://store.example/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new Uint8Array([0x7b, 0xff, 0x7d]),
  });
  await assert.rejects(readJsonRequest(invalidUtf8), isApplicationError("INVALID_JSON", 400));
});

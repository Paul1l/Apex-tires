import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Pool } from "pg";
import { readUploadEnvironment, uploadsAreEnabled } from "../config/environment.js";
import { buildAdminCatalogServices } from "../services/admin-catalog-services.js";
import { describeUploadSettings } from "../storage/image-storage.js";
import { detectImageType } from "../storage/image-signature.js";
import { readImageUpload } from "../storage/image-upload-request.js";
import { LocalImageStorage } from "../storage/local-image-storage.js";
import {
  isOwnProductImageKey,
  parseStorageKey,
  parseUploadSegments,
  publicUploadUrl,
} from "../storage/upload-path.js";
import {
  JPEG,
  JPEG_PROGRESSIVE,
  JPEG_SIGNATURE_THEN_HTML,
  PNG,
  PNG_WITH_TEXT,
  POLYGLOTS,
  WEBP,
  WEBP_EXTENDED,
  WEBP_LOSSLESS,
  webpWithForgedSize,
} from "./upload-image-fixtures.js";

const PRODUCT_ID = "4b0c7f6e-1d1a-4c55-9d43-6f0f3a2b8c11";
const FILE_NAME = `${"a".repeat(32)}.png`;

const encoder = new TextEncoder();

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "t21b-uploads-"));
}

function multipart(parts: Array<{ name: string; value: Uint8Array | string; filename?: string; type?: string }>) {
  const boundary = "T21bBoundary7MA4YWxkTrZu0gW";
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const disposition = `form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ""}`;
    const head = `--${boundary}\r\nContent-Disposition: ${disposition}\r\n${part.type ? `Content-Type: ${part.type}\r\n` : ""}\r\n`;
    chunks.push(encoder.encode(head), typeof part.value === "string" ? encoder.encode(part.value) : part.value, encoder.encode("\r\n"));
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return new Request("https://store.example/api/admin/products/x/images", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

test("image type comes from content only: JPEG, PNG, WebP; SVG, HTML and others are refused", () => {
  assert.equal(detectImageType(JPEG), "jpeg");
  assert.equal(detectImageType(JPEG_PROGRESSIVE), "jpeg");
  assert.equal(detectImageType(PNG), "png");
  assert.equal(detectImageType(PNG_WITH_TEXT), "png");
  assert.equal(detectImageType(WEBP), "webp");
  assert.equal(detectImageType(WEBP_LOSSLESS), "webp");
  assert.equal(detectImageType(WEBP_EXTENDED), "webp");
  const refused = [
    encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    encoder.encode("<!DOCTYPE html><html><body>x</body></html>"),
    encoder.encode("GIF89a\u0001\u0000\u0001\u0000"),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74]),
    new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVEfmt ")]),
    new Uint8Array([0xff, 0xd8]),
    new Uint8Array(),
  ];
  for (const bytes of refused) assert.equal(detectImageType(bytes), null);
});

test("QA-26: polyglots and data around the image are refused by the structure checks", () => {
  for (const [name, bytes] of POLYGLOTS) assert.equal(detectImageType(bytes), null, name);
  assert.equal(detectImageType(webpWithForgedSize()), null, "a RIFF size covering HTML is still not a chunk chain");
  const padded = new Uint8Array([...JPEG, ...new Uint8Array(512)]);
  assert.equal(detectImageType(padded), "jpeg", "NUL padding after EOI (cameras, card recovery) cannot carry markup");
  assert.equal(detectImageType(new Uint8Array([...JPEG, 0xff])), null, "any other trailing byte is refused");
  const noFrame = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9]);
  assert.equal(detectImageType(noFrame), null, "a scan without a frame header is not a JPEG");
  const pngWrongIend = new Uint8Array(PNG);
  pngWrongIend[pngWrongIend.length - 1] ^= 0xff;
  assert.equal(detectImageType(pngWrongIend), null, "IEND must carry its fixed CRC");
  const webpWrongSize = new Uint8Array(WEBP);
  webpWrongSize[4] += 2;
  assert.equal(detectImageType(webpWrongSize), null, "RIFF size must equal the file length");
});

test("upload paths: only products/<uuid>/<32 hex>.<jpg|png|webp> is accepted", () => {
  const key = parseUploadSegments(["products", PRODUCT_ID, FILE_NAME]);
  assert.deepEqual(key, {
    storageKey: `products/${PRODUCT_ID}/${FILE_NAME}`, productId: PRODUCT_ID, fileName: FILE_NAME, contentType: "image/png",
  });
  assert.equal(parseUploadSegments(["products", PRODUCT_ID, `${"b".repeat(32)}.jpg`])?.contentType, "image/jpeg");
  assert.equal(parseUploadSegments(["products", PRODUCT_ID, `${"c".repeat(32)}.webp`])?.contentType, "image/webp");
  const refused: string[][] = [
    ["products", PRODUCT_ID, "..", FILE_NAME],
    ["products", "..", "..", "etc", "passwd"],
    ["products", PRODUCT_ID, "../../etc/passwd"],
    ["products", PRODUCT_ID, "%2e%2e%2fsecret.png"],
    ["products", PRODUCT_ID, `..%2F${FILE_NAME}`],
    ["products", PRODUCT_ID, `${"a".repeat(32)}.png\u0000.html`],
    ["products", PRODUCT_ID, `${"a".repeat(32)}.svg`],
    ["products", PRODUCT_ID, `${"a".repeat(32)}.html`],
    ["products", PRODUCT_ID, `${"A".repeat(32)}.png`],
    ["products", PRODUCT_ID, `${"a".repeat(31)}.png`],
    ["products", PRODUCT_ID.toUpperCase(), FILE_NAME],
    ["products", "/etc", FILE_NAME],
    ["products", `${PRODUCT_ID}\\..`, FILE_NAME],
    ["lots", PRODUCT_ID, FILE_NAME],
    ["/products", PRODUCT_ID, FILE_NAME],
    ["products", PRODUCT_ID],
    [],
  ];
  for (const segments of refused) assert.equal(parseUploadSegments(segments), null, segments.join("/"));
  assert.equal(parseStorageKey(`/products/${PRODUCT_ID}/${FILE_NAME}`), null, "absolute keys are refused");
  assert.equal(parseStorageKey(null), null);
  assert.equal(publicUploadUrl(`products/${PRODUCT_ID}/${FILE_NAME}`), `/uploads/products/${PRODUCT_ID}/${FILE_NAME}`);
  assert.equal(isOwnProductImageKey(PRODUCT_ID, `products/${PRODUCT_ID}/${FILE_NAME}`), true);
  assert.equal(isOwnProductImageKey("0b0c7f6e-1d1a-4c55-9d43-6f0f3a2b8c11", `products/${PRODUCT_ID}/${FILE_NAME}`), false, "another product's file is never deleted");
  assert.equal(isOwnProductImageKey(PRODUCT_ID, "lots/legacy/file.jpg"), false);
});

test("upload settings: disabled without UPLOADS_DIR, defaults, invalid values reported by name", () => {
  // QA-27: a wrong limit keeps UPLOADS_DIR (stored photos are still served) and only stops uploads.
  const wrongLimit = readUploadEnvironment({ UPLOADS_DIR: "/srv/uploads", PRODUCT_IMAGE_MAX_BYTES: "5MB" });
  assert.equal(wrongLimit.uploadsDirectory, "/srv/uploads");
  assert.equal(wrongLimit.productImageMaxBytes, 5 * 1024 * 1024, "the default stays in effect for the editor");
  assert.equal(uploadsAreEnabled(wrongLimit), false);
  assert.match(wrongLimit.problem ?? "", /PRODUCT_IMAGE_MAX_BYTES/);
  assert.match(wrongLimit.problem ?? "", /продолжают показываться/);
  assert.doesNotMatch(wrongLimit.problem ?? "", /5MB/, "the value itself is not echoed");
  assert.deepEqual(describeUploadSettings(wrongLimit).enabled, false);
  assert.match(describeUploadSettings(wrongLimit).reason ?? "", /PRODUCT_IMAGE_MAX_BYTES/);
  assert.equal(uploadsAreEnabled(readUploadEnvironment({ UPLOADS_DIR: "/srv/uploads" })), true);
  const empty = readUploadEnvironment({});
  assert.deepEqual(empty, { uploadsDirectory: null, productImageMaxBytes: 5 * 1024 * 1024, productImageMaxCount: 10, problem: null });
  assert.match(describeUploadSettings(empty).reason ?? "", /UPLOADS_DIR/);
  assert.equal(describeUploadSettings(readUploadEnvironment({ UPLOADS_DIR: "/srv/uploads" })).enabled, true);
  assert.deepEqual(
    readUploadEnvironment({ UPLOADS_DIR: "/srv/uploads", PRODUCT_IMAGE_MAX_BYTES: "2000000", PRODUCT_IMAGE_MAX_COUNT: "" }),
    { uploadsDirectory: "/srv/uploads", productImageMaxBytes: 2_000_000, productImageMaxCount: 10, problem: null },
  );
  const relative = readUploadEnvironment({ UPLOADS_DIR: "uploads" });
  assert.equal(relative.uploadsDirectory, null, "a relative directory disables uploads");
  assert.match(relative.problem ?? "", /UPLOADS_DIR/);
  assert.doesNotMatch(relative.problem ?? "", /uploads$/, "the value itself is not echoed");
  assert.match(relative.problem ?? "", /не отдаются/, "with a wrong UPLOADS_DIR stored photos cannot be served");
  const bothWrong = readUploadEnvironment({ UPLOADS_DIR: "/srv/u", PRODUCT_IMAGE_MAX_BYTES: "abc", PRODUCT_IMAGE_MAX_COUNT: "31" });
  assert.equal(bothWrong.uploadsDirectory, "/srv/u");
  assert.match(bothWrong.problem ?? "", /PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MAX_COUNT/);
});

test("QA-27: uploads are refused with 503 and the reason while a limit is wrong; a valid setup gets storage", async () => {
  const pool = {} as Pool; // requireUploads never queries the database
  const services = (source: Record<string, string>) =>
    buildAdminCatalogServices({ pool, uploadEnvironment: () => readUploadEnvironment(source) }).images;
  await assert.rejects(
    services({ UPLOADS_DIR: "/srv/uploads", PRODUCT_IMAGE_MAX_COUNT: "0" }).requireUploads(),
    (error: Error & { code?: string; statusCode?: number }) =>
      error.code === "UPLOADS_NOT_CONFIGURED" && error.statusCode === 503 && /PRODUCT_IMAGE_MAX_COUNT/.test(error.message),
  );
  await assert.rejects(services({}).requireUploads(), (error: Error & { code?: string }) =>
    error.code === "UPLOADS_NOT_CONFIGURED" && /UPLOADS_DIR/.test(error.message));
  const ready = await services({ UPLOADS_DIR: "/srv/uploads" }).requireUploads();
  assert.equal(ready.environment.uploadsDirectory, "/srv/uploads");
  assert.ok(ready.storage);
});

test("multipart photo upload: content decides, browser name and type are ignored, size is limited", async () => {
  const upload = await readImageUpload(multipart([
    { name: "file", value: PNG, filename: "photo.jpg", type: "image/jpeg" },
    { name: "alt", value: "  Шина сбоку  " },
  ]), 1_000_000);
  assert.equal(upload.type, "png");
  assert.equal(upload.alt, "Шина сбоку");
  assert.deepEqual(upload.bytes, PNG);
  await assert.rejects(
    readImageUpload(multipart([{ name: "file", value: encoder.encode("<svg onload=alert(1)>"), filename: "x.png", type: "image/png" }]), 1_000_000),
    { code: "UNSUPPORTED_IMAGE_TYPE", statusCode: 415 },
  );
  await assert.rejects(
    readImageUpload(multipart([{ name: "file", value: encoder.encode("<html></html>"), filename: "x.webp", type: "image/webp" }]), 1_000_000),
    { code: "UNSUPPORTED_IMAGE_TYPE" },
  );
  await assert.rejects(
    readImageUpload(multipart([{ name: "file", value: JPEG_SIGNATURE_THEN_HTML, filename: "photo.jpg", type: "image/jpeg" }]), 1_000_000),
    (error: Error & { code?: string; statusCode?: number }) =>
      error.code === "UNSUPPORTED_IMAGE_TYPE" && error.statusCode === 415 && /JPEG, PNG, WebP/.test(error.message),
    "QA-26: JPEG signature followed by HTML",
  );
  assert.equal((await readImageUpload(multipart([{ name: "file", value: JPEG_PROGRESSIVE, filename: "p.jpg" }]), 1_000_000)).type, "jpeg");
  const big = new Uint8Array(200_000);
  big.set(PNG);
  await assert.rejects(readImageUpload(multipart([{ name: "file", value: big, filename: "big.png" }]), 100_000), { code: "IMAGE_TOO_LARGE", statusCode: 413 });
  await assert.rejects(readImageUpload(multipart([{ name: "alt", value: "x" }]), 1_000_000), { code: "IMAGE_REQUIRED", statusCode: 422 });
  await assert.rejects(
    readImageUpload(new Request("https://store.example/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), 1_000_000),
    { code: "UNSUPPORTED_MEDIA_TYPE", statusCode: 415 },
  );
  await assert.rejects(
    readImageUpload(new Request("https://store.example/x", {
      method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": "99999999" }, body: "x",
    }), 1_000_000),
    { code: "IMAGE_TOO_LARGE" },
  );
  await assert.rejects(readImageUpload(multipart([{ name: "file", value: PNG, filename: "a.png" }, { name: "alt", value: "a".repeat(301) }]), 1_000_000), { code: "VALIDATION_ERROR" });
});

test("local storage: random names inside UPLOADS_DIR, read back, delete only own keys", async () => {
  const root = await temporaryDirectory();
  try {
    const storage = new LocalImageStorage(root);
    const saved = await storage.save(PRODUCT_ID, PNG, "png");
    assert.match(saved.storageKey, new RegExp(`^products/${PRODUCT_ID}/[0-9a-f]{32}\\.png$`));
    assert.equal(saved.url, `/uploads/${saved.storageKey}`);
    const second = await storage.save(PRODUCT_ID, JPEG, "jpeg");
    assert.notEqual(second.storageKey, saved.storageKey);
    assert.equal((await readdir(path.join(root, "products", PRODUCT_ID))).length, 2);
    assert.equal(((await stat(path.join(root, saved.storageKey))).mode & 0o777).toString(8), "640");
    assert.deepEqual(await storage.read(saved.storageKey), { bytes: PNG, contentType: "image/png" });
    assert.equal(await storage.read(`products/${PRODUCT_ID}/${"f".repeat(32)}.png`), null, "missing file");
    assert.equal(await storage.read("../../etc/passwd"), null);
    assert.equal(await storage.remove("../outside.png"), false);
    assert.equal(await storage.remove(saved.storageKey), true);
    assert.equal(await storage.read(saved.storageKey), null);
    assert.equal(await storage.remove(saved.storageKey), false, "a second delete is a no-op");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local storage: symbolic links never lead outside UPLOADS_DIR", async () => {
  const root = await temporaryDirectory();
  const outside = await temporaryDirectory();
  try {
    await writeFile(path.join(outside, "secret.png"), PNG);
    const storage = new LocalImageStorage(root);
    // A file link inside the product folder pointing outside.
    await mkdir(path.join(root, "products", PRODUCT_ID), { recursive: true });
    await symlink(path.join(outside, "secret.png"), path.join(root, "products", PRODUCT_ID, FILE_NAME));
    assert.equal(await storage.read(`products/${PRODUCT_ID}/${FILE_NAME}`), null);
    assert.equal(await storage.remove(`products/${PRODUCT_ID}/${FILE_NAME}`), false);
    assert.ok((await stat(path.join(outside, "secret.png"))).isFile(), "the outside file stays");
    // A product folder that is a link to another directory.
    const linkedProduct = "5b0c7f6e-1d1a-4c55-9d43-6f0f3a2b8c11";
    await symlink(outside, path.join(root, "products", linkedProduct));
    await writeFile(path.join(outside, FILE_NAME), PNG);
    assert.equal(await storage.read(`products/${linkedProduct}/${FILE_NAME}`), null);
    await assert.rejects(storage.save(linkedProduct, PNG, "png"), /outside UPLOADS_DIR/);
    assert.deepEqual((await readdir(outside)).sort(), [FILE_NAME, "secret.png"].sort(), "nothing written outside");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("/uploads route: serves stored photos with fixed headers, 404 for everything else", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = environment.UPLOADS_DIR;
  const root = await temporaryDirectory();
  const outside = await temporaryDirectory();
  const { GET } = await import("../../app/uploads/[...path]/route.js");
  const get = (segments: string[]) =>
    GET(new Request(`https://store.example/uploads/${segments.join("/")}`), { params: Promise.resolve({ path: segments }) });
  try {
    const saved = await new LocalImageStorage(root).save(PRODUCT_ID, PNG, "png");
    delete environment.UPLOADS_DIR;
    assert.equal((await get(saved.storageKey.split("/"))).status, 404, "uploads disabled → 404");

    environment.UPLOADS_DIR = root;
    const response = await get(saved.storageKey.split("/"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);

    // QA-27: a wrong upload limit must not hide photos that are already stored.
    environment.PRODUCT_IMAGE_MAX_BYTES = "not-a-number";
    assert.equal((await get(saved.storageKey.split("/"))).status, 200, "served while uploads are disabled by a wrong limit");
    delete environment.PRODUCT_IMAGE_MAX_BYTES;

    await writeFile(path.join(outside, "secret.png"), PNG);
    await writeFile(path.join(root, "notes.txt"), "secret");
    await symlink(path.join(outside, "secret.png"), path.join(root, "products", PRODUCT_ID, FILE_NAME));
    const attacks: string[][] = [
      ["products", PRODUCT_ID, FILE_NAME],
      ["notes.txt"],
      ["products", "..", "notes.txt"],
      ["..", "..", "etc", "passwd"],
      ["products", PRODUCT_ID, "..%2F..%2Fnotes.txt"],
      ["products", PRODUCT_ID, "%2e%2e"],
      ["products", PRODUCT_ID, `${"a".repeat(32)}.png%00.txt`],
      ["products", PRODUCT_ID, `${"a".repeat(32)}.svg`],
      [root, "notes.txt"],
    ];
    for (const segments of attacks) {
      const attack = await get(segments);
      assert.equal(attack.status, 404, segments.join("/"));
      assert.equal(attack.headers.get("cache-control"), "no-store");
    }
  } finally {
    if (previous === undefined) delete environment.UPLOADS_DIR;
    else environment.UPLOADS_DIR = previous;
    delete environment.PRODUCT_IMAGE_MAX_BYTES;
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

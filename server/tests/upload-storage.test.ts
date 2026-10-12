import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readUploadEnvironment } from "../config/environment.js";
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

const PRODUCT_ID = "4b0c7f6e-1d1a-4c55-9d43-6f0f3a2b8c11";
const FILE_NAME = `${"a".repeat(32)}.png`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBPVP8 "), 0, 0, 0, 0]);
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

test("image type comes from magic bytes only: JPEG, PNG, WebP; SVG, HTML and others are refused", () => {
  assert.equal(detectImageType(JPEG), "jpeg");
  assert.equal(detectImageType(PNG), "png");
  assert.equal(detectImageType(WEBP), "webp");
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
  assert.match(readUploadEnvironment({ UPLOADS_DIR: "/srv/u", PRODUCT_IMAGE_MAX_BYTES: "abc" }).problem ?? "", /PRODUCT_IMAGE_MAX_BYTES/);
  assert.match(readUploadEnvironment({ UPLOADS_DIR: "/srv/u", PRODUCT_IMAGE_MAX_COUNT: "31" }).problem ?? "", /PRODUCT_IMAGE_MAX_COUNT/);
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
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

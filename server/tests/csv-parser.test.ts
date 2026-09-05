import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseCsvStream } from "../imports/csv-parser.js";
import { ApplicationError } from "../utils/errors.js";

test("CSV parser supports quoted commas, line breaks and escaped quotes", () => {
  const records = parseCsv(
    'external_id,name,notes\nP-1,"Шина, зимняя","Строка 1\nСтрока ""2"""',
    { requiredHeaders: ["external_id", "name"] },
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].lineNumber, 2);
  assert.equal(records[0].values.name, "Шина, зимняя");
  assert.equal(records[0].values.notes, 'Строка 1\nСтрока "2"');
});

test("CSV parser reports missing required headers", () => {
  assert.throws(
    () => parseCsv("sku,name\nSKU-1,Товар", { requiredHeaders: ["external_id"] }),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "MISSING_CSV_HEADERS",
  );
});

test("CSV parser enforces the batch row limit", () => {
  assert.throws(
    () => parseCsv("id\n1\n2", { maximumRows: 1 }),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "CSV_ROW_LIMIT_EXCEEDED",
  );
});

test("streaming CSV preserves escaped quotes and UTF-8 at every chunk boundary", async () => {
  const source = 'sku,name,notes\r\nS-1,"Шина, зимняя","Строка 1\nСтрока ""2"""\r\nS-2,Диск,Конец';
  const bytes = new TextEncoder().encode(source);
  for (let chunkSize = 1; chunkSize <= bytes.length; chunkSize += 1) {
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      },
    });
    const rows = [];
    for await (const row of parseCsvStream(stream)) rows.push(row);
    assert.deepEqual(rows.map((row) => row.values), parseCsv(source).map((row) => row.values));
  }
});

test("streaming CSV rejects truncated quoted fields and row overflow", async () => {
  for (const [source, code] of [['id\n"unfinished', 'INVALID_CSV'], ['id\n1\n2', 'CSV_ROW_LIMIT_EXCEEDED']]) {
    await assert.rejects(async () => {
      for await (const row of parseCsvStream(new Blob([source]).stream(), { maximumRows: 1 })) void row;
    }, (error: unknown) => error instanceof ApplicationError && error.code === code);
  }
});

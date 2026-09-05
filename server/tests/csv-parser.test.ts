import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../imports/csv-parser.js";
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

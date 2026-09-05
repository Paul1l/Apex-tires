import { ApplicationError } from "../utils/errors";

export interface CsvRecord {
  lineNumber: number;
  values: Record<string, string>;
}

function parseRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new ApplicationError({
      code: "INVALID_CSV",
      message: "В CSV обнаружено незакрытое поле в кавычках.",
      statusCode: 422,
    });
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function parseCsv(
  source: string,
  options: { maximumRows?: number; requiredHeaders?: string[] } = {},
): CsvRecord[] {
  const rows = parseRows(source.replace(/^\uFEFF/, ""));
  if (rows.length === 0) {
    throw new ApplicationError({
      code: "EMPTY_CSV",
      message: "CSV-файл пуст.",
      statusCode: 422,
    });
  }
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new ApplicationError({
      code: "INVALID_CSV_HEADERS",
      message: "Заголовки CSV должны быть заполнены и не повторяться.",
      statusCode: 422,
    });
  }
  const missingHeaders = (options.requiredHeaders ?? []).filter(
    (requiredHeader) => !headers.includes(requiredHeader),
  );
  if (missingHeaders.length > 0) {
    throw new ApplicationError({
      code: "MISSING_CSV_HEADERS",
      message: `В CSV отсутствуют обязательные столбцы: ${missingHeaders.join(", ")}.`,
      statusCode: 422,
    });
  }
  const dataRows = rows.slice(1).filter((values) => values.some((value) => value.trim()));
  if (dataRows.length > (options.maximumRows ?? 5_000)) {
    throw new ApplicationError({
      code: "CSV_ROW_LIMIT_EXCEEDED",
      message: `CSV содержит больше ${options.maximumRows ?? 5_000} строк.`,
      statusCode: 413,
    });
  }
  return dataRows.map((values, index) => ({
    lineNumber: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() ?? ""])),
  }));
}

export async function* parseCsvStream(
  stream: ReadableStream<Uint8Array>,
  options: {
    maximumRows?: number;
    maximumBytes?: number;
    requiredHeaders?: string[];
  } = {},
): AsyncGenerator<CsvRecord> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let headers: string[] | null = null;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let rowNumber = 1;
  let dataRows = 0;
  let receivedBytes = 0;
  let pendingQuote = false;

  const consumeRow = (values: string[]): CsvRecord | null => {
    if (!headers) {
      headers = values.map((header, index) =>
        (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim().toLowerCase(),
      );
      if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
        throw new ApplicationError({
          code: "INVALID_CSV_HEADERS",
          message: "Заголовки CSV должны быть заполнены и не повторяться.",
          statusCode: 422,
        });
      }
      const missingHeaders = (options.requiredHeaders ?? []).filter(
        (requiredHeader) => !headers?.includes(requiredHeader),
      );
      if (missingHeaders.length > 0) {
        throw new ApplicationError({
          code: "MISSING_CSV_HEADERS",
          message: `В CSV отсутствуют обязательные столбцы: ${missingHeaders.join(", ")}.`,
          statusCode: 422,
        });
      }
      return null;
    }
    if (!values.some((value) => value.trim())) return null;
    dataRows += 1;
    if (dataRows > (options.maximumRows ?? 300_000)) {
      throw new ApplicationError({
        code: "CSV_ROW_LIMIT_EXCEEDED",
        message: `CSV содержит больше ${options.maximumRows ?? 300_000} строк.`,
        statusCode: 413,
      });
    }
    return {
      lineNumber: rowNumber,
      values: Object.fromEntries(
        headers.map((header, column) => [header, values[column]?.trim() ?? ""]),
      ),
    };
  };

  const processText = function* (text: string): Generator<CsvRecord> {
    for (let index = 0; index < text.length; index += 1) {
      if (field.length > 100_000) throw new ApplicationError({code:"CSV_FIELD_TOO_LARGE",message:"Поле CSV превышает 100 000 символов.",statusCode:413});
      const character = text[index];
      if (pendingQuote) {
        pendingQuote = false;
        if (character === '"') {
          field += '"';
          continue;
        }
        quoted = false;
      }
      if (quoted) {
        if (character === '"') {
          pendingQuote = true;
        } else {
          field += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field.replace(/\r$/, ""));
        const currentRowNumber = rowNumber;
        rowNumber += 1;
        const record = consumeRow(row);
        row = [];
        field = "";
        if (record) yield { ...record, lineNumber: currentRowNumber };
      } else {
        field += character;
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > (options.maximumBytes ?? 200_000_000)) {
        throw new ApplicationError({
          code: "CSV_FILE_TOO_LARGE",
          message: "CSV-файл превышает установленный сервером лимит.",
          statusCode: 413,
        });
      }
      yield* processText(decoder.decode(value, { stream: true }));
    }
    yield* processText(decoder.decode());
    if (pendingQuote) quoted = false;
    if (quoted) {
      throw new ApplicationError({
        code: "INVALID_CSV",
        message: "В CSV обнаружено незакрытое поле в кавычках.",
        statusCode: 422,
      });
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field.replace(/\r$/, ""));
      const record = consumeRow(row);
      if (record) yield record;
    }
    if (!headers) {
      throw new ApplicationError({
        code: "EMPTY_CSV",
        message: "CSV-файл пуст.",
        statusCode: 422,
      });
    }
  } finally {
    reader.releaseLock();
  }
}

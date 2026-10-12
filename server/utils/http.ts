import { ApplicationError } from "./errors";

const DEFAULT_MAXIMUM_BODY_BYTES = 1_000_000;

function requestTooLarge(): ApplicationError {
  return new ApplicationError({
    code: "REQUEST_TOO_LARGE",
    message: "Размер запроса превышает допустимый лимит.",
    statusCode: 413,
  });
}

function invalidJson(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_JSON",
    message: "Тело запроса должно содержать корректный JSON.",
    statusCode: 400,
  });
}

/** `application/json`, optionally with parameters such as `charset=utf-8`. */
export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Reads the body as a stream and stops as soon as `maximumBytes` is exceeded,
 * so an oversized or endless chunked body is never buffered completely.
 */
export async function readRequestBodyWithLimit(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw requestTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonRequest(
  request: Request,
  maximumBodyBytes = DEFAULT_MAXIMUM_BODY_BYTES,
): Promise<unknown> {
  // Only real JSON requests are accepted: HTML forms (text/plain,
  // urlencoded, multipart) cannot produce this type without a CORS preflight.
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new ApplicationError({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Тело запроса должно быть в формате JSON (Content-Type: application/json).",
      statusCode: 415,
    });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximumBodyBytes) {
    throw requestTooLarge();
  }

  const body = await readRequestBodyWithLimit(request, maximumBodyBytes);
  let requestBody: string;
  try {
    // UTF-8 only (RFC 8259); a leading BOM is skipped as Request.text() did.
    requestBody = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw invalidJson();
  }

  try {
    return JSON.parse(requestBody) as unknown;
  } catch {
    throw invalidJson();
  }
}

import { ApplicationError } from "./errors";

const DEFAULT_MAXIMUM_BODY_BYTES = 1_000_000;

export async function readJsonRequest(
  request: Request,
  maximumBodyBytes = DEFAULT_MAXIMUM_BODY_BYTES,
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximumBodyBytes) {
    throw new ApplicationError({
      code: "REQUEST_TOO_LARGE",
      message: "Размер запроса превышает допустимый лимит.",
      statusCode: 413,
    });
  }

  const requestBody = await request.text();
  if (new TextEncoder().encode(requestBody).byteLength > maximumBodyBytes) {
    throw new ApplicationError({
      code: "REQUEST_TOO_LARGE",
      message: "Размер запроса превышает допустимый лимит.",
      statusCode: 413,
    });
  }

  try {
    return JSON.parse(requestBody) as unknown;
  } catch {
    throw new ApplicationError({
      code: "INVALID_JSON",
      message: "Тело запроса должно содержать корректный JSON.",
      statusCode: 400,
    });
  }
}

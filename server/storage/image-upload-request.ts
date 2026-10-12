import { ApplicationError } from "../utils/errors";
import { readRequestBodyWithLimit } from "../utils/http";
import { imageAltSchema } from "../validators/admin-product-schema";
import { detectImageType, STORED_IMAGE_TYPES, type StoredImageType } from "./image-signature";

/** Room for the multipart boundaries, headers and the alt field. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export interface ImageUpload {
  bytes: Uint8Array;
  type: StoredImageType;
  alt: string;
}

function formatMegabytes(bytes: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} МБ`;
}

function tooLarge(maximumBytes: number): ApplicationError {
  return new ApplicationError({
    code: "IMAGE_TOO_LARGE",
    message: `Файл больше допустимого размера (${formatMegabytes(maximumBytes)}). Уменьшите фото и загрузите снова.`,
    statusCode: 413,
  });
}

export function isMultipartRequest(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
}

/**
 * Reads one photo from multipart/form-data (fields `file` and optional `alt`).
 * The body is read with a byte limit before parsing; the type is detected
 * from the content only (JPEG, PNG, WebP). The file name and the MIME type
 * sent by the browser are ignored.
 */
export async function readImageUpload(request: Request, maximumBytes: number): Promise<ImageUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!isMultipartRequest(request)) {
    throw new ApplicationError({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Отправьте фото формой multipart/form-data с полем file.",
      statusCode: 415,
    });
  }
  const bodyLimit = maximumBytes + MULTIPART_OVERHEAD_BYTES;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > bodyLimit) throw tooLarge(maximumBytes);
  let body: Uint8Array;
  try {
    body = await readRequestBodyWithLimit(request, bodyLimit);
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "REQUEST_TOO_LARGE") throw tooLarge(maximumBytes);
    throw error;
  }
  let form: FormData;
  try {
    form = await new Response(new Blob([body as Uint8Array<ArrayBuffer>]), { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new ApplicationError({
      code: "INVALID_MULTIPART",
      message: "Не удалось прочитать форму с фото. Выберите файл и повторите загрузку.",
      statusCode: 422,
    });
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    throw new ApplicationError({ code: "IMAGE_REQUIRED", message: "Выберите файл фото.", statusCode: 422 });
  }
  if (file.size > maximumBytes) throw tooLarge(maximumBytes);
  const altValue = form.get("alt");
  const alt = imageAltSchema.safeParse(typeof altValue === "string" ? altValue : "");
  if (!alt.success) {
    throw new ApplicationError({
      code: "VALIDATION_ERROR",
      message: alt.error.issues[0]?.message ?? "Проверьте подпись к фото.",
      statusCode: 422,
    });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) {
    throw new ApplicationError({
      code: "UNSUPPORTED_IMAGE_TYPE",
      message: `Поддерживаются только фото ${Object.values(STORED_IMAGE_TYPES).map((item) => item.label).join(", ")}. Файл не распознан как изображение этих форматов.`,
      statusCode: 415,
    });
  }
  return { bytes, type, alt: alt.data };
}

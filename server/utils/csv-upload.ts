import { ApplicationError } from "./errors";

const MAXIMUM_CSV_BYTES = 200_000_000;
const MAXIMUM_MULTIPART_BYTES = 10_000_000;

function readFilename(header: string | null): string {
  try { return decodeURIComponent(header || "import.csv").slice(0, 240); }
  catch { throw new ApplicationError({ code: "INVALID_FILENAME", message: "Некорректное имя CSV-файла.", statusCode: 422 }); }
}

export async function readCsvUpload(request: Request): Promise<{
  stream: ReadableStream<Uint8Array>;
  filename: string;
  mode: "full" | "incremental";
}> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAXIMUM_CSV_BYTES) {
    throw new ApplicationError({
      code: "CSV_FILE_TOO_LARGE",
      message: "CSV-файл не должен превышать 200 МБ.",
      statusCode: 413,
    });
  }
  const originalContentType = request.headers.get("content-type") ?? "";
  const contentType = originalContentType.toLowerCase();
  if (contentType.startsWith("text/csv") || contentType.startsWith("application/csv")) {
    if (!request.body) {
      throw new ApplicationError({ code: "CSV_FILE_REQUIRED", message: "CSV-файл пуст.", statusCode: 422 });
    }
    return {
      stream: request.body,
      filename: readFilename(request.headers.get("x-file-name")),
      mode: request.headers.get("x-import-mode") === "full" ? "full" : "incremental",
    };
  }
  if (contentLength > MAXIMUM_MULTIPART_BYTES) {
    throw new ApplicationError({
      code: "CSV_MULTIPART_TOO_LARGE",
      message: "Для файлов больше 10 МБ используйте потоковую загрузку text/csv.",
      statusCode: 413,
    });
  }
  if (!request.body) throw new ApplicationError({ code: "CSV_FILE_REQUIRED", message: "Выберите CSV-файл.", statusCode: 422 });
  // Count multipart bytes before parsing; Content-Length may be absent or forged.
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAXIMUM_MULTIPART_BYTES) {
        await reader.cancel();
        throw new ApplicationError({ code: "CSV_MULTIPART_TOO_LARGE", message: "Multipart-файл превышает 10 МБ.", statusCode: 413 });
      }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  const formData = await new Response(new Blob(chunks), { headers: { "Content-Type": originalContentType } }).formData();
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name.toLocaleLowerCase("ru").endsWith(".csv")) {
    throw new ApplicationError({
      code: "CSV_FILE_REQUIRED",
      message: "Выберите CSV-файл.",
      statusCode: 422,
    });
  }
  if (file.size > MAXIMUM_MULTIPART_BYTES) {
    throw new ApplicationError({
      code: "CSV_FILE_TOO_LARGE",
      message: "Multipart CSV-файл не должен превышать 10 МБ.",
      statusCode: 413,
    });
  }
  const modeValue = formData.get("mode");
  return {
    stream: file.stream(),
    filename: file.name,
    mode: modeValue === "full" ? "full" : "incremental",
  };
}

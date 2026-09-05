import { ApplicationError } from "./errors";

const MAXIMUM_CSV_BYTES = 5_000_000;

export async function readCsvUpload(request: Request): Promise<{
  csv: string;
  mode: "full" | "incremental";
}> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAXIMUM_CSV_BYTES + 100_000) {
    throw new ApplicationError({
      code: "CSV_FILE_TOO_LARGE",
      message: "CSV-файл не должен превышать 5 МБ.",
      statusCode: 413,
    });
  }
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name.toLocaleLowerCase("ru").endsWith(".csv")) {
    throw new ApplicationError({
      code: "CSV_FILE_REQUIRED",
      message: "Выберите CSV-файл.",
      statusCode: 422,
    });
  }
  if (file.size > MAXIMUM_CSV_BYTES) {
    throw new ApplicationError({
      code: "CSV_FILE_TOO_LARGE",
      message: "CSV-файл не должен превышать 5 МБ.",
      statusCode: 413,
    });
  }
  const modeValue = formData.get("mode");
  return {
    csv: await file.text(),
    mode: modeValue === "full" ? "full" : "incremental",
  };
}

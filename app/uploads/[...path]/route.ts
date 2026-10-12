import { readUploadEnvironment } from "@/server/config/environment";
import { createImageStorage } from "@/server/storage/image-storage";
import { parseUploadSegments } from "@/server/storage/upload-path";
import { applicationLogger } from "@/server/types/common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Product photos uploaded in the admin: /uploads/products/<uuid>/<32 hex>.<jpg|png|webp>.
 * Only that exact shape is served (no "..", encoded separators, NUL, other
 * folders or extensions); the real path must stay inside UPLOADS_DIR and the
 * Content-Type is fixed by the extension, never sniffed. Without UPLOADS_DIR
 * every request is 404. File names are random and never reused, so the
 * answer is cached for a year.
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const environment = readUploadEnvironment();
  if (!environment.uploadsDirectory) return notFound();
  const segments = (await context.params).path;
  const key = Array.isArray(segments) ? parseUploadSegments(segments) : null;
  if (!key) return notFound();
  try {
    const storage = await createImageStorage(environment);
    const file = storage ? await storage.read(key.storageKey) : null;
    if (!file) return notFound();
    return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    applicationLogger.error({ error }, "Uploaded file could not be read");
    return notFound();
  }
}

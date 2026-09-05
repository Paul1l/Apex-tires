import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { createPostgresPool } from "../database/postgres-client";
import { readEnvironment } from "../config/environment";
import { ProductRepository } from "../repositories/product-repository";
import { AdminAuditRepository } from "../repositories/admin-audit-repository";
import { CatalogImportService } from "../services/catalog-import-service";
import path from "node:path";

async function main() {
  const [kind,filename,mode="incremental",confirmation] = process.argv.slice(2);
  if (!["products","fitments"].includes(kind) || !filename || (mode !== "incremental" && mode !== "full")) throw new Error("Usage: pnpm import:csv products|fitments file.csv [incremental|full] [--confirm-full]");
  if (mode === "full" && confirmation !== "--confirm-full") throw new Error("Full sync requires --confirm-full; missing CSV products will be deactivated.");
  const pool=createPostgresPool(readEnvironment());
  try {
    const service=new CatalogImportService(pool,new ProductRepository(),new AdminAuditRepository());
    const stream=Readable.toWeb(createReadStream(filename)) as ReadableStream<Uint8Array>;
    const report=kind === "products" ? await service.importProductsCsvStream(stream,path.basename(filename),mode)
      : await service.importFitmentsCsvStream(stream,path.basename(filename));
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
    if (!report.ok) process.exitCode=1;
  } finally { await pool.end(); }
}
main().catch((error:unknown)=>{console.error(error instanceof Error ? error.message : "Import failed");process.exitCode=1;});

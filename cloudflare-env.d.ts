interface CloudflareEnv {
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
  DB?: D1Database;
  ONEC_SHARED_SECRET?: string;
  YANDEX_METRIKA_COUNTER_ID?: string;
}

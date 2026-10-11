import {
  formatVehicleMakeName,
  getSupplementalModelsForMake,
  getSupplementalVehicleMakes,
  normalizeVehicleMakeName,
  sortVehicleMakes,
  sortVehicleModels,
  type VehicleMake,
  type VehicleModel,
} from "../../lib/vehicle-catalog";
import type { ApplicationLogger } from "../types/common";

/**
 * Vehicle reference for the preview catalog: the public vPIC catalog (NHTSA)
 * merged with the regional list, cached in memory so that a visitor never
 * waits for the external service when a fresh copy exists. When vPIC fails or
 * is slow, the last vPIC copy (even expired) or the regional list is returned
 * quickly and kept for a short time. The database catalog does not use this
 * service: it reads the fitment tables.
 */

export const VPIC_API_ORIGIN = "https://vpic.nhtsa.dot.gov/api/vehicles";
export const VPIC_TIMEOUT_MILLISECONDS = 3_000;
export const VEHICLE_MAKES_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;
export const VEHICLE_MODELS_TTL_MILLISECONDS = 6 * 60 * 60 * 1_000;
/** How long a fallback answer is reused before vPIC is asked again. */
export const VEHICLE_FALLBACK_TTL_MILLISECONDS = 10 * 60 * 1_000;
/** Distinct make/year combinations kept in memory (least recently used go first). */
export const VEHICLE_MODELS_CACHE_ENTRIES = 500;

const PASSENGER_VEHICLE_TYPES = [
  "Passenger%20Car",
  "Multipurpose%20Passenger%20Vehicle%20(MPV)",
  "Truck",
];
/** vPIC has reliable model-year data from 1995; older years use all models of the make. */
const FIRST_VPIC_MODEL_YEAR = 1995;

export type VehicleReferenceSource = "vpic" | "vpic+regional" | "regional-fallback";
/**
 * hit: fresh vPIC copy from memory; miss: loaded from vPIC now; stale: vPIC
 * failed recently, an older vPIC copy or the regional list is served.
 */
export type VehicleCacheStatus = "hit" | "miss" | "stale";

export interface VehicleReferenceList<Item> {
  source: VehicleReferenceSource;
  items: Item[];
}

export interface VehicleReferenceResult<Item> extends VehicleReferenceList<Item> {
  cache: VehicleCacheStatus;
}

interface CachedReferenceList<Item> extends VehicleReferenceList<Item> {
  /** Stored after a vPIC failure: reused briefly, then vPIC is asked again. */
  degraded: boolean;
}

/** Cache-Control for reference answers (browser `max-age`, shared caches `s-maxage`). */
export const VEHICLE_CACHE_CONTROL = {
  makes: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  models: "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400",
  fallback: "public, max-age=300, s-maxage=600, stale-while-revalidate=3600",
  /** Fitment tables change only with imports; catalog pages also lag up to 5 minutes. */
  database: "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
  error: "no-store",
} as const;

/** Cache-Control for a preview reference answer. */
export function vehicleReferenceCacheControl(
  list: "makes" | "models",
  result: Pick<VehicleReferenceResult<unknown>, "cache">,
): string {
  return result.cache === "stale" ? VEHICLE_CACHE_CONTROL.fallback : VEHICLE_CACHE_CONTROL[list];
}

interface CacheEntry<Value> {
  value: Value;
  expiresAt: number;
}

/** Map-based cache with per-entry TTL and a least-recently-used size limit. */
export class BoundedTtlCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();

  constructor(
    private readonly maximumEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** The entry and whether it is still fresh; expired entries stay until evicted. */
  get(key: string): { value: Value; fresh: boolean } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: entry.value, fresh: entry.expiresAt > this.now() };
  }

  set(key: string, value: Value, ttlMilliseconds: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMilliseconds });
    while (this.entries.size > this.maximumEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

interface VpicMake {
  MakeId: number;
  MakeName: string;
}

interface VpicModel {
  Make_ID: number;
  Make_Name: string;
  Model_ID: number;
  Model_Name: string;
}

interface VpicResponse<Item> {
  Results?: Item[];
}

export interface VehicleReferenceServiceOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMilliseconds?: number;
  maximumModelEntries?: number;
  logger?: Pick<ApplicationLogger, "warn">;
}

function mergeVehicleModels(
  firstModels: VehicleModel[],
  secondModels: VehicleModel[],
): VehicleModel[] {
  const uniqueModels = new Map<string, VehicleModel>();
  for (const model of [...firstModels, ...secondModels]) {
    uniqueModels.set(model.name.trim().toLocaleLowerCase("ru"), model);
  }
  return sortVehicleModels(Array.from(uniqueModels.values()));
}

export class VehicleReferenceService {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMilliseconds: number;
  private readonly logger?: Pick<ApplicationLogger, "warn">;
  private readonly makes: BoundedTtlCache<CachedReferenceList<VehicleMake>>;
  private readonly models: BoundedTtlCache<CachedReferenceList<VehicleModel>>;
  private readonly pending = new Map<string, Promise<VehicleReferenceResult<unknown>>>();

  constructor(options: VehicleReferenceServiceOptions = {}) {
    // Resolved per call: Next.js instruments the global fetch.
    this.fetchImplementation = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? VPIC_TIMEOUT_MILLISECONDS;
    this.logger = options.logger;
    this.makes = new BoundedTtlCache(1, options.now);
    this.models = new BoundedTtlCache(
      options.maximumModelEntries ?? VEHICLE_MODELS_CACHE_ENTRIES,
      options.now,
    );
  }

  getMakes(): Promise<VehicleReferenceResult<VehicleMake>> {
    return this.cached(
      this.makes,
      "makes",
      VEHICLE_MAKES_TTL_MILLISECONDS,
      () => this.loadMakes(),
      () => ({ source: "regional-fallback", items: sortVehicleMakes(getSupplementalVehicleMakes()) }),
    );
  }

  /** Without a year (or before 1995) all models of the make are listed. */
  getModels(makeName: string, year?: number): Promise<VehicleReferenceResult<VehicleModel>> {
    const normalizedMakeName = normalizeVehicleMakeName(makeName);
    const modelYear = year !== undefined && year >= FIRST_VPIC_MODEL_YEAR ? year : null;
    return this.cached(
      this.models,
      `models:${normalizedMakeName}:${modelYear ?? "all"}`,
      VEHICLE_MODELS_TTL_MILLISECONDS,
      () => this.loadModels(normalizedMakeName, modelYear),
      () => ({
        source: "regional-fallback",
        items: sortVehicleModels(getSupplementalModelsForMake(normalizedMakeName)),
      }),
    );
  }

  private cached<Item>(
    cache: BoundedTtlCache<CachedReferenceList<Item>>,
    key: string,
    ttlMilliseconds: number,
    load: () => Promise<VehicleReferenceList<Item>>,
    fallback: () => VehicleReferenceList<Item>,
  ): Promise<VehicleReferenceResult<Item>> {
    const entry = cache.get(key);
    if (entry?.fresh) {
      const { source, items, degraded } = entry.value;
      return Promise.resolve({ source, items, cache: degraded ? "stale" : "hit" });
    }
    // Concurrent requests for the same list share one vPIC request.
    const inFlight = this.pending.get(key) as Promise<VehicleReferenceResult<Item>> | undefined;
    if (inFlight) return inFlight;

    const request = load()
      .then(({ source, items }): VehicleReferenceResult<Item> => {
        cache.set(key, { source, items, degraded: false }, ttlMilliseconds);
        return { source, items, cache: "miss" };
      })
      .catch((error: unknown): VehicleReferenceResult<Item> => {
        this.logger?.warn({ error, list: key }, "vPIC vehicle reference unavailable; serving cached or regional list");
        const { source, items } = entry?.value ?? fallback();
        cache.set(key, { source, items, degraded: true }, VEHICLE_FALLBACK_TTL_MILLISECONDS);
        return { source, items, cache: "stale" };
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async fetchVpic<Item>(path: string): Promise<Item[]> {
    // The timeout covers the whole exchange, body included.
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("vPIC request timed out")),
      this.timeoutMilliseconds,
    );
    try {
      const response = await this.fetchImplementation(`${VPIC_API_ORIGIN}/${path}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`vPIC request returned HTTP ${response.status}`);
      const payload = (await response.json()) as VpicResponse<Item>;
      return Array.isArray(payload.Results) ? payload.Results : [];
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadMakes(): Promise<VehicleReferenceList<VehicleMake>> {
    const remoteGroups = await Promise.all(
      PASSENGER_VEHICLE_TYPES.map((vehicleType) =>
        this.fetchVpic<VpicMake>(`GetMakesForVehicleType/${vehicleType}?format=json`),
      ),
    );
    const uniqueMakes = new Map<string, VehicleMake>();
    for (const make of getSupplementalVehicleMakes()) {
      uniqueMakes.set(normalizeVehicleMakeName(make.name), make);
    }
    for (const remoteMake of remoteGroups.flat()) {
      if (typeof remoteMake.MakeName !== "string" || !remoteMake.MakeName.trim()) continue;
      uniqueMakes.set(normalizeVehicleMakeName(remoteMake.MakeName), {
        id: String(remoteMake.MakeId),
        name: formatVehicleMakeName(remoteMake.MakeName),
      });
    }
    return { source: "vpic+regional", items: sortVehicleMakes(Array.from(uniqueMakes.values())) };
  }

  private async loadModels(
    normalizedMakeName: string,
    modelYear: number | null,
  ): Promise<VehicleReferenceList<VehicleModel>> {
    const encodedMakeName = encodeURIComponent(normalizedMakeName);
    const remoteResults = await this.fetchVpic<VpicModel>(
      modelYear === null
        ? `GetModelsForMake/${encodedMakeName}?format=json`
        : `GetModelsForMakeYear/make/${encodedMakeName}/modelyear/${modelYear}?format=json`,
    );
    const remoteModels = remoteResults
      .filter(
        (model) =>
          typeof model.Make_Name === "string" &&
          typeof model.Model_Name === "string" &&
          normalizeVehicleMakeName(model.Make_Name) === normalizedMakeName,
      )
      .map((model) => ({ id: String(model.Model_ID), name: model.Model_Name.trim() }))
      .filter((model) => model.name);
    const supplementalModels = getSupplementalModelsForMake(normalizedMakeName);
    if (remoteModels.length === 0) {
      return { source: "regional-fallback", items: sortVehicleModels(supplementalModels) };
    }
    return {
      source: supplementalModels.length > 0 ? "vpic+regional" : "vpic",
      items: mergeVehicleModels(supplementalModels, remoteModels),
    };
  }
}

declare global {
  var apexVehicleReferenceService: VehicleReferenceService | undefined;
}

/** Process-wide instance shared by the route handlers. */
export function getVehicleReferenceService(
  logger?: Pick<ApplicationLogger, "warn">,
): VehicleReferenceService {
  globalThis.apexVehicleReferenceService ??= new VehicleReferenceService({ logger });
  return globalThis.apexVehicleReferenceService;
}

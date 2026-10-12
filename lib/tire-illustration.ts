import type { Product } from "./types";

/**
 * Deterministic SVG illustrations for tires that have no product photo.
 *
 * The generator is a pure function (no React, no DOM, no randomness, no
 * clock): identical input always yields a byte-identical SVG string, so it is
 * safe to call during SSR and again during hydration. Everything that comes
 * from the product is sanitized and XML-escaped; the output never contains
 * scripts, event handlers, external references or embedded raster images.
 *
 * Geometry: a tire standing upright, turned ~44° around the vertical axis, so
 * the sidewall reads as an ellipse on the left and the tread band is visible
 * on the right. The tread is built from one "pitch" tile that is placed around
 * the crown with per-pitch affine transforms (tangent-plane projection), which
 * keeps the SVG small while giving correct foreshortening towards the top and
 * bottom of the tire.
 */

export type TireIllustrationInput = Pick<
  Product,
  "brand" | "model" | "season" | "studded" | "runflat" | "width" | "profile" | "diameter"
> &
  Partial<Pick<Product, "xl" | "tags">>;

export type TreadFamily = "summer" | "winter" | "all-season" | "all-terrain";

export type TreadVariant =
  | "asymmetric"
  | "rib"
  | "directional"
  | "nordic"
  | "lamella"
  | "v-hybrid"
  | "block";

export interface TireIllustrationSpec {
  family: TreadFamily;
  variant: TreadVariant;
  /** Stable 32-bit hash of the normalized brand + model. */
  seed: number;
  /** Tread pitches around the full circumference. */
  pitchCount: number;
  /** Circumferential grooves across the tread. */
  grooveCount: number;
  /** Groove width in tread units. */
  grooveWidth: number;
  /** Main lateral groove angle in degrees. */
  grooveAngle: number;
  /** Sipes (lamellas) per block, 0 when the pattern has none. */
  sipeDensity: number;
  /** Width of the shoulder rib as a share of the half tread width. */
  shoulderRibRatio: number;
  studded: boolean;
  /** Studs per pitch (0 unless studded). */
  studsPerPitch: number;
  xl: boolean;
  runflat: boolean;
}

const MAX_TEXT_LENGTH = 60;
const MAX_TAGS = 24;
const VIEW = 400;
const RADIUS = 146;
const CENTER_Y = 192;
const YAW_SIN = -Math.sin((44 * Math.PI) / 180);
const YAW_COS = Math.cos((44 * Math.PI) / 180);
const FONT = "Arial,Helvetica,sans-serif";

/* ------------------------------------------------------------------------ */
/* Text sanitizing                                                          */
/* ------------------------------------------------------------------------ */

const UNSAFE_CHARACTERS =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{FDD0}-\u{FDEF}\u{FFFE}\u{FFFF}\u{20E3}]/gu;

/** Removes control/format/emoji characters, collapses whitespace and limits length. */
export function sanitizeIllustrationText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .normalize("NFC")
    .replace(UNSAFE_CHARACTERS, "")
    .replace(/[\s\p{Z}]+/gu, " ")
    .trim();
  return Array.from(cleaned).slice(0, maxLength).join("").trim();
}

/** Escapes text for XML text nodes and double- or single-quoted attributes. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* ------------------------------------------------------------------------ */
/* Deterministic helpers                                                    */
/* ------------------------------------------------------------------------ */

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability: number) => next() < probability,
  };
}

type Random = ReturnType<typeof createRandom>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Compact number formatting: one decimal, no leading zero, no "-0". */
function n(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0";
  const text = String(rounded);
  if (text.startsWith("0.")) return text.slice(1);
  if (text.startsWith("-0.")) return `-${text.slice(2)}`;
  return text;
}

/** Three-decimal formatting for transform matrices. */
function m(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded === 0) return "0";
  const text = String(rounded);
  if (text.startsWith("0.")) return text.slice(1);
  if (text.startsWith("-0.")) return `-${text.slice(2)}`;
  return text;
}

/** Coordinate pair; the separator is dropped before a minus sign. */
function pair(x: number, y: number): string {
  const second = n(y);
  return `${n(x)}${second.startsWith("-") ? "" : " "}${second}`;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatDimension(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

/** «225/45 R18» or a shorter form when some numbers are missing. */
export function formatTireSize(input: Pick<TireIllustrationInput, "width" | "profile" | "diameter">): string {
  const width = finiteNumber(input.width, 0);
  const profile = finiteNumber(input.profile, 0);
  const diameter = finiteNumber(input.diameter, 0);
  if (width > 999 || profile > 999 || diameter > 99) return "";
  const head = width ? (profile ? `${formatDimension(width)}/${formatDimension(profile)}` : formatDimension(width)) : "";
  const tail = diameter ? `R${formatDimension(diameter)}` : "";
  return [head, tail].filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------------ */
/* Classification                                                           */
/* ------------------------------------------------------------------------ */

const OFF_ROAD_TOKEN =
  /(^|[^\p{L}\p{N}])(a\/t|at|at2|at3|all[\s-]*terrain|m\/t|mt|mud[\s-]*terrain|r\/t|x\/t|off[\s-]*road|внедорожн\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const ON_ROAD_SUV_TOKEN = /(^|[^\p{L}\p{N}])(h\/t|ht|cv|x-cv|suv|sport)(?=$|[^\p{L}\p{N}])/iu;

interface NormalizedInput {
  brand: string;
  model: string;
  size: string;
  season: TireIllustrationInput["season"];
  studded: boolean;
  runflat: boolean;
  xl: boolean;
  tags: string[];
  width: number;
  profile: number;
  diameter: number;
}

function normalizeInput(input: TireIllustrationInput): NormalizedInput {
  const tags = (Array.isArray(input.tags) ? input.tags : [])
    .slice(0, MAX_TAGS)
    .map((tag) => sanitizeIllustrationText(tag, 40))
    .filter(Boolean);
  const season = (["summer", "winter", "all-season", "none"] as const).includes(input.season)
    ? input.season
    : "none";
  return {
    brand: sanitizeIllustrationText(input.brand),
    model: sanitizeIllustrationText(input.model),
    size: formatTireSize(input),
    season,
    studded: input.studded === true,
    runflat: input.runflat === true || tags.some((tag) => /^run\s*-?flat$/i.test(tag)),
    xl: input.xl === true || tags.some((tag) => /^xl$/i.test(tag)),
    tags,
    width: clamp(finiteNumber(input.width, 205), 125, 405),
    profile: clamp(finiteNumber(input.profile, 60), 25, 95),
    diameter: clamp(finiteNumber(input.diameter, 16), 10, 26),
  };
}

function isOffRoad(model: string, tags: string[]): boolean {
  const haystacks = [model, ...tags];
  if (haystacks.some((value) => OFF_ROAD_TOKEN.test(value))) return true;
  return /geolandar/i.test(model) && !ON_ROAD_SUV_TOKEN.test(model);
}

function seedFor(brand: string, model: string): number {
  return hashString(`${brand.toLowerCase()}\u0000${model.toLowerCase()}`);
}

function familyFor(value: NormalizedInput): TreadFamily {
  if (isOffRoad(value.model, value.tags)) return "all-terrain";
  if (value.season === "winter") return "winter";
  if (value.season === "all-season") return "all-season";
  return "summer";
}

/* ------------------------------------------------------------------------ */
/* Tread pattern                                                            */
/* ------------------------------------------------------------------------ */

type Point = [number, number];

/**
 * Builds one pitch tile in tread coordinates: x is the lateral position
 * (-hw…hw, +x towards the visible sidewall), y is the arc length along the
 * circumference (-P/2…P/2). Elements that cross the tile boundary are repeated
 * with a period of P; the tile is clipped to its window when placed.
 */
class PitchTile {
  readonly grooves: string[] = [];
  readonly sipes: string[] = [];
  readonly edges: string[] = [];
  readonly studs: Point[] = [];

  constructor(
    readonly halfWidth: number,
    readonly pitch: number,
  ) {}

  private copies(points: Point[]): Point[][] {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    // Only copies that overlap the clip window (±P/2 plus the seam overlap).
    const limit = this.pitch / 2 + 0.4;
    const first = Math.floor((-limit - maxY) / this.pitch) + 1;
    const last = Math.ceil((limit - minY) / this.pitch) - 1;
    const result: Point[][] = [];
    for (let k = first; k <= last; k += 1) {
      result.push(points.map(([x, y]) => [x, y + k * this.pitch]));
    }
    return result;
  }

  private static path(points: Point[], close: boolean): string {
    return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${pair(x, y)}`).join("") + (close ? "Z" : "");
  }

  polygon(points: Point[], periodic = true) {
    for (const copy of periodic ? this.copies(points) : [points]) this.grooves.push(PitchTile.path(copy, true));
  }

  /** A groove of the given width along a polyline, optionally with a lit edge. */
  strip(points: Point[], width: number, litEdge: -1 | 0 | 1 = -1, periodic = true) {
    const left: Point[] = [];
    const right: Point[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const dx = next[0] - previous[0];
      const dy = next[1] - previous[1];
      const length = Math.hypot(dx, dy) || 1;
      let nx = -dy / length;
      let ny = dx / length;
      if (index > 0 && index < points.length - 1) {
        // Miter join, limited so sharp zigzags do not spike.
        const ax = points[index][0] - previous[0];
        const ay = points[index][1] - previous[1];
        const al = Math.hypot(ax, ay) || 1;
        const cos = Math.abs((-ay / al) * nx + (ax / al) * ny);
        const scale = 1 / Math.max(0.55, cos);
        nx *= scale;
        ny *= scale;
      }
      const [x, y] = points[index];
      left.push([x + (nx * width) / 2, y + (ny * width) / 2]);
      right.push([x - (nx * width) / 2, y - (ny * width) / 2]);
    }
    this.polygon([...left, ...[...right].reverse()], periodic);
    if (litEdge !== 0) this.edge(litEdge > 0 ? left : right, periodic);
  }

  edge(points: Point[], periodic = true) {
    for (const copy of periodic ? this.copies(points) : [points]) this.edges.push(PitchTile.path(copy, false));
  }

  sipe(points: Point[]) {
    for (const copy of this.copies(points)) this.sipes.push(PitchTile.path(copy, false));
  }

  /** Zigzag sipe between two points. */
  zigzagSipe(from: Point, to: Point, amplitude: number, step = 2.6) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    const segments = Math.max(2, Math.round(length / step));
    const nx = -dy / (length || 1);
    const ny = dx / (length || 1);
    const points: Point[] = [];
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const offset = index === 0 || index === segments ? 0 : index % 2 === 0 ? amplitude : -amplitude;
      points.push([from[0] + dx * t + nx * offset, from[1] + dy * t + ny * offset]);
    }
    this.sipe(points);
  }

  /** Straight circumferential groove at lateral position x (covers the whole tile). */
  circumferential(x: number, width: number) {
    const y = this.pitch / 2 + 0.6;
    this.polygon(
      [
        [x - width / 2, -y],
        [x + width / 2, -y],
        [x + width / 2, y],
        [x - width / 2, y],
      ],
      false,
    );
    this.edges.push(`M${pair(x - width / 2, -y)}V${n(y)}`);
  }

  /** Zigzag circumferential groove (continuous across tiles). */
  zigzagCircumferential(x: number, amplitude: number, width: number) {
    const half = this.pitch / 2;
    this.strip(
      [
        [x + amplitude, -half - this.pitch / 2],
        [x - amplitude, -half],
        [x + amplitude, 0],
        [x - amplitude, half],
        [x + amplitude, half + this.pitch / 2],
      ],
      width,
      -1,
      false,
    );
  }

  stud(x: number, y: number) {
    this.studs.push([x, y]);
  }
}

type TreadSpec = Omit<TireIllustrationSpec, "seed" | "xl" | "runflat" | "family" | "studded">;

function chevron(halfWidth: number, startGap: number, angle: number, bend: number, side: 1 | -1, offset: number): Point[] {
  const tan = Math.tan((angle * Math.PI) / 180);
  const tanOuter = Math.tan(((angle * bend) * Math.PI) / 180);
  const middle = startGap + (halfWidth - startGap) * 0.55;
  const midY = offset + (middle - startGap) * tan;
  return [
    [side * startGap, offset],
    [side * middle, midY],
    [side * (halfWidth + 3), midY + (halfWidth + 3 - middle) * tanOuter],
  ];
}

function placeStuds(tile: PitchTile, random: Random, count: number) {
  const lanes = [0.84, -0.84, 0.52, -0.52, 0.2, -0.2];
  // Deterministic shuffle so each model gets its own stud rows.
  for (let index = lanes.length - 1; index > 0; index -= 1) {
    const swap = random.int(0, index);
    [lanes[index], lanes[swap]] = [lanes[swap], lanes[index]];
  }
  for (let index = 0; index < count; index += 1) {
    const y = ((index + 0.5) / count - 0.5) * tile.pitch * 0.92;
    tile.stud(lanes[index] * tile.halfWidth * 0.94, y);
  }
}

function buildSummer(tile: PitchTile, random: Random, forceAsymmetric: boolean): TreadSpec {
  const hw = tile.halfWidth;
  const P = tile.pitch;
  const roll = random.next();
  const variant: TreadVariant = forceAsymmetric || roll < 0.4 ? "asymmetric" : roll < 0.7 ? "rib" : "directional";
  let grooveCount: number;
  let grooveWidth: number;
  let grooveAngle: number;
  let shoulderRibRatio: number;
  let sipeDensity = 0;

  if (variant === "asymmetric") {
    // Sport asymmetric: massive outer shoulder blocks, busy inner half.
    grooveCount = 3;
    grooveWidth = random.range(4.4, 6.2);
    const outer = (1 - 2 * random.range(0.24, 0.34)) * hw;
    const inner = -random.range(0.38, 0.56) * hw;
    const middle = (outer + inner) / 2 + random.range(-0.06, 0.06) * hw;
    const positions = [inner, middle, outer];
    const widths = [grooveWidth * 0.8, grooveWidth, grooveWidth * 1.15];
    positions.forEach((x, index) => tile.circumferential(x, widths[index]));
    shoulderRibRatio = (hw - outer - widths[2] / 2) / hw;
    grooveAngle = random.range(-10, 22);
    const tanOuter = Math.tan((grooveAngle * Math.PI) / 180);
    const outerEdge = outer + widths[2] / 2;
    const bend = random.range(-6, 6);
    tile.strip(
      [
        [hw + 3, 0],
        [(hw + outerEdge) / 2, ((outerEdge - hw) / 2 - 3) * tanOuter],
        [outerEdge - 1, (outerEdge - hw - 3) * tanOuter + bend],
      ],
      random.range(3, 4.2),
    );
    if (random.chance(0.5)) {
      tile.strip(
        [
          [hw + 3, P / 2],
          [hw - (hw - outerEdge) * 0.45, P / 2 - (hw - outerEdge) * 0.45 * tanOuter],
        ],
        2,
      );
    }
    const ribAngle = random.range(25, 55);
    const tanRib = Math.tan((ribAngle * Math.PI) / 180);
    // Outer middle rib: notches from the outer groove.
    const ribFrom = middle + widths[1] / 2;
    const ribTo = outer - widths[2] / 2;
    const reach = random.range(0.4, 0.65);
    tile.strip(
      [
        [ribTo + 1, -P / 4],
        [ribTo - (ribTo - ribFrom) * reach, -P / 4 - (ribTo - ribFrom) * reach * tanRib],
      ],
      2.2,
    );
    // Inner middle rib: full slanted grooves in the opposite direction.
    const innerFrom = inner + widths[0] / 2;
    const innerTo = middle - widths[1] / 2;
    tile.strip(
      [
        [innerFrom - 1, P / 4],
        [innerTo + 1, P / 4 - (innerTo - innerFrom + 2) * tanRib],
      ],
      2.4,
    );
    // Inner shoulder: dense narrow slots.
    const innerAngle = random.range(-25, 25);
    const tanInner = Math.tan((innerAngle * Math.PI) / 180);
    const innerEdge = inner - widths[0] / 2;
    const open = random.chance(0.5);
    for (let index = 0; index < 2; index += 1) {
      const y = (index * P) / 2;
      const endX = open ? innerEdge + 1 : innerEdge - (innerEdge + hw) * 0.3;
      tile.strip(
        [
          [-hw - 3, y],
          [endX, y + (endX + hw + 3) * tanInner],
        ],
        random.range(1.7, 2.3),
      );
    }
  } else if (variant === "rib") {
    // Touring: four narrow grooves, sipes across every rib.
    grooveCount = 4;
    grooveWidth = random.range(3, 4.2);
    const spread = random.range(0.6, 0.72);
    const positions: number[] = [];
    for (let index = 0; index < grooveCount; index += 1) {
      positions.push((-spread + (2 * spread * index) / (grooveCount - 1) + random.range(-0.04, 0.04)) * hw);
    }
    positions.forEach((x) => tile.circumferential(x, grooveWidth));
    shoulderRibRatio = (hw - positions[3] - grooveWidth / 2) / hw;
    grooveAngle = random.range(10, 45);
    sipeDensity = random.int(1, 2);
    const edges = [-hw - 3, ...positions, hw + 3];
    for (let column = 0; column < edges.length - 1; column += 1) {
      const from = edges[column] + (column === 0 ? 0 : grooveWidth / 2 - 0.5);
      const to = edges[column + 1] - (column === edges.length - 2 ? 0 : grooveWidth / 2 - 0.5);
      const direction = column % 2 === 0 ? 1 : -1;
      const tan = Math.tan((grooveAngle * direction * Math.PI) / 180);
      const shoulderColumn = column === 0 || column === edges.length - 2;
      if (shoulderColumn) {
        const outerX = column === 0 ? from : to;
        const innerX = column === 0 ? to - (to - from) * 0.3 : from + (to - from) * 0.3;
        tile.strip(
          [
            [outerX, 0],
            [innerX, (innerX - outerX) * tan * 0.4],
          ],
          random.range(2, 2.6),
        );
      }
      for (let index = 0; index < sipeDensity; index += 1) {
        const y = ((index + 1) * P) / (sipeDensity + 1) - (shoulderColumn ? 0 : P / 2);
        tile.sipe([
          [from, y - ((to - from) / 2) * tan],
          [to, y + ((to - from) / 2) * tan],
        ]);
      }
    }
  } else {
    grooveCount = random.int(2, 3);
    grooveWidth = random.range(3.6, 5.4);
    const outer = random.range(0.42, 0.62) * hw;
    const positions = grooveCount === 3 ? [-outer, 0, outer] : [-outer, outer];
    positions.forEach((x) => tile.circumferential(x, grooveWidth));
    shoulderRibRatio = (hw - outer - grooveWidth / 2) / hw;
    grooveAngle = random.range(16, 40);
    const bend = random.range(0.15, 0.6);
    const vWidth = random.range(2.8, 3.8);
    const gap = random.chance(0.5) ? random.range(0.06, 0.2) * hw : 0;
    for (const side of [1, -1] as const) tile.strip(chevron(hw, gap, grooveAngle, bend, side, -P / 4), vWidth);
    if (random.chance(0.6)) {
      sipeDensity = 1;
      for (const side of [1, -1] as const) {
        const points = chevron(hw, gap + 4, grooveAngle, bend, side, P / 4);
        tile.sipe(points.slice(0, 2));
      }
    }
  }

  return {
    variant,
    pitchCount: 0,
    grooveCount,
    grooveWidth,
    grooveAngle,
    sipeDensity,
    shoulderRibRatio,
    studsPerPitch: 0,
  };
}

function buildWinter(tile: PitchTile, random: Random, studded: boolean): TreadSpec {
  const hw = tile.halfWidth;
  const P = tile.pitch;
  const variant: TreadVariant = studded || random.chance(0.5) ? "nordic" : "lamella";
  let grooveCount: number;
  let grooveWidth: number;
  let grooveAngle: number;
  let sipeDensity: number;
  let shoulderRibRatio: number;

  if (variant === "nordic") {
    grooveAngle = random.range(26, 48);
    const bend = random.range(0.25, 0.6);
    grooveWidth = random.range(2.4, 3.4);
    const gap = random.range(0, 0.12) * hw;
    for (const side of [1, -1] as const) tile.strip(chevron(hw, gap, grooveAngle, bend, side, -P / 2), grooveWidth);
    grooveCount = random.int(2, 3);
    const outer = random.range(0.4, 0.6) * hw;
    const zigzag = random.range(1.2, 2.6);
    const zigWidth = random.range(1.7, 2.5);
    const positions = grooveCount === 3 ? [-outer, 0, outer] : [-outer, outer];
    positions.forEach((x) => tile.zigzagCircumferential(x, zigzag, zigWidth));
    shoulderRibRatio = (hw - outer) / hw;
    sipeDensity = random.int(2, 4);
    const amplitude = random.range(0.55, 0.95);
    for (let index = 1; index <= sipeDensity; index += 1) {
      const offset = -P / 2 + (P * index) / (sipeDensity + 1);
      for (const side of [1, -1] as const) {
        const points = chevron(hw, gap + 1.5, grooveAngle, bend, side, offset);
        tile.zigzagSipe(points[0], points[1], amplitude);
        tile.zigzagSipe(points[1], points[2], amplitude);
      }
    }
  } else {
    grooveCount = random.int(3, 4);
    grooveWidth = random.range(2, 3);
    grooveAngle = random.range(8, 30);
    const spread = random.range(0.55, 0.7);
    const positions: number[] = [];
    for (let index = 0; index < grooveCount; index += 1) {
      positions.push((-spread + (2 * spread * index) / (grooveCount - 1)) * hw);
    }
    positions.forEach((x) => tile.circumferential(x, grooveWidth));
    shoulderRibRatio = (hw - positions[grooveCount - 1]) / hw;
    const edges = [-hw - 3, ...positions, hw + 3];
    sipeDensity = random.int(3, 5);
    const amplitude = random.range(0.5, 0.85);
    const alternate = random.chance(0.5);
    for (let column = 0; column < edges.length - 1; column += 1) {
      const from = edges[column];
      const to = edges[column + 1];
      const direction = alternate && column % 2 === 1 ? -1 : 1;
      const tan = Math.tan((grooveAngle * direction * Math.PI) / 180);
      const shift = column % 2 === 0 ? 0 : P / 2;
      tile.strip(
        [
          [from, shift - ((to - from) / 2) * tan],
          [to, shift + ((to - from) / 2) * tan],
        ],
        grooveWidth * 0.85,
      );
      for (let index = 1; index <= sipeDensity; index += 1) {
        const y = shift + (P * index) / (sipeDensity + 1);
        tile.zigzagSipe(
          [from + 0.8, y - ((to - from) / 2 - 0.8) * tan],
          [to - 0.8, y + ((to - from) / 2 - 0.8) * tan],
          amplitude,
          2.2,
        );
      }
    }
  }

  const studsPerPitch = studded ? random.int(2, 3) : 0;
  if (studded) placeStuds(tile, random, studsPerPitch);

  return {
    variant,
    pitchCount: 0,
    grooveCount,
    grooveWidth,
    grooveAngle,
    sipeDensity,
    shoulderRibRatio,
    studsPerPitch,
  };
}

function buildAllSeason(tile: PitchTile, random: Random): TreadSpec {
  const hw = tile.halfWidth;
  const P = tile.pitch;
  const grooveAngle = random.range(30, 56);
  const bend = random.range(0.2, 0.5);
  const grooveWidth = random.range(3.2, 4.6);
  const center = random.chance(0.5);
  const gap = center ? 0 : random.range(0.05, 0.16) * hw;
  for (const side of [1, -1] as const) tile.strip(chevron(hw, gap, grooveAngle, bend, side, -P / 2), grooveWidth);
  const grooveCount = center ? 1 : 0;
  if (center) tile.circumferential(0, random.range(2.4, 3.4));
  // Secondary partial V grooves for the hybrid look.
  const partial = random.range(0.3, 0.55) * hw;
  for (const side of [1, -1] as const) {
    tile.strip(chevron(hw, partial, grooveAngle, bend, side, 0).slice(0, 3), grooveWidth * 0.5);
  }
  const sipeDensity = random.int(1, 2);
  for (let index = 1; index <= sipeDensity; index += 1) {
    const offset = -P / 2 + (P * index) / (sipeDensity + 1) - P / 4;
    for (const side of [1, -1] as const) {
      const points = chevron(hw, gap + 2, grooveAngle, bend, side, offset);
      tile.sipe(points);
    }
  }
  return {
    variant: "v-hybrid",
    pitchCount: 0,
    grooveCount,
    grooveWidth,
    grooveAngle,
    sipeDensity,
    shoulderRibRatio: (hw - partial) / hw,
    studsPerPitch: 0,
  };
}

function buildAllTerrain(tile: PitchTile, random: Random): TreadSpec {
  const hw = tile.halfWidth;
  const P = tile.pitch;
  const grooveWidth = random.range(4.6, 6.4);
  const lane = random.range(0.26, 0.4) * hw;
  const amplitude = random.range(1.6, 3.4);
  for (const side of [1, -1] as const) tile.zigzagCircumferential(side * lane, amplitude * side, grooveWidth);
  const centerGroove = random.chance(0.5);
  if (centerGroove) tile.zigzagCircumferential(0, amplitude * 0.6, grooveWidth * 0.5);
  const grooveAngle = random.range(-12, 12);
  const tan = Math.tan((grooveAngle * Math.PI) / 180);
  const step = random.range(0.2, 0.45) * P;
  const lateralWidth = random.range(4.8, 6.8);
  // Staggered shoulder voids with a step, different on each side.
  for (const side of [1, -1] as const) {
    const y0 = side > 0 ? -P / 4 : P / 4;
    const kink = lane + (hw - lane) * random.range(0.45, 0.6);
    tile.strip(
      [
        [side * (hw + 4), y0 + (hw + 4 - kink) * tan],
        [side * kink, y0],
        [side * (kink - 4), y0 + step * 0.4],
        [side * (lane - 1), y0 + step * 0.4 + (kink - lane) * tan],
      ],
      lateralWidth,
    );
  }
  // Centre block separation.
  tile.strip(
    [
      [lane, P / 4 - step * 0.3],
      [-lane, -P / 4 + step * 0.3],
    ],
    lateralWidth * 0.55,
  );
  const sipeDensity = random.int(1, 2);
  for (let index = 0; index < sipeDensity; index += 1) {
    const y = (index + 1) * (P / (sipeDensity + 1)) - P / 2;
    tile.sipe([
      [lane + 3, y],
      [hw - 3, y + (hw - lane) * tan],
    ]);
    tile.sipe([
      [-lane - 3, -y],
      [-hw + 3, -y - (hw - lane) * tan],
    ]);
  }
  return {
    variant: "block",
    pitchCount: 0,
    grooveCount: centerGroove ? 3 : 2,
    grooveWidth,
    grooveAngle,
    sipeDensity,
    shoulderRibRatio: (hw - lane) / hw,
    studsPerPitch: 0,
  };
}

/* ------------------------------------------------------------------------ */
/* Geometry                                                                 */
/* ------------------------------------------------------------------------ */

interface Geometry {
  radius: number;
  width: number;
  shoulder: number;
  shoulderDrop: number;
  crownHalf: number;
  sidewallOuter: number;
  bead: number;
  centerX: number;
  centerY: number;
}

function geometryFor(value: NormalizedInput, family: TreadFamily): Geometry {
  const sectionHeight = (value.width * value.profile) / 100;
  const rimRadius = (value.diameter * 25.4) / 2;
  const outerRadius = rimRadius + sectionHeight;
  const radius = RADIUS;
  const width = clamp((radius * value.width) / outerRadius, radius * 0.5, radius * 0.92);
  const shoulder = width * (family === "all-terrain" ? 0.075 : 0.1);
  const shoulderDrop = radius * (family === "all-terrain" ? 0.045 : 0.058);
  const crownHalf = width / 2 - shoulder;
  const sidewallOuter = radius - shoulderDrop;
  const bead = clamp((radius * rimRadius) / outerRadius, radius * 0.42, sidewallOuter - 24);
  const left = (width / 2) * YAW_SIN - sidewallOuter * YAW_COS;
  const right = radius * YAW_COS - crownHalf * YAW_SIN;
  const centerX = VIEW / 2 - (left + right) / 2;
  return { radius, width, shoulder, shoulderDrop, crownHalf, sidewallOuter, bead, centerX, centerY: CENTER_Y };
}

/* ------------------------------------------------------------------------ */
/* Text layout                                                              */
/* ------------------------------------------------------------------------ */

const LATIN_WIDTHS: Record<string, number> = {
  A: 0.722, B: 0.722, C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722, I: 0.278, J: 0.556,
  K: 0.722, L: 0.611, M: 0.833, N: 0.722, O: 0.778, P: 0.667, Q: 0.778, R: 0.722, S: 0.667, T: 0.611,
  U: 0.722, V: 0.667, W: 0.944, X: 0.667, Y: 0.667, Z: 0.611, " ": 0.278, "/": 0.278, "-": 0.333,
  ".": 0.278, ",": 0.278, "&": 0.722, "(": 0.333, ")": 0.333, "'": 0.238, '"': 0.474, "+": 0.584,
  "×": 0.584, "<": 0.584, ">": 0.584, ":": 0.333, "!": 0.333, "·": 0.278, "…": 1, "\u00a0": 0.278,
};
const WIDE_CYRILLIC = new Set(["Ж", "Ш", "Щ", "Ы", "Ю", "М", "Ф", "Ъ"]);

function emWidth(text: string): number {
  let total = 0;
  for (const character of text) {
    if (character in LATIN_WIDTHS) total += LATIN_WIDTHS[character];
    else if (/[0-9]/.test(character)) total += 0.556;
    else if (/\p{Script=Cyrillic}/u.test(character)) total += WIDE_CYRILLIC.has(character) ? 0.92 : character === "Г" ? 0.6 : 0.72;
    else if (/\p{Lu}|\p{Lt}/u.test(character)) total += 0.72;
    else if (/\p{Ll}/u.test(character)) total += 0.58;
    else if (/\p{M}/u.test(character)) total += 0;
    else total += 0.9;
  }
  return total;
}

interface FittedText {
  text: string;
  size: number;
  length: number;
  spacing: number;
}

/** Glyphs may be squeezed to 62% of their width before the text is shortened. */
const MAX_SQUEEZE = 0.62;

/**
 * Fits text into an arc of `maxLength`: first shrinks the font down to
 * `minSize`, then squeezes glyphs via textLength, and only for extreme input
 * shortens `text` with an ellipsis (`suffix`, e.g. the tire size, is kept).
 */
function fitText(
  text: string,
  maxSize: number,
  minSize: number,
  maxLength: number,
  spacingRatio: number,
  weight = 1,
  suffix = "",
): FittedText {
  const measure = (value: string, size: number) => {
    const full = value + suffix;
    return size * emWidth(full) * weight + size * spacingRatio * Math.max(0, Array.from(full).length - 1);
  };
  let size = maxSize;
  let length = measure(text, size);
  if (length > maxLength) {
    size = Math.max(minSize, (size * maxLength) / length);
    length = measure(text, size);
  }
  let fitted = text;
  if (text && length > maxLength / MAX_SQUEEZE) {
    const characters = Array.from(text);
    const shortened = () => `${characters.join("").trimEnd()}…`;
    while (characters.length > 1 && measure(shortened(), size) > maxLength / MAX_SQUEEZE) characters.pop();
    fitted = shortened();
    length = measure(fitted, size);
  }
  return { text: fitted, size, length: Math.min(length, maxLength), spacing: size * spacingRatio };
}

function arcPath(radius: number, fromDegrees: number, toDegrees: number, clockwise: boolean): string {
  const point = (degrees: number) => {
    const angle = (degrees * Math.PI) / 180;
    return [radius * Math.cos(angle), -radius * Math.sin(angle)];
  };
  const [x1, y1] = point(fromDegrees);
  const [x2, y2] = point(toDegrees);
  const span = Math.abs(toDegrees - fromDegrees);
  return `M${n(x1)} ${n(y1)}A${n(radius)} ${n(radius)} 0 ${span > 180 ? 1 : 0} ${clockwise ? 1 : 0} ${n(x2)} ${n(y2)}`;
}

/* ------------------------------------------------------------------------ */
/* Season badges                                                            */
/* ------------------------------------------------------------------------ */

function sunIcon(x: number, y: number, scale: number): string {
  let rays = "";
  for (let index = 0; index < 8; index += 1) {
    const angle = (index * Math.PI) / 4;
    rays += `M${n(x + Math.cos(angle) * 8.2 * scale)} ${n(y + Math.sin(angle) * 8.2 * scale)}L${n(x + Math.cos(angle) * 11.2 * scale)} ${n(y + Math.sin(angle) * 11.2 * scale)}`;
  }
  return `<path d="${rays}" stroke="#c4841a" stroke-width="${n(2 * scale)}" stroke-linecap="round"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(5.4 * scale)}" fill="#e3a23b"/>`;
}

function snowIcon(x: number, y: number, scale: number): string {
  let path = "";
  for (let index = 0; index < 6; index += 1) {
    const angle = (index * Math.PI) / 3 - Math.PI / 2;
    const ex = x + Math.cos(angle) * 10.5 * scale;
    const ey = y + Math.sin(angle) * 10.5 * scale;
    path += `M${n(x)} ${n(y)}L${n(ex)} ${n(ey)}`;
    const bx = x + Math.cos(angle) * 6.4 * scale;
    const by = y + Math.sin(angle) * 6.4 * scale;
    for (const turn of [-0.75, 0.75]) {
      path += `M${n(bx)} ${n(by)}L${n(bx + Math.cos(angle + turn) * 3.6 * scale)} ${n(by + Math.sin(angle + turn) * 3.6 * scale)}`;
    }
  }
  return `<path d="${path}" stroke="#2f6fae" stroke-width="${n(1.7 * scale)}" stroke-linecap="round"/>`;
}

function studIcon(x: number, y: number): string {
  return (
    `<path d="M${n(x - 1.7)} ${n(y - 10)}h3.4v4h-3.4Z" fill="#eef1f4" stroke="#596066" stroke-width=".8"/>` +
    `<path d="M${n(x - 4.2)} ${n(y - 6)}h8.4v9h-8.4Z" fill="#9aa1a8" stroke="#4b5157" stroke-width="1"/>` +
    `<path d="M${n(x - 8)} ${n(y + 3)}h16a1.6 1.6 0 0 1 0 3.2h-16a1.6 1.6 0 0 1 0-3.2Z" fill="#6f777e" stroke="#40464b" stroke-width="1"/>`
  );
}

function badge(x: number, y: number, content: string, label: string): string {
  return (
    `<g data-badge="${label}"><circle cx="${n(x)}" cy="${n(y + 1.5)}" r="19" fill="#000" fill-opacity=".07"/>` +
    `<circle cx="${n(x)}" cy="${n(y)}" r="19" fill="#fff" fill-opacity=".95" stroke="#d8d3c8" stroke-width="1.2"/>${content}</g>`
  );
}

/* ------------------------------------------------------------------------ */
/* Public API                                                               */
/* ------------------------------------------------------------------------ */

interface Model {
  value: NormalizedInput;
  spec: TireIllustrationSpec;
  tile: PitchTile;
  geometry: Geometry;
  random: Random;
}

function buildModel(input: TireIllustrationInput): Model {
  const value = normalizeInput(input);
  const family = familyFor(value);
  const seed = seedFor(value.brand, value.model);
  const random = createRandom(seed ^ 0x9e3779b9);
  const geometry = geometryFor(value, family);
  const pitchRanges: Record<TreadFamily, [number, number]> = {
    summer: [56, 72],
    winter: [48, 62],
    "all-season": [44, 56],
    "all-terrain": [32, 40],
  };
  const [minPitch, maxPitch] = pitchRanges[family];
  const pitchCount = random.int(minPitch, maxPitch);
  const pitch = (2 * Math.PI * geometry.radius) / pitchCount;
  const tile = new PitchTile(geometry.crownHalf, pitch);
  let tread: TreadSpec;
  if (family === "summer") tread = buildSummer(tile, random, /asym/i.test(value.model));
  else if (family === "winter") tread = buildWinter(tile, random, value.studded);
  else if (family === "all-season") tread = buildAllSeason(tile, random);
  else tread = buildAllTerrain(tile, random);
  if (value.studded && tile.studs.length === 0) {
    const studsPerPitch = random.int(2, 3);
    placeStuds(tile, random, studsPerPitch);
    tread = { ...tread, studsPerPitch };
  }
  const round = (number: number) => Math.round(number * 100) / 100;
  return {
    value,
    geometry,
    tile,
    random,
    spec: {
      ...tread,
      family,
      seed,
      pitchCount,
      grooveWidth: round(tread.grooveWidth),
      grooveAngle: round(tread.grooveAngle),
      shoulderRibRatio: round(tread.shoulderRibRatio),
      studded: value.studded,
      xl: value.xl,
      runflat: value.runflat,
    },
  };
}

/** Pattern parameters used for the drawing (exposed for tests and tooling). */
export function getTireIllustrationSpec(input: TireIllustrationInput): TireIllustrationSpec {
  return buildModel(input).spec;
}

export function tireIllustrationAlt(input: TireIllustrationInput): string {
  const brand = sanitizeIllustrationText(input.brand);
  const model = sanitizeIllustrationText(input.model);
  const name = [brand, model].filter(Boolean).join(" ");
  const size = formatTireSize(input);
  return ["Иллюстрация шины" + (name ? ` ${name}` : ""), size].filter(Boolean).join(", ");
}

export function renderTireIllustrationSvg(input: TireIllustrationInput): string {
  const { value, spec, tile, geometry, random } = buildModel(input);
  const { radius: R, width: W, shoulder, shoulderDrop, crownHalf, sidewallOuter: Ro, bead: rb, centerX: cx, centerY: cy } = geometry;
  const s = YAW_SIN;
  const c = YAW_COS;
  const out: string[] = [];

  // Tread band outline: crown front edge (right half) to crown back edge.
  const frontX = cx + crownHalf * s;
  const backX = cx - crownHalf * s;
  const band = `M${n(frontX)} ${n(cy - R)}A${n(R * c)} ${n(R)} 0 0 1 ${n(frontX)} ${n(cy + R)}H${n(backX)}A${n(R * c)} ${n(R)} 0 0 0 ${n(backX)} ${n(cy - R)}Z`;

  const faceX = cx + (W / 2) * s;
  const span = Ro - rb;
  // The bead openings of the front and back sidewalls overlap in a lens through
  // which the background stays visible; everything behind the sidewall is
  // clipped by it.
  const shift = (W * -s) / c;
  const seeThrough = shift < rb * 1.96;
  const lensX = shift / 2;
  const lensY = seeThrough ? Math.sqrt(rb * rb - lensX * lensX) : 0;
  const lens = seeThrough
    ? `M${n(faceX + lensX * c)} ${n(cy - lensY)}A${n(rb * c)} ${n(rb)} 0 0 1 ${n(faceX + lensX * c)} ${n(cy + lensY)}A${n(rb * c)} ${n(rb)} 0 0 1 ${n(faceX + lensX * c)} ${n(cy - lensY)}Z`
    : "";
  const textRadius = rb + span * 0.53;
  const brandText = value.brand.toUpperCase();
  const modelText = value.model.toUpperCase();
  const sizeText = value.size;

  // Pitch placement: only pitches that face the viewer enough to be visible.
  const phase = random.range(0, 1) * ((2 * Math.PI) / spec.pitchCount);
  const uses: string[] = [];
  const limit = (84 * Math.PI) / 180;
  for (let index = -spec.pitchCount; index <= spec.pitchCount; index += 1) {
    const theta = phase + (index * 2 * Math.PI) / spec.pitchCount;
    if (Math.abs(theta) > limit) continue;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    uses.push(
      `<use href="#p" transform="matrix(${m(s)} 0 ${m(-c * sin)} ${m(-cos)} ${n(cx + R * c * cos)} ${n(cy - R * sin)})"/>`,
    );
  }

  const title = escapeXml(tireIllustrationAlt(input));
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}" role="img">`,
    `<title>${title}</title>`,
    "<defs>",
    // Ground shadow.
    `<radialGradient id="gs"><stop offset="0" stop-color="#1b1a16" stop-opacity=".42"/><stop offset=".55" stop-color="#1b1a16" stop-opacity=".16"/><stop offset="1" stop-color="#1b1a16" stop-opacity="0"/></radialGradient>`,
    // Tread lighting: dark where the crown turns away at top and bottom.
    `<linearGradient id="gt" gradientUnits="userSpaceOnUse" x1="0" y1="${n(cy - R)}" x2="0" y2="${n(cy + R)}"><stop offset="0" stop-color="#000" stop-opacity=".88"/><stop offset=".1" stop-color="#000" stop-opacity=".5"/><stop offset=".27" stop-color="#fff" stop-opacity=".1"/><stop offset=".4" stop-color="#fff" stop-opacity=".04"/><stop offset=".62" stop-color="#000" stop-opacity=".12"/><stop offset=".86" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity=".9"/></linearGradient>`,
    // Tread lateral shading: crown edge highlight, back shoulder falloff.
    `<linearGradient id="gx" gradientUnits="userSpaceOnUse" x1="${n(cx + R * c + crownHalf * s)}" y1="0" x2="${n(cx + R * c - crownHalf * s)}" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset=".18" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>`,
    // Shoulder steps.
    `<linearGradient id="gh" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#4a4d4b"/><stop offset=".45" stop-color="#2a2c2b"/><stop offset="1" stop-color="#0d0e0e"/></linearGradient>`,
    // Sidewall bulge (radial) and directional light.
    `<radialGradient id="gw" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${n(Ro)}"><stop offset="${m(rb / Ro)}" stop-color="#121313"/><stop offset="${m((rb + span * 0.18) / Ro)}" stop-color="#262827"/><stop offset="${m((rb + span * 0.55) / Ro)}" stop-color="#363937"/><stop offset="${m((Ro - span * 0.12) / Ro)}" stop-color="#232524"/><stop offset="1" stop-color="#0f1010"/></radialGradient>`,
    `<linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/><stop offset=".62" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>`,
    `<linearGradient id="gg" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
    // Tire interior seen through the bead opening.
    `<linearGradient id="gi" x1="0" y1="0" x2="1" y2=".3"><stop offset="0" stop-color="#3b3e3c"/><stop offset=".55" stop-color="#1c1d1d"/><stop offset="1" stop-color="#080909"/></linearGradient>`,
    `<linearGradient id="gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6e716f"/><stop offset=".5" stop-color="#2b2d2c"/><stop offset="1" stop-color="#080808"/></linearGradient>`,
    // Raised lettering.
    `<linearGradient id="gc" gradientUnits="userSpaceOnUse" x1="${n(-Ro)}" y1="${n(-Ro)}" x2="${n(Ro)}" y2="${n(Ro)}"><stop offset="0" stop-color="#f4f4f0"/><stop offset=".55" stop-color="#d2d3ce"/><stop offset="1" stop-color="#9c9e99"/></linearGradient>`,
    `<clipPath id="cb"><path d="${band}"/></clipPath>`,
    `<clipPath id="cl"><path clip-rule="evenodd" d="M0 0H${VIEW}V${VIEW}H0Z${lens}"/></clipPath>`,
    `<clipPath id="cp"><rect x="${n(-crownHalf - 1)}" y="${n(-tile.pitch / 2 - 0.35)}" width="${n(crownHalf * 2 + 2)}" height="${n(tile.pitch + 0.7)}"/></clipPath>`,
  );

  // Pitch tile.
  let tileMarkup = `<g id="p" clip-path="url(#cp)"><path d="${tile.grooves.join("")}" fill="#0b0c0c"/>`;
  if (tile.edges.length) {
    tileMarkup += `<path d="${tile.edges.join("")}" fill="none" stroke="#8a8e8b" stroke-opacity=".5" stroke-width=".7"/>`;
  }
  if (tile.sipes.length) {
    tileMarkup += `<path d="${tile.sipes.join("")}" fill="none" stroke="#070808" stroke-width=".75" stroke-linejoin="round"/>`;
  }
  if (tile.studs.length) {
    const ring = tile.studs.map(([x, y]) => `M${n(x - 2.9)} ${n(y)}a2.9 2.9 0 1 0 5.8 0a2.9 2.9 0 1 0-5.8 0`).join("");
    const pin = tile.studs.map(([x, y]) => `M${n(x - 1.8)} ${n(y)}a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0`).join("");
    const glint = tile.studs.map(([x, y]) => `M${n(x - 0.3)} ${n(y + 0.9)}a.7 .7 0 1 0 1.4 0a.7 .7 0 1 0-1.4 0`).join("");
    tileMarkup += `<g id="studs"><path d="${ring}" fill="#050606"/><path d="${pin}" fill="#c5cacf"/><path d="${glint}" fill="#fff"/></g>`;
  }
  tileMarkup += "</g>";
  out.push(tileMarkup);

  // Sidewall text paths (sidewall-local coordinates).
  // Brand on the upper arc: wider when there are no XL / RunFlat marks beside it.
  const brandAngle = ((value.xl || value.runflat ? 112 : 150) * Math.PI) / 180;
  const brandFit = fitText(brandText, clamp(span * 0.5, 10, 25), 9.5, textRadius * brandAngle, 0.12);
  const brandRadius = textRadius - brandFit.size * 0.36;
  const brandFinal = fitText(brandText, brandFit.size, 9.5, brandRadius * brandAngle, 0.12);
  // Model and size on the lower arc; only the model is ever shortened.
  const sizeSuffix = sizeText ? `${modelText ? "\u00a0\u00a0\u00a0" : ""}${sizeText}` : "";
  const bottomAngle = (160 * Math.PI) / 180;
  const modelFit = fitText(modelText, clamp(span * 0.34, 8, 16), 7, textRadius * bottomAngle, 0.05, 0.98, sizeSuffix);
  const bottomRadius = textRadius + modelFit.size * 0.36;
  const modelFinal = fitText(modelText, modelFit.size, 7, bottomRadius * bottomAngle, 0.05, 0.98, sizeSuffix);
  const markSize = clamp(span * 0.32, 8, 13);

  out.push(
    `<path id="ta" d="${arcPath(brandRadius, 210, -30, true)}"/>`,
    `<path id="tb" d="${arcPath(bottomRadius, 165, 375, false)}"/>`,
  );

  let texts = `<g id="tx" font-family="${FONT}">`;
  if (brandText) {
    texts += `<text font-size="${n(brandFinal.size)}" font-weight="700" letter-spacing="${n(brandFinal.spacing)}"><textPath href="#ta" startOffset="50%" text-anchor="middle" textLength="${n(brandFinal.length)}" lengthAdjust="spacingAndGlyphs">${escapeXml(brandFinal.text)}</textPath></text>`;
  }
  if (modelText || sizeSuffix) {
    const modelPart = escapeXml(modelFinal.text);
    const sizePart = sizeSuffix ? `<tspan font-weight="700">${escapeXml(sizeSuffix)}</tspan>` : "";
    texts += `<text font-size="${n(modelFinal.size)}" letter-spacing="${n(modelFinal.spacing)}"><textPath href="#tb" startOffset="50%" text-anchor="middle" textLength="${n(modelFinal.length)}" lengthAdjust="spacingAndGlyphs">${modelPart}${sizePart}</textPath></text>`;
  }
  const marks: Array<[string, number]> = [];
  if (value.xl) marks.push(["XL", 18.75]);
  if (value.runflat) marks.push(["RUNFLAT", 82.5]);
  for (const [label, offset] of marks) {
    const fit = fitText(label, markSize, 6, brandRadius * ((34 * Math.PI) / 180), 0.1);
    texts += `<text font-size="${n(fit.size)}" font-weight="700" letter-spacing="${n(fit.spacing)}" data-mark="${label}"><textPath href="#ta" startOffset="${offset}%" text-anchor="middle" textLength="${n(fit.length)}" lengthAdjust="spacingAndGlyphs">${label}</textPath></text>`;
  }
  texts += "</g>";
  out.push(texts, "</defs>");

  // Ground shadow.
  out.push(`<ellipse cx="${n(VIEW / 2 + 6)}" cy="${n(cy + R + 2)}" rx="${n(R * 0.98)}" ry="13" fill="url(#gs)"/>`);

  // Back shoulder (only its top and bottom corners stay visible).
  out.push(`<g clip-path="url(#cl)">`);
  for (const step of [0.55, 1]) {
    const angle = (step * Math.PI) / 2;
    const z = -(crownHalf + shoulder * Math.sin(angle));
    const r = R - shoulderDrop * (1 - Math.cos(angle));
    out.push(`<ellipse cx="${n(cx + z * s)}" cy="${n(cy)}" rx="${n(r * c)}" ry="${n(r)}" fill="#141515"/>`);
  }

  // Tread band.
  out.push(`<path d="${band}" fill="#2c2e2d"/>`, `<g clip-path="url(#cb)">${uses.join("")}</g>`);
  out.push(`<path d="${band}" fill="url(#gx)"/>`, `<path d="${band}" fill="url(#gt)"/>`);

  // Front shoulder: stepped ellipses approximate the rounded edge.
  const shoulderSteps = [0, 0.3, 0.55, 0.8, 1];
  const shoulderFills = ["#3a3d3b", "#323534", "#2a2c2b", "#212322", "#181919"];
  shoulderSteps.forEach((step, index) => {
    const angle = (step * Math.PI) / 2;
    const z = crownHalf + shoulder * Math.sin(angle);
    const r = R - shoulderDrop * (1 - Math.cos(angle));
    out.push(`<ellipse cx="${n(cx + z * s)}" cy="${n(cy)}" rx="${n(r * c)}" ry="${n(r)}" fill="${shoulderFills[index]}"/>`);
    if (index === 0) out.push(`<ellipse cx="${n(cx + z * s)}" cy="${n(cy)}" rx="${n(r * c)}" ry="${n(r)}" fill="url(#gh)" fill-opacity=".55"/>`);
  });
  out.push("</g>");

  // Sidewall, drawn as circles in a horizontally foreshortened group.
  const ring = (outer: number, inner: number) =>
    `M${n(-outer)} 0A${n(outer)} ${n(outer)} 0 1 0 ${n(outer)} 0A${n(outer)} ${n(outer)} 0 1 0 ${n(-outer)} 0ZM${n(-inner)} 0A${n(inner)} ${n(inner)} 0 1 1 ${n(inner)} 0A${n(inner)} ${n(inner)} 0 1 1 ${n(-inner)} 0Z`;
  const face: string[] = [];
  if (spec.family === "all-terrain") {
    const lugCount = Math.round(spec.pitchCount * 1.5);
    const circumference = 2 * Math.PI * (Ro - 3);
    const dash = (circumference / lugCount) * random.range(0.5, 0.62);
    face.push(
      `<circle r="${n(Ro - 3)}" fill="none" stroke="#1d1f1e" stroke-width="12" stroke-dasharray="${n(dash)} ${n(circumference / lugCount - dash)}"/>`,
    );
  }
  face.push(
    `<path d="${ring(Ro, rb)}" fill="url(#gw)" fill-rule="evenodd"/>`,
    `<path d="${ring(Ro, rb)}" fill="url(#gl)" fill-rule="evenodd"/>`,
  );
  if (spec.family === "all-terrain") {
    const lugCount = Math.round(spec.pitchCount * 1.5);
    const circumference = 2 * Math.PI * (Ro + 0.5);
    const dash = (circumference / lugCount) * 0.55;
    face.push(
      `<circle r="${n(Ro - 4)}" fill="none" stroke="#2e302f" stroke-width="9" stroke-dasharray="${n(dash)} ${n(circumference / lugCount - dash)}" stroke-dashoffset="${n(dash * 0.25)}"/>`,
      `<circle r="${n(Ro + 0.6)}" fill="none" stroke="#1a1b1b" stroke-width="3.6" stroke-dasharray="${n(dash)} ${n(circumference / lugCount - dash)}" stroke-dashoffset="${n(dash * 0.25)}"/>`,
    );
  } else if (random.chance(0.7)) {
    // Knurled band near the shoulder, unique width and texture per model.
    const knurlRadius = Ro - span * random.range(0.07, 0.11);
    face.push(
      `<circle r="${n(knurlRadius)}" fill="none" stroke="#1a1c1b" stroke-width="${n(span * random.range(0.08, 0.13))}" stroke-dasharray="${n(random.range(0.7, 1.2))} ${n(random.range(1, 1.8))}"/>`,
    );
  }
  // Soft highlight where the sidewall bulge faces the light (upper left).
  const glowRadius = rb + span * 0.52;
  face.push(
    `<path d="${arcPath(glowRadius, 95, 215, false)}" fill="none" stroke="url(#gg)" stroke-width="${n(span * 0.5)}" stroke-linecap="round"/>`,
  );
  // Decorative rings on the sidewall.
  const ringRadii = [rb + span * random.range(0.1, 0.17), Ro - span * random.range(0.15, 0.24)];
  if (random.chance(0.5)) ringRadii.push(rb + span * random.range(0.86, 0.9));
  face.push(
    `<path d="${ringRadii.map((radius) => `M${n(-radius)} 0A${n(radius)} ${n(radius)} 0 1 0 ${n(radius)} 0A${n(radius)} ${n(radius)} 0 1 0 ${n(-radius)} 0`).join("")}" fill="none" stroke="#545856" stroke-opacity=".55" stroke-width=".8"/>`,
  );

  // Bead opening: the tire interior shows where the openings do not overlap.
  if (!seeThrough) {
    face.push(`<circle r="${n(rb)}" fill="url(#gi)"/>`);
  } else {
    face.push(
      `<path d="M${n(lensX)} ${n(-lensY)}A${n(rb)} ${n(rb)} 0 1 0 ${n(lensX)} ${n(lensY)}A${n(rb)} ${n(rb)} 0 0 1 ${n(lensX)} ${n(-lensY)}Z" fill="url(#gi)" stroke="#4a4d4b" stroke-opacity=".7" stroke-width=".9"/>`,
    );
  }
  face.push(
    `<circle r="${n(rb + 1.3)}" fill="none" stroke="url(#gb)" stroke-width="2.8"/>`,
    `<circle r="${n(rb + 4.4)}" fill="none" stroke="#080909" stroke-opacity=".7" stroke-width="1.1"/>`,
    `<use href="#tx" fill="#050606" fill-opacity=".9" transform="translate(.5 .9)"/>`,
    `<use href="#tx" fill="url(#gc)"/>`,
  );
  out.push(`<g transform="matrix(${m(c)} 0 0 1 ${n(faceX)} ${n(cy)})">${face.join("")}</g>`);

  // Season and stud badges in the lower left corner (the card puts its own
  // tags and buttons in the top corners).
  const badges: string[] = [];
  if (value.season === "summer") badges.push(badge(34, 364, sunIcon(34, 364, 1), "summer"));
  else if (value.season === "winter") badges.push(badge(34, 364, snowIcon(34, 364, 1), "winter"));
  else if (value.season === "all-season") {
    badges.push(badge(34, 364, sunIcon(28.5, 358.5, 0.62) + snowIcon(39.5, 369.5, 0.62), "all-season"));
  }
  if (value.studded) badges.push(badge(34, badges.length ? 318 : 364, studIcon(34, badges.length ? 320 : 366), "studs"));
  out.push(...badges, "</svg>");

  return out.join("");
}

export function tireIllustrationDataUri(input: TireIllustrationInput): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderTireIllustrationSvg(input))}`;
}

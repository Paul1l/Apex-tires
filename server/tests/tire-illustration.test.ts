import assert from "node:assert/strict";
import test from "node:test";
import { seedProducts } from "../../lib/catalog-data.js";
import {
  getTireIllustrationSpec,
  renderTireIllustrationSvg,
  tireIllustrationAlt,
  tireIllustrationDataUri,
  type TireIllustrationInput,
} from "../../lib/tire-illustration.js";

const demoTires = seedProducts.filter((product) => product.kind === "tire");

const baseTire: TireIllustrationInput = {
  brand: "Michelin",
  model: "Pilot Sport 5",
  season: "summer",
  studded: false,
  runflat: false,
  width: 225,
  profile: 45,
  diameter: 18,
  tags: [],
};

function tile(svg: string): string {
  const match = svg.match(/<g id="p"[\s\S]*?<\/g>(?:<\/g>)?/);
  assert.ok(match, "tread tile is present");
  return match[0];
}

/**
 * Minimal well-formedness check: balanced tags, quoted attributes, escaped
 * text. Returns every attribute name so callers can inspect them.
 */
function assertWellFormedXml(svg: string): string[] {
  const stack: string[] = [];
  const attributeNames: string[] = [];
  const tagPattern = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[A-Za-z_:][\w:.-]*="[^"<>]*")*)\s*(\/?)>/y;
  let index = 0;
  while (index < svg.length) {
    const next = svg.indexOf("<", index);
    const text = svg.slice(index, next === -1 ? svg.length : next);
    assert.doesNotMatch(text, />/, "raw > in text");
    assert.doesNotMatch(text, /&(?!(amp|lt|gt|quot|apos);)/, "unescaped & in text");
    if (next === -1) break;
    tagPattern.lastIndex = next;
    const match = tagPattern.exec(svg);
    assert.ok(match, `malformed tag near: ${svg.slice(next, next + 80)}`);
    const [, closing, name, attributes, selfClosing] = match;
    for (const attribute of attributes.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
      attributeNames.push(attribute[1]);
      assert.doesNotMatch(attribute[2], /&(?!(amp|lt|gt|quot|apos);)/, "unescaped & in attribute");
      if (/href$/i.test(attribute[1])) assert.match(attribute[2], /^#[a-z]+$/, "only local fragment links");
    }
    if (closing) assert.equal(stack.pop(), name, `unbalanced </${name}>`);
    else if (!selfClosing) stack.push(name);
    index = tagPattern.lastIndex;
  }
  assert.deepEqual(stack, [], "all tags are closed");
  return attributeNames;
}

function assertSafeSvg(svg: string) {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 400 400"/);
  assert.ok(svg.endsWith("</svg>"));
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /href="(?!#)/, "only local fragment references");
  assert.doesNotMatch(svg, /href="http/i);
  assert.doesNotMatch(svg, /<(image|foreignObject|iframe|style)\b/i);
  assert.doesNotMatch(svg, /url\((?!#)/, "no external url() references");
  assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
  assert.ok(Buffer.byteLength(svg, "utf8") <= 20 * 1024, `SVG is ${Buffer.byteLength(svg, "utf8")} bytes`);
  const attributes = assertWellFormedXml(svg);
  assert.deepEqual(attributes.filter((name) => /^on/i.test(name)), [], "no event handler attributes");
  assert.ok(attributes.every((name) => /^[a-z][a-z0-9-]*$/i.test(name)), "only plain SVG attribute names");
}

/** Literal checks from the task: no `<script`, `href="http` or ` on…=` anywhere. */
function assertNoActiveContentText(svg: string) {
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /href="http/i);
  assert.doesNotMatch(svg, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(svg, /javascript:/i);
}

test("tire illustration is deterministic byte for byte", () => {
  for (const tire of demoTires) {
    const first = renderTireIllustrationSvg(tire);
    const second = renderTireIllustrationSvg(structuredClone(tire));
    assert.equal(first, second);
    assert.equal(tireIllustrationDataUri(tire), tireIllustrationDataUri({ ...tire }));
    assert.deepEqual(getTireIllustrationSpec(tire), getTireIllustrationSpec({ ...tire }));
  }
});

test("every demo tire gets its own drawing and its own tread pattern", () => {
  const svgs = demoTires.map((tire) => renderTireIllustrationSvg(tire));
  const tiles = svgs.map(tile);
  assert.equal(new Set(svgs).size, demoTires.length);
  assert.equal(new Set(tiles).size, demoTires.length, "tread tiles differ, not only the lettering");
  const seeds = demoTires.map((tire) => getTireIllustrationSpec(tire).seed);
  assert.equal(new Set(seeds).size, demoTires.length);
});

test("tread family follows season and all-terrain naming", () => {
  const families = Object.fromEntries(demoTires.map((tire) => [tire.model, getTireIllustrationSpec(tire).family]));
  assert.deepEqual(families, {
    "Pilot Sport 5": "summer",
    "PremiumContact 7": "summer",
    "Hakkapeliitta 10": "winter",
    "Ice Zero FR": "winter",
    "Eagle F1 Asymmetric 6": "summer",
    "Geolandar A/T G015": "all-terrain",
    "Turanza 6": "summer",
    "Kinergy 4S2": "all-season",
  });
  assert.equal(getTireIllustrationSpec({ ...baseTire, model: "Eagle F1 Asymmetric 6" }).variant, "asymmetric");
  assert.equal(getTireIllustrationSpec({ ...baseTire, model: "Dynapro AT2" }).family, "all-terrain");
  assert.equal(getTireIllustrationSpec({ ...baseTire, model: "Wildpeak", tags: ["All Terrain"] }).family, "all-terrain");
  assert.equal(getTireIllustrationSpec({ ...baseTire, model: "Grabber A/T" }).family, "all-terrain");
  assert.equal(getTireIllustrationSpec({ ...baseTire, model: "Geolandar H/T G056" }).family, "summer");
  assert.equal(getTireIllustrationSpec({ ...baseTire, brand: "Matador", model: "Hectorra 5" }).family, "summer");

  // Same brand and model: a different season switches the whole pattern family.
  const summer = renderTireIllustrationSvg(baseTire);
  const winter = renderTireIllustrationSvg({ ...baseTire, season: "winter" });
  const allSeason = renderTireIllustrationSvg({ ...baseTire, season: "all-season" });
  const offRoad = renderTireIllustrationSvg({ ...baseTire, tags: ["A/T"] });
  assert.equal(new Set([summer, winter, allSeason, offRoad].map(tile)).size, 4);
  assert.equal(getTireIllustrationSpec({ ...baseTire, season: "winter" }).family, "winter");
  assert.ok(getTireIllustrationSpec({ ...baseTire, season: "winter" }).sipeDensity >= 2, "winter tires get lamellas");
  assert.ok(getTireIllustrationSpec({ ...baseTire, tags: ["A/T"] }).pitchCount <= 40, "A/T tires get big blocks");
});

test("studs are drawn only for studded tires", () => {
  for (const tire of demoTires) {
    const svg = renderTireIllustrationSvg(tire);
    assert.equal(svg.includes('id="studs"'), tire.studded, tire.model);
    assert.equal(svg.includes('data-badge="studs"'), tire.studded, tire.model);
    assert.equal(getTireIllustrationSpec(tire).studsPerPitch > 0, tire.studded);
  }
  const studdedSummer = renderTireIllustrationSvg({ ...baseTire, studded: true });
  assert.ok(studdedSummer.includes('id="studs"'));
  const winterFriction = renderTireIllustrationSvg({ ...baseTire, season: "winter", studded: false });
  assert.ok(!winterFriction.includes('id="studs"'));
});

test("season badge and XL / RunFlat marks follow the product", () => {
  assert.match(renderTireIllustrationSvg(baseTire), /data-badge="summer"/);
  assert.match(renderTireIllustrationSvg({ ...baseTire, season: "winter" }), /data-badge="winter"/);
  assert.match(renderTireIllustrationSvg({ ...baseTire, season: "all-season" }), /data-badge="all-season"/);
  assert.doesNotMatch(renderTireIllustrationSvg({ ...baseTire, season: "none" }), /data-badge="(summer|winter|all-season)"/);

  const plain = renderTireIllustrationSvg(baseTire);
  assert.doesNotMatch(plain, /data-mark=/);
  assert.match(renderTireIllustrationSvg({ ...baseTire, xl: true }), /data-mark="XL"/);
  assert.match(renderTireIllustrationSvg({ ...baseTire, tags: ["XL"] }), /data-mark="XL"/);
  assert.match(renderTireIllustrationSvg({ ...baseTire, runflat: true }), /data-mark="RUNFLAT"/);
});

test("product text is escaped, stripped of control characters and emoji", () => {
  const fromTask = renderTireIllustrationSvg({ ...baseTire, brand: `<script>"&'`, model: "Зимняя 😀 модель ❄️" });
  assertSafeSvg(fromTask);
  assertNoActiveContentText(fromTask);
  assert.ok(fromTask.includes("&lt;SCRIPT&gt;&quot;&amp;&apos;"));
  assert.ok(fromTask.includes("ЗИМНЯЯ МОДЕЛЬ"));
  assert.doesNotMatch(fromTask, /\p{Extended_Pictographic}/u);

  // Markup inside product names stays inert escaped text.
  const hostile: TireIllustrationInput = {
    ...baseTire,
    brand: `<script>"&'`,
    model: "Зимняя 😀 модель\u0007‮ 🇷🇺 <img src=x onerror=alert(1)>",
    tags: ["<b>XL</b>", "x".repeat(500)],
  };
  const svg = renderTireIllustrationSvg(hostile);
  assertSafeSvg(svg);
  assert.ok(svg.includes("&lt;SCRIPT&gt;&quot;&amp;&apos;"), "brand is escaped, not dropped");
  assert.ok(svg.includes("ЗИМНЯЯ МОДЕЛЬ"), "Cyrillic is kept");
  assert.doesNotMatch(svg, /\p{Extended_Pictographic}|\p{Regional_Indicator}/u);
  assert.doesNotMatch(svg, /[\u0000-\u0008\u000B\u000C\u000E-\u001F‮]/);
  assert.doesNotMatch(svg, /<img/i);
  assert.ok(svg.includes("&lt;IMG SRC=X ONERROR=ALERT(1)&gt;"));

  const alt = tireIllustrationAlt(hostile);
  assert.ok(alt.startsWith("Иллюстрация шины "));
  assert.doesNotMatch(alt, /\p{Extended_Pictographic}|[\u0000-\u001F‮]/u);

  const uri = tireIllustrationDataUri(hostile);
  assert.ok(uri.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.equal(decodeURIComponent(uri.slice("data:image/svg+xml;charset=utf-8,".length)), svg);
  assert.doesNotMatch(uri, /[<>"' ]/);
});

test("long names and odd numbers do not break the drawing", () => {
  const longName: TireIllustrationInput = {
    ...baseTire,
    brand: "Очень Длинное Название Производителя Шин Для Проверки Вёрстки Боковины",
    model: "Super Long Model Name With Many Words And Numbers 2026 Extreme Grip Edition Ultra",
    xl: true,
    runflat: true,
    studded: true,
    season: "winter",
  };
  const svg = renderTireIllustrationSvg(longName);
  assertSafeSvg(svg);
  // Inputs are cut to 60 characters before drawing.
  const lettering = [...svg.matchAll(/<textPath[^>]*>([^<]*)/g)].map((match) => match[1]);
  for (const text of lettering) assert.ok(Array.from(text).length <= 60, text);
  // Every text run declares a textLength so it cannot run past its arc.
  for (const match of svg.matchAll(/<textPath[^>]*>/g)) {
    assert.match(match[0], /textLength="[\d.]+" lengthAdjust="spacingAndGlyphs"/);
  }

  for (const numbers of [
    { width: Number.NaN, profile: 0, diameter: -5 },
    { width: 10_000, profile: 1, diameter: 99 },
    { width: 31, profile: 10.5, diameter: 15 },
  ]) {
    assertSafeSvg(renderTireIllustrationSvg({ ...baseTire, ...numbers }));
  }
  assert.equal(tireIllustrationAlt({ ...baseTire, width: Number.NaN, profile: 0, diameter: 0 }), "Иллюстрация шины Michelin Pilot Sport 5");
});

test("alt text names the tire and says it is an illustration", () => {
  assert.equal(tireIllustrationAlt(baseTire), "Иллюстрация шины Michelin Pilot Sport 5, 225/45 R18");
  assert.equal(tireIllustrationAlt({ ...baseTire, brand: "", model: "" }), "Иллюстрация шины, 225/45 R18");
});

test("all demo tires produce safe SVG under 20 KB quickly", () => {
  for (const tire of demoTires) {
    const svg = renderTireIllustrationSvg(tire);
    assertSafeSvg(svg);
    assertNoActiveContentText(svg);
  }
  const worstCase = renderTireIllustrationSvg({
    ...baseTire,
    brand: "W".repeat(80),
    model: "Ж".repeat(80),
    season: "winter",
    studded: true,
    runflat: true,
    xl: true,
    width: 405,
    profile: 25,
    diameter: 26,
  });
  assertSafeSvg(worstCase);

  const started = performance.now();
  for (let index = 0; index < 96; index += 1) {
    const tire = demoTires[index % demoTires.length];
    tireIllustrationDataUri({ ...tire, model: `${tire.model} ${index}` });
  }
  assert.ok(performance.now() - started < 1500, "96 catalog cards render well under a frame budget per card");
});

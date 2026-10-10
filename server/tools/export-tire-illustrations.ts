import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedProducts, seasonLabels } from "../../lib/catalog-data";
import {
  escapeXml,
  formatTireSize,
  getTireIllustrationSpec,
  renderTireIllustrationSvg,
  tireIllustrationAlt,
} from "../../lib/tire-illustration";
import { createEntitySlug } from "../utils/product-slug";

/**
 * Writes one SVG illustration per demo tire plus an index.html preview grid.
 * Usage: pnpm images:tires [outputDir]   (default: outputs/tire-illustrations)
 */

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function latinSlug(value: string): string {
  const transliterated = Array.from(value.normalize("NFKC").toLocaleLowerCase("ru"))
    .map((character) => CYRILLIC_TO_LATIN[character] ?? character)
    .join("")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "");
  return (
    createEntitySlug(transliterated)
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "tire"
  );
}

async function main() {
  const outputDirectory = path.resolve(process.argv[2] ?? "outputs/tire-illustrations");
  await mkdir(outputDirectory, { recursive: true });

  const tires = seedProducts.filter((product) => product.kind === "tire");
  const usedNames = new Set<string>();
  const entries: Array<{ file: string; caption: string; details: string; alt: string }> = [];

  for (const tire of tires) {
    const size = formatTireSize(tire);
    let base = latinSlug(`${tire.brand} ${tire.model} ${size.replace("/", "-")}`);
    for (let suffix = 2; usedNames.has(base); suffix += 1) base = `${base}-${suffix}`;
    usedNames.add(base);
    const file = `${base}.svg`;
    await writeFile(path.join(outputDirectory, file), renderTireIllustrationSvg(tire), "utf8");
    const spec = getTireIllustrationSpec(tire);
    entries.push({
      file,
      caption: `${tire.brand} ${tire.model}`,
      details: [
        size,
        seasonLabels[tire.season],
        tire.studded ? "шипы" : "",
        `${spec.family} / ${spec.variant}`,
        `${spec.pitchCount} шагов`,
      ]
        .filter(Boolean)
        .join(" · "),
      alt: tireIllustrationAlt(tire),
    });
  }

  const cards = entries
    .map(
      (entry) => `<figure>
  <img src="${escapeXml(entry.file)}" alt="${escapeXml(entry.alt)}" width="400" height="400">
  <figcaption><strong>${escapeXml(entry.caption)}</strong><span>${escapeXml(entry.details)}</span><code>${escapeXml(entry.file)}</code></figcaption>
</figure>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Иллюстрации шин</title>
<style>
  body { margin: 0; padding: 24px; background: #f4f2ec; color: #161816; font-family: Arial, Helvetica, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 0 0 20px; color: #777b73; font-size: 13px; }
  main { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  figure { margin: 0; border: 1px solid #dedbd3; border-radius: 6px; background: linear-gradient(145deg, #f7f5f0, #ebe8df); overflow: hidden; }
  img { display: block; width: 100%; height: auto; aspect-ratio: 1; }
  figcaption { display: grid; gap: 3px; padding: 10px 12px 12px; background: #fff; font-size: 12px; }
  figcaption span { color: #777b73; }
  code { color: #9a9d95; font-size: 10px; word-break: break-all; }
  @media (max-width: 900px) { main { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
</head>
<body>
<h1>Иллюстрации шин APEX WHEELS</h1>
<p>Детерминированные SVG из атрибутов товара. Это иллюстрации, а не фотографии.</p>
<main>
${cards}
</main>
</body>
</html>
`;
  await writeFile(path.join(outputDirectory, "index.html"), html, "utf8");

  console.log(`Иллюстрации шин сохранены в ${outputDirectory}:`);
  for (const entry of entries) console.log(`  ${entry.file}`);
  console.log("  index.html");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

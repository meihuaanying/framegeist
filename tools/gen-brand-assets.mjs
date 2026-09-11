// Downloads Simple Icons (CC0-1.0) brand SVGs, rasterizes black+white PNG
// variants into templates/assets/brand/ (+ web/brand mirror for the picker).
// Usage: node tools/gen-brand-assets.mjs
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const SLUGS = [
  "sony", "canon", "nikon", "fujifilm", "leica", "hasselblad", "panasonic",
  "ricoh", "sigma", "zeiss", "dji", "xiaomi", "apple", "tamron", "epson",
  "olympus", "pentax", "gopro", "insta360", "sandisk",
];

const OUT = "templates/assets/brand";
const WEB = "web/brand";
mkdirSync(OUT, { recursive: true });
mkdirSync(WEB, { recursive: true });
const dirFor = (kind) => ({ brand: [OUT, WEB], series: ["templates/assets/series", "web/series"], game: ["templates/assets/game", "web/game"] }[kind]);

const RAW = "https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons";
const SIZE = 512;

const credits = [];
for (const slug of SLUGS) {
  let svg;
  try {
    const res = await fetch(`${RAW}/${slug}.svg`, { headers: { "user-agent": "FrameGeist/0.2" } });
    if (!res.ok) { console.log(`${slug}: HTTP ${res.status} (skip)`); continue; }
    svg = await res.text();
  } catch (e) {
    console.log(`${slug}: fetch ${e.message} (skip)`);
    continue;
  }
  const withFill = (color) =>
    svg.replace("<svg ", `<svg fill="${color}" `).replace(/fill="currentColor"/g, `fill="${color}"`);
  for (const [variant, color] of [["", "#000000"], ["-light", "#ffffff"]]) {
    try {
      const resvg = new Resvg(withFill(color), { fitTo: { mode: "height", value: SIZE } });
      const png = resvg.render().asPng();
      const file = `${slug}${variant}.png`;
      writeFileSync(join(OUT, file), png);
      writeFileSync(join(WEB, file), png);
      console.log(`${file}: ${(png.length / 1024).toFixed(1)} KB`);
    } catch (e) {
      console.log(`${slug}${variant}: rasterize failed: ${e.message}`);
    }
  }
  credits.push({ slug, source: `https://github.com/simple-icons/simple-icons/blob/develop/icons/${slug}.svg` });
}

writeFileSync(
  join(OUT, "CREDITS.json"),
  JSON.stringify(
    {
      source: "Simple Icons (https://simpleicons.org) + rendered wordmarks",
      license: "CC0-1.0 (icon files); brand names and logos remain trademarks of their owners",
      disclaimer:
        "Icons are used to indicate the camera/lens brand of the photo's EXIF metadata. No endorsement implied.",
      icons: credits,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nicons done: ${credits.length} brands`);

// ---- wordmarks for brands absent from Simple Icons (rendered from OFL fonts,
// NOT official logo artwork) ----
const FONT_DIR = "templates/assets/fonts";
const WORDMARKS = [
  { slug: "canon", text: "Canon", font: "CormorantGaramond-Regular.ttf", weight: 600, spacing: 0 },
  { slug: "ricoh", text: "RICOH", font: "Inter-Regular.ttf", weight: 700, spacing: 6 },
  { slug: "sigma", text: "SIGMA", font: "SpaceGrotesk-Regular.ttf", weight: 700, spacing: 8 },
  { slug: "zeiss", text: "ZEISS", font: "Inter-Regular.ttf", weight: 300, spacing: 14 },
  { slug: "hasselblad", text: "HASSELBLAD", font: "CormorantGaramond-Regular.ttf", weight: 600, spacing: 4 },
  { slug: "olympus", text: "OLYMPUS", font: "CormorantGaramond-Regular.ttf", weight: 600, spacing: 4 },
  { slug: "pentax", text: "PENTAX", font: "SpaceGrotesk-Regular.ttf", weight: 600, spacing: 8 },
  { slug: "tamron", text: "TAMRON", font: "SpaceGrotesk-Regular.ttf", weight: 700, spacing: 6 },
];
const wordCredits = [];
const SERIES = [
  { slug: "sony-gm", text: "GM", font: "SpaceGrotesk-Regular.ttf", weight: 700, spacing: 2 },
  { slug: "canon-l", text: "L", font: "CormorantGaramond-Regular.ttf", weight: 700, spacing: 0 },
  { slug: "nikon-s", text: "S", font: "SpaceGrotesk-Regular.ttf", weight: 700, spacing: 0 },
  { slug: "sigma-art", text: "ART", font: "SpaceGrotesk-Regular.ttf", weight: 700, spacing: 6 },
  { slug: "sigma-dgdn", text: "DG DN", font: "SpaceGrotesk-Regular.ttf", weight: 500, spacing: 4 },
  { slug: "hasselblad-xcd", text: "XCD", font: "Inter-Regular.ttf", weight: 600, spacing: 6 },
  { slug: "fujifilm-xf", text: "XF", font: "Inter-Regular.ttf", weight: 700, spacing: 4 },
];
const GAMES = [
  { slug: "genshin", text: "GENSHIN", font: "CormorantGaramond-Regular.ttf", weight: 700, spacing: 8, size: 0.42 },
  { slug: "zzz", text: "ZZZ", font: "SpaceGrotesk-Regular.ttf", weight: 700, spacing: 10, size: 0.42 },
  { slug: "honkai", text: "HONKAI", font: "SpaceGrotesk-Regular.ttf", weight: 600, spacing: 8, size: 0.42 },
  { slug: "arknights", text: "ARKNIGHTS", font: "Oswald-Regular.ttf", weight: 600, spacing: 6, size: 0.42 },
  { slug: "wwmeet", text: "\u71d5\u4e91\u5341\u516d\u58f0", font: "MaShanZheng-Regular.ttf", weight: 400, spacing: 2, size: 0.62 },
  { slug: "wukong", text: "WUKONG", font: "Oswald-Regular.ttf", weight: 700, spacing: 10, size: 0.42 },
];

const GROUPS = [
  { kind: "brand", items: WORDMARKS },
  { kind: "series", items: SERIES },
  { kind: "game", items: GAMES },
];
for (const { kind, items } of GROUPS) {
  const dirs = dirFor(kind);
  mkdirSync(dirs[0], { recursive: true });
  mkdirSync(dirs[1], { recursive: true });
  for (const w of items) {
  const fontPath = join(FONT_DIR, w.font);
  if (!existsSync(fontPath)) { console.log(`${w.slug}: font missing, skip`); continue; }
  const H = SIZE;
  const ratio = w.size ?? 0.42;
  const cjk = /[\u4e00-\u9fff]/.test(w.text);
  const fontSize = Math.round(H * ratio);
  const perChar = cjk ? 1.05 : 0.62;
  const width = Math.round(w.text.length * fontSize * perChar + w.spacing * w.text.length + 40);
  const svgFor = (color) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}">` +
    `<text x="50%" y="50%" fill="${color}" font-family="Wordmark" font-size="${fontSize}" ` +
    `font-weight="${w.weight}" letter-spacing="${w.spacing}" text-anchor="middle" dominant-baseline="central">${w.text}</text></svg>`;
  for (const [variant, color] of [["", "#000000"], ["-light", "#ffffff"]]) {
    try {
      const resvg = new Resvg(svgFor(color), {
        fitTo: { mode: "height", value: H },
        font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "Wordmark" },
      });
      const png = resvg.render().asPng();
      writeFileSync(join(dirs[0], `${w.slug}${variant}.png`), png);
      writeFileSync(join(dirs[1], `${w.slug}${variant}.png`), png);
    } catch (e) {
      console.log(`${w.slug}${variant}: wordmark failed: ${e.message}`);
    }
  }
  wordCredits.push({ slug: w.slug, kind, font: w.font });
  console.log(`${kind} ${w.slug}.png`);
  }
}
writeFileSync(
  join(OUT, "CREDITS.json"),
  JSON.stringify(
    {
      source: "Simple Icons (https://simpleicons.org) + framegeist-rendered wordmarks (OFL fonts)",
      license: "CC0-1.0 (icon files); wordmarks rendered from OFL fonts; brand names remain trademarks of their owners",
      disclaimer:
        "Icons/wordmarks indicate the camera/lens brand from EXIF metadata. No endorsement implied.",
      icons: credits,
      wordmarks: wordCredits,
    },
    null,
    2,
  ) + "\n",
);
const slugs = Array.from(new Set([...credits.map(c => c.slug), ...wordCredits.filter(w => w.kind === "brand").map(w => w.slug)])).sort();
writeFileSync(join(WEB, "index.json"), JSON.stringify(slugs, null, 2) + "\n");
console.log(`brand index: ${slugs.length} slugs`);
console.log("all brand assets done");

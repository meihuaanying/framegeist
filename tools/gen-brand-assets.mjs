// Generates the v0.7.0 badge asset set:
//  - brand/   official Simple Icons (CC0) when available, otherwise an
//             original typographic wordmark (never official logo artwork)
//  - lockup/  original typographic lockups for EVERY brand slug (the editor
//             "original" style; free of official graphical elements)
//  - series/  lens-series emblems (GM/G, L/RF L, Art/DG DN, XCD/XF, Z S-Line,
//             Batis, APO, SP)
//  - game/    original game wordmarks (no official assets)
// All variants are rendered black + white at 512px height with @resvg/resvg-js.
// Usage: node tools/gen-brand-assets.mjs
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const FONT_DIR = "templates/assets/fonts";
const SIZE = 512;

const OFFICIAL_SLUGS = [
  // cameras / lenses / accessories
  "sony", "canon", "nikon", "fujifilm", "leica", "hasselblad", "panasonic",
  "ricoh", "sigma", "zeiss", "dji", "apple", "tamron", "epson", "olympus",
  "pentax", "gopro", "insta360", "sandisk", "phaseone", "profoto", "smallrig",
  // phones / tablets / laptops
  "samsung", "vivo", "oppo", "oneplus", "huawei", "honor", "google",
  "motorola", "nokia", "blackmagicdesign",
];

// Original typographic wordmarks (OFL fonts) for brands without an official
// Simple Icons glyph, plus all lens brands that never ship vector marks.
const WORDMARKS = [
  { slug: "canon", text: "Canon", font: "CormorantGaramond-600.ttf", weight: 600, spacing: 0 },
  { slug: "ricoh", text: "RICOH", font: "Inter-700.ttf", weight: 700, spacing: 6 },
  { slug: "sigma", text: "SIGMA", font: "SpaceGrotesk-700.ttf", weight: 700, spacing: 8 },
  { slug: "zeiss", text: "ZEISS", font: "Inter-400.ttf", weight: 400, spacing: 14 },
  { slug: "hasselblad", text: "HASSELBLAD", font: "InstrumentSans-600.ttf", weight: 600, spacing: 4 },
  { slug: "olympus", text: "OLYMPUS", font: "Inter-500.ttf", weight: 500, spacing: 10 },
  { slug: "pentax", text: "PENTAX", font: "SpaceGrotesk-600.ttf", weight: 600, spacing: 8 },
  { slug: "tamron", text: "TAMRON", font: "SpaceGrotesk-700.ttf", weight: 700, spacing: 6 },
  { slug: "viltrox", text: "VILTROX", font: "Geist-700.ttf", weight: 700, spacing: 6 },
  { slug: "laowa", text: "LAOWA", font: "Geist-600.ttf", weight: 600, spacing: 10 },
  { slug: "ttartisan", text: "TTArtisan", font: "Geist-600.ttf", weight: 600, spacing: 0 },
  { slug: "tokina", text: "TOKINA", font: "Geist-700.ttf", weight: 700, spacing: 6 },
  { slug: "samyang", text: "SAMYANG", font: "Geist-600.ttf", weight: 600, spacing: 8 },
  { slug: "meike", text: "MEIKE", font: "Geist-700.ttf", weight: 700, spacing: 6 },
  { slug: "7artisans", text: "7Artisans", font: "Geist-600.ttf", weight: 600, spacing: 0 },
  { slug: "sirui", text: "SIRUI", font: "Geist-700.ttf", weight: 700, spacing: 10 },
  { slug: "yongnuo", text: "YONGNUO", font: "Geist-600.ttf", weight: 600, spacing: 6 },
  { slug: "voigtlander", text: "VOIGTLANDER", font: "InstrumentSerif-400.ttf", weight: 400, spacing: 6 },
  { slug: "phaseone", text: "PHASE ONE", font: "Geist-600.ttf", weight: 600, spacing: 8 },
  { slug: "blackmagicdesign", text: "BLACKMAGIC", font: "Geist-700.ttf", weight: 700, spacing: 6 },
];

// Lockups: typographic render for every brand (Q2 "原创 lockup 可切换").
const LOCKUPS = [
  ...new Set([...OFFICIAL_SLUGS, ...WORDMARKS.map((w) => w.slug)]),
].map((slug) => ({ slug, text: slug === "7artisans" ? "7Artisans" : slug.toUpperCase(), font: "Geist-600.ttf", weight: 600, spacing: 8 }));

const SERIES = [
  { slug: "sony-gm", text: "GM", font: "Geist-700.ttf", weight: 700, spacing: 2 },
  { slug: "sony-g", text: "G", font: "Geist-600.ttf", weight: 600, spacing: 0 },
  { slug: "canon-l", text: "L", font: "InstrumentSerif-400.ttf", weight: 400, spacing: 0 },
  { slug: "canon-rf-l", text: "RF L", font: "Geist-600.ttf", weight: 600, spacing: 4 },
  { slug: "nikon-s", text: "S", font: "Geist-700.ttf", weight: 700, spacing: 0 },
  { slug: "sigma-art", text: "ART", font: "Geist-700.ttf", weight: 700, spacing: 6 },
  { slug: "sigma-dgdn", text: "DG DN", font: "Geist-500.ttf", weight: 500, spacing: 4 },
  { slug: "sigma-apo", text: "APO", font: "Geist-600.ttf", weight: 600, spacing: 8 },
  { slug: "hasselblad-xcd", text: "XCD", font: "Geist-600.ttf", weight: 600, spacing: 6 },
  { slug: "fujifilm-xf", text: "XF", font: "Geist-700.ttf", weight: 700, spacing: 4 },
  { slug: "zeiss-batis", text: "BATIS", font: "Geist-500.ttf", weight: 500, spacing: 8 },
  { slug: "leica-apo", text: "APO", font: "InstrumentSerif-400.ttf", weight: 400, spacing: 8 },
  { slug: "tamron-sp", text: "SP", font: "Geist-700.ttf", weight: 700, spacing: 4 },
];

const GAMES = [
  { slug: "genshin", text: "GENSHIN", font: "CormorantGaramond-700.ttf", weight: 700, spacing: 8, size: 0.42 },
  { slug: "zzz", text: "ZZZ", font: "Unbounded-700.ttf", weight: 700, spacing: 10, size: 0.42 },
  { slug: "honkai", text: "HONKAI", font: "Geist-600.ttf", weight: 600, spacing: 8, size: 0.42 },
  { slug: "arknights", text: "ARKNIGHTS", font: "Oswald-600.ttf", weight: 600, spacing: 6, size: 0.42 },
  { slug: "wwmeet", text: "\u71d5\u4e91\u5341\u516d\u58f0", font: "MaShanZheng-400.ttf", weight: 400, spacing: 2, size: 0.62 },
  { slug: "wukong", text: "WUKONG", font: "Oswald-700.ttf", weight: 700, spacing: 10, size: 0.42 },
];

const DIRS = {
  brand: ["templates/assets/brand", "web/brand"],
  lockup: ["templates/assets/lockup", "web/lockup"],
  series: ["templates/assets/series", "web/series"],
  game: ["templates/assets/game", "web/game"],
};
for (const [a, b] of Object.values(DIRS)) {
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
}

function renderVariants(entry, svgFor) {
  const fontPath = join(FONT_DIR, entry.font);
  if (!existsSync(fontPath)) {
    console.log(`${entry.slug}: font ${entry.font} missing, skip`);
    return false;
  }
  let ok = false;
  for (const [variant, color] of [["", "#000000"], ["-light", "#ffffff"]]) {
    try {
      const resvg = new Resvg(svgFor(color, fontPath), {
        fitTo: { mode: "height", value: SIZE },
        font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "Wordmark" },
      });
      const png = resvg.render().asPng();
      for (const dir of DIRS[entry.kind]) writeFileSync(join(dir, `${entry.slug}${variant}.png`), png);
      ok = true;
    } catch (e) {
      console.log(`${entry.slug}${variant}: ${e.message}`);
    }
  }
  return ok;
}

function wordmarkSvg(entry) {
  const H = SIZE;
  const ratio = entry.size ?? 0.42;
  const cjk = /[\u4e00-\u9fff]/.test(entry.text);
  const fontSize = Math.round(H * ratio);
  const perChar = cjk ? 1.05 : 0.62;
  const width = Math.round(entry.text.length * fontSize * perChar + entry.spacing * entry.text.length + 40);
  return (color) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}">` +
    `<text x="50%" y="50%" fill="${color}" font-family="Wordmark" font-size="${fontSize}" ` +
    `font-weight="${entry.weight}" letter-spacing="${entry.spacing}" text-anchor="middle" dominant-baseline="central">${entry.text}</text></svg>`;
}

// ---------------------------------------------------------------- official
const RAW = "https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons";
const iconSlugs = [];
for (const slug of OFFICIAL_SLUGS) {
  let svg;
  try {
    const res = await fetch(`${RAW}/${slug}.svg`, { headers: { "user-agent": "FrameGeist/0.7" } });
    if (!res.ok) { console.log(`brand ${slug}: HTTP ${res.status} (fallback to wordmark)`); continue; }
    svg = await res.text();
  } catch (e) {
    console.log(`brand ${slug}: fetch ${e.message} (fallback to wordmark)`);
    continue;
  }
  const withFill = (color) =>
    svg.replace("<svg ", `<svg fill="${color}" `).replace(/fill="currentColor"/g, `fill="${color}"`);
  let ok = false;
  for (const [variant, color] of [["", "#000000"], ["-light", "#ffffff"]]) {
    try {
      const resvg = new Resvg(withFill(color), { fitTo: { mode: "height", value: SIZE } });
      const png = resvg.render().asPng();
      for (const dir of DIRS.brand) writeFileSync(join(dir, `${slug}${variant}.png`), png);
      ok = true;
    } catch (e) {
      console.log(`brand ${slug}${variant}: ${e.message}`);
    }
  }
  if (ok) iconSlugs.push(slug);
}
console.log(`official icons: ${iconSlugs.length}/${OFFICIAL_SLUGS.length}`);

// ------------------------------------------------- wordmarks (brand fallback)
const wordCredits = [];
for (const w of WORDMARKS) {
  const kind = "brand";
  if (iconSlugs.includes(w.slug)) {
    // Official Simple Icons mark wins for the "official" style (Q2 default).
    wordCredits.push({ slug: w.slug, kind, font: w.font, note: "official icon preferred" });
    continue;
  }
  if (renderVariants({ ...w, kind }, wordmarkSvg(w))) {
    wordCredits.push({ slug: w.slug, kind, font: w.font });
    console.log(`brand wordmark ${w.slug}.png`);
  }
}

// ------------------------------------------------------------------- lockups
const lockupCredits = [];
for (const l of LOCKUPS) {
  if (renderVariants({ ...l, kind: "lockup" }, wordmarkSvg(l))) {
    lockupCredits.push({ slug: l.slug, font: l.font });
  }
}
console.log(`lockups: ${lockupCredits.length}`);

// --------------------------------------------------------------- series/game
for (const [kind, items] of [["series", SERIES], ["game", GAMES]]) {
  for (const item of items) {
    if (renderVariants({ ...item, kind }, wordmarkSvg(item))) console.log(`${kind} ${item.slug}.png`);
  }
}

// ------------------------------------------------------------------ credits
writeFileSync(
  join(DIRS.brand[0], "CREDITS.json"),
  JSON.stringify(
    {
      source: "Simple Icons (https://simpleicons.org) + original FrameGeist typographic wordmarks/lockups (OFL fonts)",
      license:
        "CC0-1.0 (icon files); wordmarks/lockups rendered from OFL fonts by this project; brand names and logos remain trademarks of their owners",
      disclaimer:
        "Icons/wordmarks/lockups are used to indicate the camera/lens/device brand from EXIF metadata. No endorsement or affiliation is implied.",
      officialIcons: iconSlugs,
      wordmarks: wordCredits,
      lockups: lockupCredits.map((l) => l.slug),
    },
    null,
    2,
  ) + "\n",
);

const allSlugs = Array.from(new Set([...iconSlugs, ...wordCredits.map((w) => w.slug), ...lockupCredits.map((l) => l.slug)])).sort();
writeFileSync(join(DIRS.brand[1], "index.json"), JSON.stringify(allSlugs, null, 2) + "\n");
writeFileSync(join(DIRS.lockup[1], "index.json"), JSON.stringify(allSlugs, null, 2) + "\n");
console.log(`brand index: ${allSlugs.length} slugs`);
console.log("all brand assets done");

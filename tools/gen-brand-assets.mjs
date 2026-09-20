// Generates the v0.8.0 badge asset library:
//  - brand/   official Simple Icons (CC0) when available, otherwise an
//             original typographic wordmark (never official logo artwork)
//  - lockup/  original typographic lockups for EVERY brand slug ("original" style)
//  - series/  lens-series emblems (GM/G, L/RF L, Art/DG DN, XCD/XF, Batis, APO, SP)
//  - game/    original game wordmarks (no official assets)
//  - brand/exif-auto  neutral "EXIF" marker for expression-based template cards
// Each item is rendered black + white at 512px (templates/CLI) and 96px thumbs
// (web library grid) with @resvg/resvg-js. Also writes web/brand/index.json v2
// with the camera/lens/series/game groups used by the editor badge library.
// Usage: node tools/gen-brand-assets.mjs
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const FONT_DIR = "templates/assets/fonts";
const SIZE = 512;
const THUMB = 96;

const OFFICIAL_SLUGS = [
  // cameras / lenses / accessories
  "sony", "canon", "nikon", "fujifilm", "leica", "hasselblad", "panasonic",
  "ricoh", "sigma", "zeiss", "dji", "apple", "tamron", "epson", "olympus",
  "pentax", "gopro", "insta360", "sandisk", "phaseone", "profoto", "smallrig",
  // phones / tablets / laptops
  "samsung", "vivo", "oppo", "oneplus", "huawei", "honor", "google",
  "motorola", "nokia", "blackmagicdesign",
];

// Lens-first brands (no camera make in EXIF Make) — wordmarks only.
const LENS_ONLY = [
  "viltrox", "laowa", "ttartisan", "tokina", "samyang", "meike",
  "7artisans", "sirui", "yongnuo", "voigtlander",
];

// Human-readable labels for the library grid (proper nouns stay as-is).
const LABELS = {
  sony: "Sony", canon: "Canon", nikon: "Nikon", fujifilm: "Fujifilm", leica: "Leica",
  hasselblad: "Hasselblad", panasonic: "Lumix", ricoh: "Ricoh", sigma: "Sigma",
  zeiss: "Zeiss", dji: "DJI", apple: "Apple", tamron: "Tamron", epson: "Epson",
  olympus: "OM System", pentax: "Pentax", gopro: "GoPro", insta360: "Insta360",
  sandisk: "SanDisk", phaseone: "Phase One", profoto: "Profoto", smallrig: "SmallRig",
  samsung: "Samsung", vivo: "vivo", oppo: "OPPO", oneplus: "OnePlus", huawei: "Huawei",
  honor: "HONOR", google: "Google", motorola: "Motorola", nokia: "Nokia",
  blackmagicdesign: "Blackmagic", viltrox: "Viltrox", laowa: "Laowa",
  ttartisan: "TTArtisan", tokina: "Tokina", samyang: "Samyang", meike: "Meike",
  "7artisans": "7Artisans", sirui: "Sirui", yongnuo: "Yongnuo", voigtlander: "Voigtlander",
};

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
  // neutral marker shown on wall cards for expression-based templates
  { slug: "exif-auto", text: "EXIF", font: "GeistMono-500.ttf", weight: 500, spacing: 10 },
];

// Lockups: typographic render for every brand (Q2 "原创 lockup 可切换").
const LOCKUPS = [
  ...new Set([...OFFICIAL_SLUGS, ...WORDMARKS.filter((w) => w.slug !== "exif-auto").map((w) => w.slug)]),
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
  mkdirSync(join(a, "thumbs"), { recursive: true });
  mkdirSync(b, { recursive: true });
  mkdirSync(join(b, "thumbs"), { recursive: true });
}

function writeVariants(entry, render, label) {
  let ok = false;
  for (const [variant, color] of [["", "#000000"], ["-light", "#ffffff"]]) {
    for (const [size, sub] of [[SIZE, ""], [THUMB, "thumbs/"]]) {
      try {
        const png = render(color, size);
        for (const dir of DIRS[entry.kind]) writeFileSync(join(dir, `${sub}${entry.slug}${variant}.png`), png);
        ok = true;
      } catch (e) {
        console.log(`${label ?? entry.slug}${variant}@${size}: ${e.message}`);
      }
    }
  }
  return ok;
}

function renderWordmark(entry) {
  const fontPath = join(FONT_DIR, entry.font);
  if (!existsSync(fontPath)) {
    console.log(`${entry.slug}: font ${entry.font} missing, skip`);
    return false;
  }
  const svgFor = wordmarkSvg(entry);
  return writeVariants(entry, (color, size) => {
    const resvg = new Resvg(svgFor(color), {
      fitTo: { mode: "height", value: size },
      font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "Wordmark" },
    });
    return resvg.render().asPng();
  });
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
    const res = await fetch(`${RAW}/${slug}.svg`, { headers: { "user-agent": "FrameGeist/0.8" } });
    if (!res.ok) { console.log(`brand ${slug}: HTTP ${res.status} (fallback to wordmark)`); continue; }
    svg = await res.text();
  } catch (e) {
    console.log(`brand ${slug}: fetch ${e.message} (fallback to wordmark)`);
    continue;
  }
  const withFill = (color) =>
    svg.replace("<svg ", `<svg fill="${color}" `).replace(/fill="currentColor"/g, `fill="${color}"`);
  const ok = writeVariants({ kind: "brand", slug }, (color, size) => {
    const resvg = new Resvg(withFill(color), { fitTo: { mode: "height", value: size } });
    return resvg.render().asPng();
  });
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
  if (renderWordmark({ ...w, kind })) {
    wordCredits.push({ slug: w.slug, kind, font: w.font });
    console.log(`brand wordmark ${w.slug}.png`);
  }
}

// ------------------------------------------------------------------- lockups
const lockupCredits = [];
for (const l of LOCKUPS) {
  if (renderWordmark({ ...l, kind: "lockup" })) lockupCredits.push({ slug: l.slug, font: l.font });
}
console.log(`lockups: ${lockupCredits.length}`);

// --------------------------------------------------------------- series/game
for (const [kind, items] of [["series", SERIES], ["game", GAMES]]) {
  for (const item of items) {
    if (renderWordmark({ ...item, kind })) console.log(`${kind} ${item.slug}.png`);
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
      variants: "512px (assets) + 96px thumbs (web library)",
      neutral: "brand/exif-auto (original EXIF marker for expression-based templates)",
    },
    null,
    2,
  ) + "\n",
);

// -------------------------------------------------------- library manifest v2
const allSlugs = Array.from(new Set([...iconSlugs, ...WORDMARKS.map((w) => w.slug)])).sort()
  .filter((s) => s !== "exif-auto");
const cameraGroup = allSlugs.filter((s) => !LENS_ONLY.includes(s));
const lensGroup = allSlugs;
const label = (slug) => LABELS[slug] ?? slug.replace(/(^|-)([a-z])/g, (_, p, c) => `${p ? " " : ""}${c.toUpperCase()}`);
const item = (slug) => ({ slug, label: label(slug), official: iconSlugs.includes(slug) });
const manifest = {
  version: 2,
  generatedAt: new Date().toISOString(),
  neutral: "exif-auto",
  groups: {
    camera: cameraGroup.map(item),
    lens: lensGroup.map(item),
    series: SERIES.map((s) => ({ slug: s.slug, label: s.text, official: false })),
    game: GAMES.map((g) => ({ slug: g.slug, label: g.slug.toUpperCase(), official: false })),
  },
};
writeFileSync(join(DIRS.brand[1], "index.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(DIRS.lockup[1], "index.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`library manifest: camera ${manifest.groups.camera.length}, lens ${manifest.groups.lens.length}, series ${manifest.groups.series.length}, game ${manifest.groups.game.length}`);
console.log("all brand assets done");

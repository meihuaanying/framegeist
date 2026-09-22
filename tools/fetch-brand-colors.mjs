// Fetches official Simple Icons hex colors (CC0 metadata) via the GitHub
// Contents API (api.github.com; raw.githubusercontent is not always reachable)
// and locks the v0.9.0 color rule into tools/brand-colors.json.
//
// Rule (docs/V0.9.0-CONSTRAINTS.md appendix B):
//   colorful  <=>  s >= 0.18 && 0.10 <= l <= 0.90   (hex -> HSL)
// Pure black/white/grey brands stay monochrome (their official color IS mono).
//
// Usage: node tools/fetch-brand-colors.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const REPO = "simple-icons/simple-icons";
const REF = "develop";
const OUT = "tools/brand-colors.json";

// Brand slugs with official Simple Icons artwork (mirrors gen-brand-assets).
const OFFICIAL_SLUGS = [
  "sony", "canon", "nikon", "fujifilm", "leica", "hasselblad", "panasonic",
  "ricoh", "sigma", "zeiss", "dji", "apple", "tamron", "epson", "olympus",
  "pentax", "gopro", "insta360", "sandisk", "phaseone", "profoto", "smallrig",
  "samsung", "vivo", "oppo", "oneplus", "huawei", "honor", "google",
  "motorola", "nokia", "blackmagicdesign",
];

export function hexToHsl(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return { s, l };
}

export function isColorful(hex) {
  const { s, l } = hexToHsl(hex);
  return s >= 0.18 && l >= 0.1 && l <= 0.9;
}

async function apiRaw(path) {
  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const url = `https://api.github.com/repos/${REPO}/contents/${path}?ref=${REF}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github.raw",
          "user-agent": "FrameGeist/0.9",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt === 4) throw new Error(`${path}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
}

const raw = await apiRaw("data/simple-icons.json");
const data = JSON.parse(raw);
const bySlug = new Map();
const slugify = (t) => String(t).toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]+/g, "");
for (const item of data) {
  const slug = item.slug ?? slugify(item.title ?? "");
  bySlug.set(slug, item);
}

const icons = {};
const missing = [];
const colorful = [];
for (const slug of OFFICIAL_SLUGS) {
  const item = bySlug.get(slug) ?? bySlug.get(slugify(slug));
  if (!item?.hex) {
    missing.push(slug);
    continue;
  }
  const hex = String(item.hex).replace(/^#/, "").toUpperCase();
  const c = isColorful(hex);
  icons[slug] = { hex: `#${hex}`, colorful: c, title: item.title ?? slug };
  if (c) colorful.push(slug);
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const out = {
  version: 1,
  source: `${REPO}/data/simple-icons.json@${REF}`,
  rule: "isColorful: s >= 0.18 && 0.10 <= l <= 0.90 (hex->HSL)",
  generatedAt: new Date().toISOString(),
  monoOverride: previous?.monoOverride ?? [],
  icons,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`brand colors locked: ${Object.keys(icons).length} icons, ${colorful.length} colorful, ${missing.length} missing`);
if (missing.length) console.log(`missing: ${missing.join(", ")}`);
for (const slug of Object.keys(icons)) {
  const { hex, colorful: c } = icons[slug];
  console.log(`  ${slug.padEnd(18)} ${hex}  ${c ? "COLOR" : "mono"}`);
}

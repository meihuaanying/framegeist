// v0.7.0 M2: re-typesets all templates according to DESIGN-LANGUAGE v2
// (category style map, 3-level size hierarchy, weights 400-700, tracking,
// Inter tabular EXIF rows, CJK family choices, badge coverage).
//
// Deterministic: templates already at minEngineVersion 0.7.x are skipped
// unless --force. Usage:
//   node tools/apply-v070-typography.mjs [--dry] [--force] [--only id,id]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? new Set(process.argv[i + 1].split(",")) : null;
})();

const DIR = "templates";

// Q18 category style map.
const CAT_STYLE = {
  "white-border": "swiss",
  minimal: "swiss",
  "classic-watermark": "swiss",
  borderless: "swiss",
  magazine: "editorial",
  master: "editorial",
  portfolio: "editorial",
  personal: "japanese",
  calendar: "japanese",
  festival: "japanese",
  game: "street",
  colorful: "street",
  colorcard: "street",
  sports: "street",
  camera: "gear",
  film: "gear",
  phone: "gear",
  drone: "gear",
  fuji: "gear",
  effect: "mix",
  "blur-bg": "mix",
  colorwalk: "mix",
  polaroid: "mix",
  ticket: "mix",
};

// Q1: watermark/parameter categories that must carry a brand badge.
const NEED_BADGE = new Set([
  "portfolio", "classic-watermark", "minimal", "black-frame", "magazine",
  "master", "borderless", "blur-bg", "film", "phone", "colorwalk",
  "colorcard", "effect", "white-border", "camera", "drone", "fuji",
]);

const DISPLAY = {
  swiss: "Geist",
  editorial: "Fraunces",
  japanese: "Instrument Serif",
  street: "Unbounded",
  gear: "Geist",
};
const CJK_DISPLAY = {
  swiss: "Glow Sans SC",
  editorial: "Noto Serif SC",
  japanese: "LXGW WenKai",
  street: "Smiley Sans",
  gear: "Glow Sans SC",
};
const CJK_BODY = {
  swiss: "Glow Sans SC",
  editorial: "Noto Serif SC",
  japanese: "LXGW WenKai",
  street: "Smiley Sans",
  gear: "Glow Sans SC",
};
const SUPPORT = {
  swiss: "Inter",
  editorial: "Inter",
  japanese: "Inter",
  street: "Bricolage Grotesque",
  gear: "Geist Mono",
};
const LABEL = {
  swiss: "Inter",
  editorial: "Inter",
  japanese: "Inter",
  street: "Inter",
  gear: "Geist Mono",
};

const SERIF_ORIGINALS = new Set(["Fraunces", "Playfair Display", "Cormorant Garamond", "Instrument Serif", "Great Vibes"]);
const GROTESK_ORIGINALS = new Set(["Unbounded", "Bricolage Grotesque", "Space Grotesk", "Bebas Neue", "Oswald"]);
const CJK_ORIGINALS = new Set(["Ma Shan Zheng", "Noto Sans SC", "Noto Serif SC", "LXGW WenKai", "Glow Sans SC", "Sarasa Gothic SC", "Smiley Sans"]);

function hasCJK(s) {
  return /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(s);
}
function layerText(layer) {
  return (layer.content ?? []).map((i) => `${i.expr ?? ""} ${i.fallback ?? ""}`).join(" ");
}
function isData(layer) {
  return (layer.content ?? []).some(
    (i) => /date\(/.test(i.expr ?? "") || /\bexif\.(focal|aperture|shutter|iso|datetime|gps|weekday)/.test(i.expr ?? ""),
  );
}
function roleOf(layer) {
  if (layer.type !== "text") return null;
  if (isData(layer)) return "data";
  const size = layer.font?.size ?? 0.03;
  if (size >= 0.05) return "display";
  if (size < 0.022) return "label";
  return "support";
}
function effectiveStyle(style, original) {
  if (style !== "mix") return style;
  if (SERIF_ORIGINALS.has(original)) return "editorial";
  if (GROTESK_ORIGINALS.has(original)) return "street";
  return "swiss";
}
function mapFamily(style, role, cjk, original, category) {
  const signature = original === "Great Vibes" && ["personal", "magazine", "polaroid", "festival"].includes(category);
  if (signature) return "Great Vibes";
  if (cjk) {
    if (role === "data") return CJK_BODY[style];
    return role === "display" ? CJK_DISPLAY[style] : CJK_BODY[style];
  }
  if (role === "data") return style === "gear" ? "Geist Mono" : "Inter";
  if (role === "display") return DISPLAY[style];
  if (role === "support") return SUPPORT[style];
  return LABEL[style];
}
function weightFor(style, role) {
  if (role === "display") return style === "street" ? 700 : 600;
  if (role === "support") return 500;
  if (role === "data") return style === "gear" ? 500 : 400;
  return 500;
}
function trackingFor(style, role, cjk, current) {
  const cur = current ?? 0;
  if (role === "display") {
    if (cjk) return Math.min(Math.max(cur, 0), 0.02);
    return Math.abs(cur) > 0.001 ? cur : -0.02;
  }
  if (role === "label") return Math.max(cur, cjk ? 0.02 : 0.08);
  if (role === "data") return cur > 0.06 ? 0 : cur;
  return cur;
}

function normalizeTextItems(items) {
  for (const item of items ?? []) {
    for (const key of ["expr", "fallback"]) {
      if (typeof item[key] === "string" && item[key].includes(" | ")) {
        item[key] = item[key].replace(/ \| /g, " \u00b7 ");
      }
    }
  }
}

function transformTextLayer(layer, style, category, stats) {
  const role = roleOf(layer);
  const text = layerText(layer);
  const original = (layer.font?.family ?? [])[0] ?? "";
  const cjk = hasCJK(text) || CJK_ORIGINALS.has(original);
  const before = original;
  const family = mapFamily(style, role, cjk, original, category);
  layer.font.family = [family];
  layer.font.weight = weightFor(style, role);
  // DESIGN-LANGUAGE v2: never below ~8.5px at the 900px sample size.
  if ((layer.font.size ?? 0.03) < 0.0095) layer.font.size = 0.0095;
  layer.letterSpacing = Number(trackingFor(style, role, cjk, layer.letterSpacing).toFixed(4));
  if (role === "display" && (layer.lineHeight ?? 1.3) > 1.4) layer.lineHeight = 1.15;
  if ((role === "data" || role === "label") && /\d/.test(text) && !cjk) {
    const features = new Set(layer.font.features ?? layer.features ?? []);
    features.add("tnum");
    layer.features = [...features];
  }
  normalizeTextItems(layer.content);
  const key = `${before} -> ${family} [${role}/${style}]`;
  stats.set(key, (stats.get(key) ?? 0) + 1);
}

function walkLayers(layers, fn) {
  for (const layer of layers ?? []) {
    fn(layer);
    if (layer.type === "group") walkLayers(layer.children, fn);
  }
}

function cornerScore(layers) {
  const score = { "top-left": 0, "top-right": 0, "bottom-left": 0, "bottom-right": 0 };
  for (const layer of layers ?? []) {
    if (layer.type !== "text") continue;
    const a = String(layer.anchor ?? "");
    const v = a.startsWith("top") ? "top" : a.startsWith("bottom") ? "bottom" : "middle";
    const h = a.endsWith("left") ? "left" : a.endsWith("right") ? "right" : "center";
    if (v === "middle" && h === "center") continue;
    const vy = v === "middle" ? "bottom" : v;
    if (h === "center") { score[`${vy}-left`] += 0.5; score[`${vy}-right`] += 0.5; }
    else score[`${vy}-${h}`] += 1;
  }
  return score;
}

function ensureBadge(tpl, category, stats) {
  if (!NEED_BADGE.has(category)) return false;
  const hasBrand = (tpl.layers ?? []).some(
    (l) => l.type === "image" && /@builtin\/(brand|lockup|series)\/|@user\/logo/.test(l.asset ?? ""),
  );
  if (hasBrand) return false;
  const score = cornerScore(tpl.layers);
  const order = ["bottom-right", "bottom-left", "top-right", "top-left"];
  order.sort((a, b) => score[a] - score[b]);
  const corner = order[0];
  tpl.layers.push({
    type: "image",
    id: "v7-brand-badge",
    anchor: corner,
    corner,
    margin: 0.035,
    asset: "@builtin/brand/{exif.brand_slug}",
    size: { height: 0.04 },
    tint: "auto",
    contrast: "auto",
    z: 100,
  });
  stats.set(`badge+ ${category} ${corner}`, (stats.get(`badge+ ${category} ${corner}`) ?? 0) + 1);
  return true;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const stats = new Map();
let changed = 0;
let skipped = 0;
for (const file of files) {
  const path = join(DIR, file);
  const tpl = JSON.parse(readFileSync(path, "utf8"));
  const id = tpl.meta?.id;
  if (!id || (ONLY && !ONLY.has(id))) continue;
  if (!FORCE && String(tpl.meta.minEngineVersion ?? "").startsWith("0.7.")) {
    skipped++;
    continue;
  }
  const category = tpl.meta.category;
  const style = effectiveStyle(CAT_STYLE[category] ?? "swiss", "");
  walkLayers(tpl.layers, (layer) => {
    if (layer.type === "text") {
      const s = effectiveStyle(CAT_STYLE[category] ?? "swiss", (layer.font?.family ?? [])[0]);
      transformTextLayer(layer, s, category, stats);
    }
  });
  const badge = ensureBadge(tpl, category, stats);
  tpl.meta.minEngineVersion = "0.7.0";
  tpl.meta.version = "1.1.0";
  if (!DRY) writeFileSync(path, JSON.stringify(tpl, null, 2) + "\n");
  changed++;
  if (badge) console.log(`  ${id}: + brand badge`);
}

console.log(`\n${DRY ? "[dry] " : ""}templates changed: ${changed}, already v0.7: ${skipped}, total: ${files.length}`);
const rows = [...stats.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of rows.slice(0, 40)) console.log(`  ${String(v).padStart(4)}  ${k}`);
if (rows.length > 40) console.log(`  ... ${rows.length - 40} more`);

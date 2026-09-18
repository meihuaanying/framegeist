// v0.7.0 M0 gate: every non-ASCII character a template can render through a
// text layer must exist in the cmap of the font family that layer names.
// Parses TTF/OTF cmaps directly (format 4 + 12), no external deps.
//
// Usage: node tools/check-glyph-coverage.mjs [--verbose]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const FONTS = "templates/assets/fonts";
const TEMPLATES = "templates";
const VERBOSE = process.argv.includes("--verbose");

function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

/// Returns a Set of Unicode code points covered by the font.
function parseCmap(buf) {
  if (buf.length < 12) throw new Error("too small");
  const numTables = u16(buf, 4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > buf.length) break;
    if (buf.slice(rec, rec + 4).toString("latin1") === "cmap") {
      cmapOff = u32(buf, rec + 8);
      break;
    }
  }
  if (cmapOff < 0) throw new Error("no cmap table");
  const numSubtables = u16(buf, cmapOff + 2);
  const covered = new Set();
  let best = null;
  for (let i = 0; i < numSubtables; i++) {
    const rec = cmapOff + 4 + i * 8;
    const platform = u16(buf, rec);
    const encoding = u16(buf, rec + 2);
    const off = cmapOff + u32(buf, rec + 4);
    const format = u16(buf, off);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12 && (!best || best.format !== 12)) best = { off, format };
    else if (format === 4 && !best) best = { off, format };
  }
  if (!best) return covered;
  if (best.format === 4) {
    const segCount = u16(buf, best.off + 6) / 2;
    const endOff = best.off + 14;
    const startOff = endOff + segCount * 2 + 2;
    const deltaOff = startOff + segCount * 2;
    const rangeOff = deltaOff + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = u16(buf, endOff + s * 2);
      const start = u16(buf, startOff + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end; c++) covered.add(c);
    }
  } else if (best.format === 12) {
    const nGroups = u32(buf, best.off + 12);
    for (let g = 0; g < nGroups; g++) {
      const rec = best.off + 16 + g * 12;
      const start = u32(buf, rec);
      const end = u32(buf, rec + 4);
      if (end - start > 0x20000) continue;
      for (let c = start; c <= end; c++) covered.add(c);
    }
  }
  return covered;
}

const cmapCache = new Map();
function familyCoverage(family, files) {
  if (cmapCache.has(family)) return cmapCache.get(family);
  const covered = new Set();
  for (const file of files) {
    const path = join(FONTS, file);
    if (!existsSync(path)) continue;
    try {
      for (const cp of parseCmap(readFileSync(path))) covered.add(cp);
    } catch (e) {
      console.error(`warn: ${family}: cannot parse ${file}: ${e.message}`);
    }
  }
  cmapCache.set(family, covered);
  return covered;
}

function textLayers(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) textLayers(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.type === "text" && Array.isArray(node.content)) {
    out.push(node);
  }
  for (const value of Object.values(node)) textLayers(value, out);
}

const manifest = JSON.parse(readFileSync(join(FONTS, "fonts.json"), "utf8"));
const filesByFamily = new Map();
for (const f of manifest.fonts) {
  if (!filesByFamily.has(f.family)) filesByFamily.set(f.family, []);
  filesByFamily.get(f.family).push(f.file);
}

const files = readdirSync(TEMPLATES).filter((f) => f.endsWith(".json"));
let failures = 0;
let checked = 0;
const missingReport = new Map(); // family -> Map(char -> templates)
for (const file of files) {
  const id = basename(file, ".json");
  let tpl;
  try {
    tpl = JSON.parse(readFileSync(join(TEMPLATES, file), "utf8"));
  } catch {
    continue;
  }
  const layers = [];
  textLayers(tpl.layers ?? [], layers);
  for (const layer of layers) {
    const families = layer.font?.family ?? [];
    const chars = new Set();
    for (const item of layer.content ?? []) {
      for (const key of ["expr", "fallback"]) {
        for (const ch of String(item[key] ?? "")) {
          if (ch.codePointAt(0) > 127) chars.add(ch);
        }
      }
    }
    for (const family of families) {
      if (!filesByFamily.has(family)) continue; // unknown family: engine fallback, covered elsewhere
      const covered = familyCoverage(family, filesByFamily.get(family));
      for (const ch of chars) {
        checked++;
        if (!covered.has(ch.codePointAt(0))) {
          if (!missingReport.has(family)) missingReport.set(family, new Map());
          const perChar = missingReport.get(family);
          if (!perChar.has(ch)) perChar.set(ch, []);
          perChar.get(ch).push(id);
          failures++;
        }
      }
    }
  }
}

if (failures === 0) {
  console.log(`glyph coverage: ${freshTemplates()} templates, ${checked} family/char pairs checked, 0 missing`);
  process.exit(0);
}
console.error(`glyph coverage: ${failures} missing glyph checks across ${missingReport.size} families`);
for (const [family, perChar] of missingReport) {
  const parts = [...perChar.entries()].map(([ch, tpls]) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} (${ch}) in ${[...new Set(tpls)].slice(0, 3).join(", ")}${tpls.length > 3 ? "…" : ""}`);
  console.error(`  ${family}: ${parts.join("; ")}`);
}
if (VERBOSE) console.error(JSON.stringify([...missingReport.keys()]));
process.exit(1);

function freshTemplates() {
  return files.length;
}

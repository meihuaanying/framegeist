// v0.7.0 M4: build before/after comparison sheets, one PNG per category with
// 2-3 templates each (v0.6.1 sample on the left, v0.7.0 on the right).
//
// Usage: node tools/make-compare-sheets.mjs [--before <dir>] [--out <dir>]
//   --before defaults to .cache/v061-samples (snapshot of the pre-M2 samples)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BEFORE = argOf("--before", ".cache/v061-samples");
const OUT = argOf("--out", "docs/reports/v0.7.0/compare");
const THUMB = 520;
const GAP = 26;
const PAD = 22;
const HEAD = 34;
const LABEL_H = 26;

mkdirSync(OUT, { recursive: true });

function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: THUMB, h: THUMB };
}

const templates = JSON.parse(readFileSync("web/templates.json", "utf8"));
const byCat = new Map();
for (const t of templates) {
  if (!byCat.has(t.category)) byCat.set(t.category, []);
  byCat.get(t.category).push(t);
}

const fontFile = "templates/assets/fonts/Inter-600.ttf";
const fontFiles = existsSync(fontFile) ? [fontFile] : [];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let sheets = 0;
let images = 0;
for (const [cat, list] of [...byCat.entries()].sort()) {
  const ids = list.map((t) => t.id).sort();
  const pick = ids.length >= 3 ? [ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]] : ids;
  const rows = [];
  for (const id of pick) {
    const beforePath = join(BEFORE, `${id}.jpg`);
    const afterPath = join("templates", "samples", `${id}.jpg`);
    if (!existsSync(beforePath) || !existsSync(afterPath)) continue;
    const b = readFileSync(beforePath);
    const a = readFileSync(afterPath);
    const bs = jpegSize(b);
    const as = jpegSize(a);
    rows.push({ id, before: b, after: a, bw: bs.w, bh: bs.h, aw: as.w, ah: as.h });
  }
  if (!rows.length) continue;
  const rowW = THUMB * 2 + GAP;
  const bodyH = rows.reduce((sum, r) => sum + HEAD + Math.round((THUMB * r.bh) / r.bw) + LABEL_H + 16, 0);
  const width = rowW + PAD * 2;
  const height = bodyH + PAD * 2;
  let y = PAD;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  svg += `<text x="${PAD}" y="${PAD + 2}" font-family="Inter" font-size="22" font-weight="600" fill="#111111">${esc(cat)}</text>`;
  for (const r of rows) {
    y += HEAD;
    const h1 = Math.round((THUMB * r.bh) / r.bw);
    const h2 = Math.round((THUMB * r.ah) / r.aw);
    svg += `<text x="${PAD}" y="${y}" font-family="Inter" font-size="15" font-weight="600" fill="#1A1A1A">${esc(r.id)}</text>`;
    y += 10;
    svg += `<image x="${PAD}" y="${y}" width="${THUMB}" height="${h1}" href="data:image/jpeg;base64,${r.before.toString("base64")}"/>`;
    svg += `<image x="${PAD + THUMB + GAP}" y="${y}" width="${THUMB}" height="${h2}" href="data:image/jpeg;base64,${r.after.toString("base64")}"/>`;
    y += Math.max(h1, h2) + 2;
    svg += `<text x="${PAD}" y="${y + 16}" font-family="Inter" font-size="13" fill="#6B7280">v0.6.1</text>`;
    svg += `<text x="${PAD + THUMB + GAP}" y="${y + 16}" font-family="Inter" font-size="13" fill="#6B7280">v0.7.0</text>`;
    y += LABEL_H;
    images += 2;
  }
  svg += `</svg>`;
  const resvg = new Resvg(svg, {
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Inter" },
    fitTo: { mode: "zoom", value: 1 },
  });
  const png = resvg.render().asPng();
  writeFileSync(join(OUT, `${cat}.png`), png);
  sheets++;
  console.log(`${cat}: ${rows.length} templates -> ${cat}.png`);
}
console.log(`\ncompare sheets: ${sheets} categories, ${images} before/after pairs -> ${OUT}`);

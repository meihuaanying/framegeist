#!/usr/bin/env node
// v1.1.0 — import user-supplied official brand artwork from brand-official-inbox/
// (git-ignored staging dir) into the shipped asset matrix, mirroring the geometry
// that tools/gen-brand-assets.mjs produces: canvas height 512, width = natural aspect,
// artwork vertically centered; thumbnails fit inside 96x96.
//
// Usage:
//   node tools/import-brand-inbox.mjs --dry                     # report only
//   node tools/import-brand-inbox.mjs                           # apply
//   node tools/import-brand-inbox.mjs --only nikon,zeiss
//   node tools/import-brand-inbox.mjs --report <path.json>
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const ROOT = process.cwd();
const INBOX = path.join(ROOT, "brand-official-inbox");
const COLORS_JSON = path.join(ROOT, "tools", "brand-colors.json");
const MANIFEST = path.join(ROOT, "web", "brand", "index.json");
const MAIN_H = 512; // primary-variant canvas height (matches gen-brand-assets SIZE)
const MAX_W = 2048; // cap very wide wordmarks so canvases stay sane
// v1.1.0: wordmarks are drawn by INK HEIGHT, not by fitting the widest possible mark
// into the square. The engine sizes a badge by height and multiplies by the canvas
// aspect, so ink height / canvas height is the number that decides how tall the mark
// appears on the photo. Pre-v1.1 assets kept wide wordmarks at ~158-168px of a 512
// canvas (0.31-0.33); scaling by width instead produced 7artisans at 229px (0.447).
const WORDMARK_ASPECT = 2.2; // ink wider than this counts as a wordmark
const WORDMARK_INK_H_RATIO = 0.3125; // 160px of a 512 canvas
const THUMB = 96; // thumbnail box (matches web/brand/thumbs)

// ---------------------------------------------------------------- picks (contact-sheet review)
// base: "original" keeps the official colours; "black" / a hex re-colours the whole mark.
const PICKS = {
  "7artisans": { base: "original" },
  blackmagicdesign: { base: "black", light: "blackmagicdesign-2.svg" },
  epson: { base: "black" },
  google: { base: "original", light: "google-2.png" },
  honor: { base: "black" },
  huawei: { base: "original" },
  insta360: { base: "#FFEE00" },
  leica: { base: "original" },
  meike: { base: "original", light: "meike-2.png" },
  // The official Nikon badge is an opaque yellow square, so tinted variants would be solid
  // blocks — ship the official base and keep the existing black/white wordmark variants.
  nikon: { base: "original", skipTints: true },
  nokia: { base: "original" },
  oppo: { base: "black" },
  phaseone: { base: "original" },
  samsung: { base: "black", light: "samsung-2.svg" },
  sirui: { base: "original" },
  sony: { base: "black" },
  ttartisan: { base: "black" },
  viltrox: { base: "black" },
  vivo: { base: "black" },
  voigtlander: { base: "original", light: "voigtlander-3.svg" },
  zeiss: { base: "original" },
  "nikon-s": { dir: "series", base: "original" },
};

const SKIPS = {
  apple: "the only inbox file is apple.com's og raster — an opaque full-bleed card, not a transparent logo mark",
  canon: "inbox files are lockups (Canon+Global / Canon+感动常在) — keeping the v0.9.3 red wordmark",
  dji: "site favicon only (128px)",
  fujifilm: "official file carries the 'Value from Innovation' tagline",
  hasselblad: "official file is a 118x9 flat white wordmark",
  laowa: "official file is the LAOWA|CINE lockup",
  olympus: "official mark is OM Digital Solutions — ruling 4 keeps OLYMPUS",
  oneplus: "site favicon only (32px)",
  panasonic: "official file has the two-line Panasonic Electric lockup — ruling 4 keeps Panasonic",
  pentax: "inbox file is a product card photo, not a wordmark",
  ricoh: "plain file carries 'imagine. change.'; alternates are a 90th-anniversary lockup",
  samyang: "official mark is the LK Samyang group logo, not a lens wordmark",
  sigma: "inbox file is the grey variant; ruling 1 keeps the Simple Icons red",
  tamron: "official file carries the 'Focus on the Future' tagline",
  tokina: "official file is a small blue icon without a wordmark",
  yongnuo: "no official mark could be located (see SOURCES.json gaps)",
  gopro: "not part of the audited badge library",
  sandisk: "not part of the audited badge library",
  nothing: "not part of the audited badge library",
  xiaomi: "not part of the audited badge library",
};

// ruling 6: the combined RF-L series badge is replaced by the plain "L" badge.
const REMOVE = { "canon-rf-l": "ruling 6 — the combined RF-L wordmark is replaced by the plain L badge" };

// Verified official colours (audit §6 ruling 9 + contact-sheet review).
// Verified official colours for marks whose saturated pixels are too few or too antialiased
// for the sampler to settle on a value. Near-black marks (Voigtländer's script) are
// deliberately absent: they are monochrome, so they carry no brand colour.
const COLOR_HINTS = {
  "7artisans": "#D61518",
  meike: "#014099",
  sirui: "#0C4DA2",
  tokina: "#2A3E92",
};

// Official series accent colours (ruling 5). Only badges delivered by the user carry a
// verified accent; the remaining 12 series badges stay monochrome until official artwork
// ships, so they get no accent entry and keep the current look.
const SERIES_ACCENT = { "nikon-s": "#FFE100" };

// A colour is only declared when one hue clearly dominates the mark's saturated pixels.
const DOMINANT_HUE_SHARE = 0.5;

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];
const reportIdx = argv.indexOf("--report");
const REPORT = reportIdx >= 0 && argv[reportIdx + 1] ? argv[reportIdx + 1] : "docs/reports/v1.1.0/brand-import-report.json";

// ---------------------------------------------------------------- raster helpers
function pngDecode(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8; let ihdr = null; const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9] };
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8) return null;
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
  if (!ch) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * ch;
  const out = Buffer.alloc(ihdr.h * stride);
  let src = 0;
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[src++];
    const line = raw.subarray(src, src + stride); src += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  const alpha = (x, y) => {
    const i = y * stride + x * ch;
    if (ihdr.color === 6) return out[i + 3];
    if (ihdr.color === 4) return out[i + 1];
    return 255;
  };
  const rgb = (x, y) => {
    const i = y * stride + x * ch;
    if (ihdr.color === 6 || ihdr.color === 2) return [out[i], out[i + 1], out[i + 2]];
    if (ihdr.color === 0 || ihdr.color === 4) return [out[i], out[i], out[i]];
    return [0, 0, 0];
  };
  return { w: ihdr.w, h: ihdr.h, color: ihdr.color, stride, out, alpha, rgb };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function pngEncode(w, h, ch, pixels) {
  const stride = w * ch;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = ch === 1 ? 0 : ch === 2 ? 4 : ch === 3 ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inkBox(img) {
  let x0 = img.w; let y0 = img.h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.alpha(x, y) > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: img.w, h: img.h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Dominant hue of the saturated pixels, plus how much of the saturated area it covers.
// Mean saturation is the wrong measure for wordmarks: a black wordmark with one coloured
// glyph (Blackmagic, 7artisans) has a near-zero mean yet an unmistakable brand colour, while
// a monochrome mark scores high only through antialiasing fringes.
function dominantHue(img, box) {
  const bins = new Array(12).fill(0).map(() => ({ n: 0, r: 0, g: 0, b: 0 }));
  let total = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (img.alpha(x, y) < 200) continue;
      const px = img.rgb(x, y);
      const max = Math.max(px[0], px[1], px[2]); const min = Math.min(px[0], px[1], px[2]);
      if (max < 40) continue;
      const sat = (max - min) / max;
      if (sat < 0.25) continue;
      let hueDeg;
      const d = max - min;
      if (d === 0) continue;
      if (max === px[0]) hueDeg = 60 * (((px[1] - px[2]) / d) % 6);
      else if (max === px[1]) hueDeg = 60 * ((px[2] - px[0]) / d + 2);
      else hueDeg = 60 * ((px[0] - px[1]) / d + 4);
      if (hueDeg < 0) hueDeg += 360;
      const bin = bins[Math.floor(hueDeg / 30) % 12];
      bin.n += 1; bin.r += px[0]; bin.g += px[1]; bin.b += px[2];
      total += 1;
    }
  }
  if (total < 12) return null;
  let best = bins[0];
  for (const bin of bins) if (bin.n > best.n) best = bin;
  const hex = (v) => Math.round(v / best.n).toString(16).padStart(2, "0");
  return {
    hex: `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`.toUpperCase(),
    share: best.n / total,
  };
}

function jpegSize(buf) {
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) { pos++; continue; }
    const marker = buf[pos + 1];
    const len = buf.readUInt16BE(pos + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(pos + 5), w: buf.readUInt16BE(pos + 7) };
    }
    pos += 2 + len;
  }
  return null;
}

function svgViewBox(text) {
  const m = text.match(/viewBox\s*=\s*"([^"]+)"/);
  if (m) {
    const p = m[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) return { x: p[0], y: p[1], w: p[2], h: p[3] };
  }
  const w = text.match(/\bwidth\s*=\s*"(\d+(?:\.\d+)?)/);
  const h = text.match(/\bheight\s*=\s*"(\d+(?:\.\d+)?)/);
  if (w && h) return { x: 0, y: 0, w: Number(w[1]), h: Number(h[1]) };
  return { x: 0, y: 0, w: 512, h: 512 };
}

// ---------------------------------------------------------------- svg pipeline
function artwork(file) {
  const full = path.join(INBOX, file);
  const ext = path.extname(file).toLowerCase();
  const raw = readFileSync(full);
  if (ext === ".svg") {
    const text = raw.toString("utf8");
    return { svg: text, box: svgViewBox(text), source: file };
  }
  let size = null;
  if (ext === ".png") { const d = pngDecode(raw); if (d) size = { w: d.w, h: d.h }; }
  else if (ext === ".jpg" || ext === ".jpeg") size = jpegSize(raw);
  if (!size || !size.w || !size.h) throw new Error(`cannot determine size of ${file}`);
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  const b64 = raw.toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${size.w} ${size.h}"><image x="0" y="0" width="${size.w}" height="${size.h}" xlink:href="data:${mime};base64,${b64}"/></svg>`;
  return { svg, box: { x: 0, y: 0, w: size.w, h: size.h }, source: file };
}

const rerender = (svg, width) => new Resvg(svg, {
  fitTo: { mode: "width", value: Math.max(1, Math.round(width)) },
  font: { loadSystemFonts: false },
}).render().asPng();

const hexTriplet = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Recolour in the raster domain: replace RGB everywhere while keeping the alpha channel.
// An feColorMatrix filter on the content group was unreliable — resvg painted solid boxes for
// both raster and vector sources — and a multiplicative matrix left already-coloured artwork
// (yellow Nikon, four-colour Google) untouched, so both variants were wrong.
function recolour(png, rgbTriplet) {
  const img = pngDecode(png);
  if (!img) throw new Error("variant is not a decodable PNG");
  const [r, g, b] = rgbTriplet;
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[img.color];
  if (!ch) throw new Error(`unsupported PNG colour type ${img.color}`);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = y * img.stride + x * ch;
      if (ch === 1) { img.out[i] = r; continue; }
      if (ch === 2) { img.out[i] = r; continue; }
      img.out[i] = r; img.out[i + 1] = g; img.out[i + 2] = b;
    }
  }
  return pngEncode(img.w, img.h, ch, img.out);
}

function stripSvg(text) {
  return String(text)
    .replace(/<\?xml[^>]*\?>\s*/g, "")
    .replace(/<!DOCTYPE[^>]*>\s*/gi, "")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
}

function measureInk(svg, box) {
  const png = rerender(svg, 1600);
  const img = pngDecode(png);
  if (!img) throw new Error("rendered variant is not a decodable PNG");
  // The re-render is capped at 1600px wide, so convert the ink box back into the
  // artwork's own user space — otherwise the geometry is applied twice and the
  // artwork renders magnified and cropped.
  const k = box.w / img.w;
  const px = inkBox(img);
  const ink = { x: px.x * k, y: px.y * k, w: px.w * k, h: px.h * k };
  return { img, ink, px, factor: k };
}

// Place artwork on the shared canvas geometry (512px tall, width from the natural aspect).
// `ink` is in the artwork's user space, so the viewBox alone does the scaling; the filter
// is applied to a wrapper group so raster-wrapped artwork is recoloured too.
function place(art, ink, targetH) {
  // v1.1.0: every pre-existing brand asset uses a SQUARE canvas with the mark
  // fitted inside and centred (e.g. sony ink 512x90 inside 512x512). The engine
  // sizes a badge by height and derives its width from the canvas aspect ratio,
  // so a wide canvas (an earlier draft emitted 2048x512) made the mark 4x wider
  // on the canvas and it overlapped the info block text. Keep the square box.
  const side = targetH;
  const wordmark = ink.w / ink.h > WORDMARK_ASPECT;
  // Wordmarks: cap the ink height so the drawn mark keeps the pre-v1.1 proportions.
  // Icons and square marks still fill the square (that is how leica/nikon/zeiss ship).
  const scale = wordmark
    ? Math.min(side / ink.w, (WORDMARK_INK_H_RATIO * side) / ink.h)
    : Math.min(side / ink.w, side / ink.h);
  const padX = (side - ink.w * scale) / 2;
  const padY = (side - ink.h * scale) / 2;
  const vbX = ink.x - padX / scale;
  const vbY = ink.y - padY / scale;
  const vb = side / scale;
  const inner = stripSvg(art.svg);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${side}" height="${side}" viewBox="${vbX.toFixed(3)} ${vbY.toFixed(3)} ${vb.toFixed(3)} ${vb.toFixed(3)}">${inner}</svg>`;
}

function writeAsset(rel, png) {
  const full = path.join(ROOT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, png);
}

// ---------------------------------------------------------------- main
const sources = JSON.parse(readFileSync(path.join(INBOX, "SOURCES.json"), "utf8"));
const report = {
  generatedAt: new Date().toISOString(),
  dry: DRY,
  applied: [],
  skipped: SKIPS,
  removed: REMOVE,
  colors: {},
  manifestVersion: 5,
};

const slugs = Object.keys(PICKS).filter((s) => only.length === 0 || only.includes(s));
for (const slug of slugs) {
  const pick = PICKS[slug];
  const dir = pick.dir ?? "brand";
  const entry = (sources.brands ?? {})[slug] ?? (sources.series ?? {})[slug] ?? [];
  const primary = entry[0];
  if (!primary) {
    report.applied.push({ slug, error: "not present in SOURCES.json" });
    continue;
  }
  const art = artwork(primary.file);
  const baseMode = pick.base ?? "original";
  const baseTint = baseMode === "original" ? null : baseMode === "black" ? [0, 0, 0] : hexTriplet(baseMode);

  const measured = measureInk(art.svg, art.box);
  // The declared colour must describe the artwork we actually ship, not the Simple Icons
  // palette: official marks are often monochrome or two-tone (black Epson, black OPPO,
  // black "7" + black wordmark, near-black Voigtländer script). A tinted base is known
  // outright; otherwise sample the dominant hue of the saturated pixels below.
  let color = COLOR_HINTS[slug] ?? null;
  if (!color && typeof pick.base === "string" && pick.base !== "original" && pick.base !== "black") {
    color = pick.base.toUpperCase();
  }

  const lightArt = pick.light ? artwork(pick.light) : null;
  const lightInk = lightArt ? measureInk(lightArt.svg, lightArt.box).ink : measured.ink;
  const thumbH = Math.max(1, Math.round(measured.ink.h * Math.min(THUMB / measured.ink.w, THUMB / measured.ink.h)));

  const emit = (name, svg, ink, targetH, tint) => {
    const placed = place({ svg }, ink, targetH);
    const px = Number(placed.match(/width="(\d+)"/)?.[1] ?? targetH);
    const png = rerender(placed, Math.max(1, px));
    return { file: name, png: tint ? recolour(png, tint) : png };
  };

  // `skipTints` keeps the existing mono/light variants for artwork whose ink box is the
  // whole canvas (opaque raster badges), because a tinted variant would be a solid block.
  const written = [emit(`${slug}.png`, art.svg, measured.ink, MAIN_H, baseTint)];
  if (!pick.skipTints) {
    written.push(emit(`${slug}-mono.png`, art.svg, measured.ink, MAIN_H, [0, 0, 0]));
    written.push(emit(`${slug}-light.png`, lightArt ? lightArt.svg : art.svg, lightInk, MAIN_H, lightArt ? null : [255, 255, 255]));
  }
  written.push(emit(`thumbs/${slug}.png`, art.svg, measured.ink, thumbH, baseTint));

  if (!DRY) {
    for (const w of written) {
      if (dir === "brand") {
        writeAsset(`web/brand/${w.file}`, w.png);
        if (!w.file.startsWith("thumbs/")) writeAsset(`templates/assets/brand/${w.file}`, w.png);
      } else {
        writeAsset(`templates/assets/${dir}/${w.file}`, w.png);
      }
    }
  }

  // Sample the shipped base variant, so the declared colour always describes the bytes we
  // write (a tinted base is uniform, and an untinted two-tone mark keeps its real accent).
  if (!color) {
    const baseImg = pngDecode(written[0].png);
    const hue = dominantHue(baseImg, inkBox(baseImg));
    if (hue && hue.share >= DOMINANT_HUE_SHARE) color = hue.hex;
  }
  if (color) report.colors[slug] = color;

  const mainW = Number(written[0].png.readUInt32BE(16));
  report.applied.push({
    slug,
    dir,
    source: primary.file,
    sourceUrl: primary.sourceUrl ?? null,
    tier: primary.tier ?? null,
    base: baseMode,
    light: pick.light ?? "white",
    lightOfficial: Boolean(pick.light),
    tintSkipped: Boolean(pick.skipTints),
    color: color ?? null,
    sampled: color ?? null,
    ink: `${measured.ink.w}x${measured.ink.h}`,
    nat: `${art.box.w}x${art.box.h}`,
    canvas: `${mainW}x${MAIN_H}`,
    thumb: (() => {
      const t = written.find((w) => w.file === `thumbs/${slug}.png`);
      return `${t.png.readUInt32BE(16)}x${t.png.readUInt32BE(20)}`;
    })(),
  });
  if (!DRY) continue;
}

for (const [slug, reason] of Object.entries(REMOVE)) {
  const targets = [
    `templates/assets/series/${slug}.png`,
    `templates/assets/series/${slug}-light.png`,
    `web/brand/${slug}.png`,
    `web/brand/${slug}-mono.png`,
    `web/brand/${slug}-light.png`,
    `web/brand/thumbs/${slug}.png`,
  ];
  const hit = targets.filter((t) => existsSync(path.join(ROOT, t)));
  if (!DRY) for (const t of hit) rmSync(path.join(ROOT, t), { force: true });
  report.removed[slug] = { reason, deleted: hit };
}

if (!DRY) {
  const cfg = JSON.parse(readFileSync(COLORS_JSON, "utf8"));
  cfg.originalColorOverride = cfg.originalColorOverride ?? {};
  cfg.officialAsset = cfg.officialAsset ?? {};
  for (const [slug, hex] of Object.entries(report.colors)) cfg.originalColorOverride[slug] = hex;
  for (const item of report.applied) {
    if (item.error) continue;
    cfg.officialAsset[item.slug] = { file: item.source, sourceUrl: item.sourceUrl, tier: item.tier };
  }
  writeFileSync(COLORS_JSON, `${JSON.stringify(cfg, null, 2)}\n`);

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  manifest.version = 5;
  for (const [group, items] of Object.entries(manifest.groups ?? {})) {
    for (const item of items) {
      const info = report.applied.find((a) => a.slug === item.slug && !a.error);
      if (info) {
        item.officialAsset = info.source;
        item.sourceUrl = info.sourceUrl ?? undefined;
        // The declared colour describes the shipped mark, so a mark that turned out to be
        // monochrome must lose the colour it inherited from the Simple Icons palette.
        if (info.color) item.color = info.color;
        else delete item.color;
        // Flags the colour gate needs: an official light plate is not a white wordmark, and
        // opaque badges (Nikon) keep their pre-existing mono/light variants untouched.
        if (info.lightOfficial) item.lightOfficial = true;
        else delete item.lightOfficial;
        if (info.tintSkipped) item.tintSkipped = true;
        else delete item.tintSkipped;
      }
      if (group === "series" && SERIES_ACCENT[item.slug]) item.accent = SERIES_ACCENT[item.slug];
      if (REMOVE[item.slug]) delete item.accent;
    }
  }
  manifest.groups = Object.fromEntries(Object.entries(manifest.groups).map(([g, items]) => [g, items.filter((i) => !REMOVE[i.slug])]));
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

mkdirSync(path.dirname(path.join(ROOT, REPORT)), { recursive: true });
writeFileSync(path.join(ROOT, REPORT), `${JSON.stringify(report, null, 2)}\n`);

const done = report.applied.filter((a) => !a.error);
console.log(`${DRY ? "DRY" : "APPLY"}: ${done.length} brands imported, ${Object.keys(report.colors).length} colours recorded, manifest v${report.manifestVersion}`);
for (const a of done) console.log(`  ${a.slug.padEnd(18)} ${String(a.source).padEnd(24)} ${a.color ?? "-"} ink=${a.ink} nat=${a.nat} -> ${a.canvas} thumb=${a.thumb}`);
for (const [slug, r] of Object.entries(report.removed)) console.log(`  remove ${slug}: ${r.deleted.length} file(s) — ${r.reason}`);
console.log(`report: ${REPORT}`);

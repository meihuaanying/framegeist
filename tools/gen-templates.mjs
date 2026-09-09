// Deterministic generator for the built-in template library (PRD C4).
// Usage: node tools/gen-templates.mjs   (writes templates/*.json)
import { writeFileSync, readdirSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "templates";
const VERSION = "0.1.0";
const ENGINE = "0.1.0";
const LICENSE = "CC0-1.0";

function meta(id, name, category) {
  return {
    meta: { id, name, version: VERSION, minEngineVersion: ENGINE, author: "framegeist", license: LICENSE, category },
  };
}

function textLayer(id, anchor, font, content, extra = {}) {
  return { type: "text", id, anchor, font, content, ...extra };
}

function font(size, color, weight = 400) {
  return { family: ["JetBrains Mono"], size, weight, color };
}

function item(expr, fallback = null) {
  return { expr, fallback };
}

const EXIF_INFO = [
  item("exif.model_pretty", "Unknown Camera"),
  item("exif.lens", null),
];

const EXIF_PARAMS = [item("fmt('{focal}mm  f/{aperture}  {shutter}  ISO{iso}', exif)", "framegeist")];

function make(id, name, category, canvas, layers) {
  const tpl = meta(id, name, category);
  tpl.canvas = canvas;
  tpl.layers = layers;
  return tpl;
}

function extendCanvas(padding, bg) {
  return { mode: "extend", padding, background: bg };
}

function solid(color) {
  return { type: "solid", color };
}

function blur(scale, radius) {
  return { type: "blur", scale, blur: radius };
}

const TEMPLATES = [];

// ---------- classic-white (8) ----------
const CLASSIC_BGS = [
  ["#FFFFFF", "#111111"],
  ["#FFFFFF", "#111111"],
  ["#F5F1E8", "#2A2118"],
  ["#FFFFFF", "#111111"],
  ["#FFFFFF", "#444444"],
  ["#FAFAFA", "#222222"],
  ["#FFFFFF", "#111111"],
  ["#FFFCF5", "#33301A"],
];
for (let i = 0; i < 8; i++) {
  const [bg, fg] = CLASSIC_BGS[i];
  const pad = [0.04, 0.05, 0.06, 0.07, 0.08, 0.1][i % 6];
  const padBottom = [0.1, 0.12, 0.14, 0.16, 0.18][i % 5];
  TEMPLATES.push(
    make(
      `classic-white-v${i + 1}`,
      `Classic White V${i + 1}`,
      "classic-white",
      extendCanvas({ top: pad, right: pad, bottom: padBottom, left: pad }, solid(bg)),
      [
        textLayer("title", "bottom-left", font(0.028, fg, 600), EXIF_INFO, { offset: { x: 0.02, y: -0.05 } }),
        textLayer("params", "bottom-right", font(0.02, fg, 400), EXIF_PARAMS, { offset: { x: 0.02, y: -0.05 } }),
      ]
    )
  );
}

// ---------- film (8) ----------
const FILM_VARIANTS = [
  ["#141414", "#E8C06A", 0.05],
  ["#101010", "#D8B24A", 0.06],
  ["#1A1611", "#F0D08A", 0.07],
  ["#0D0D0D", "#CC9933", 0.08],
  ["#181410", "#E6C87A", 0.05],
  ["#111008", "#DDBB66", 0.09],
  ["#1C1C1C", "#F2D98C", 0.06],
  ["#0A0A0A", "#C9A24D", 0.07],
];
for (let i = 0; i < 8; i++) {
  const [bg, fg, pad] = FILM_VARIANTS[i];
  TEMPLATES.push(
    make(
      `film-v${i + 1}`,
      `Film V${i + 1}`,
      "film",
      extendCanvas({ top: pad, right: pad, bottom: pad + 0.06, left: pad }, solid(bg)),
      [
        textLayer("filmstock", "top-left", font(0.018, fg, 400), [item(`'KODAK 400 ${i + 1}'`, "FILM")], { offset: { x: 0.015, y: 0.02 } }),
        textLayer("title", "bottom-left", font(0.026, fg, 600), EXIF_INFO, { offset: { x: 0.02, y: -0.05 } }),
        textLayer("params", "bottom-right", font(0.018, fg, 400), EXIF_PARAMS, { offset: { x: 0.02, y: -0.055 } }),
      ]
    )
  );
}

// ---------- polaroid (7) ----------
const POLAROID_PADS = [0.16, 0.18, 0.2, 0.22, 0.24, 0.26, 0.28];
for (let i = 0; i < 7; i++) {
  TEMPLATES.push(
    make(
      `polaroid-v${i + 1}`,
      `Polaroid V${i + 1}`,
      "polaroid",
      extendCanvas(
        { top: 0.05, right: 0.05, bottom: POLAROID_PADS[i], left: 0.05 },
        solid(i % 2 === 0 ? "#FAF7F0" : "#F3EEE3")
      ),
      [
        textLayer("caption", "bottom-center", font(0.03, "#333333", 600), [item("exif.model_pretty", "FrameGeist")], { offset: { x: 0, y: -0.1 } }),
        textLayer("date", "bottom-center", font(0.02, "#777777", 400), [item("date('YYYY-MM-DD', exif.datetime)", "2026-09-09")], { offset: { x: 0, y: -0.05 } }),
      ]
    )
  );
}

// ---------- gallery (7) ----------
const GALLERY_BGS = ["#EDEDED", "#E8E8E6", "#F0EFEC", "#E5E5E5", "#EFEEEA", "#E2E2E0", "#F2F1EE"];
for (let i = 0; i < 7; i++) {
  const pad = 0.08 + i * 0.012;
  TEMPLATES.push(
    make(
      `gallery-v${i + 1}`,
      `Gallery Mat V${i + 1}`,
      "gallery",
      extendCanvas({ top: pad, right: pad, bottom: pad + 0.08, left: pad }, solid(GALLERY_BGS[i])),
      [
        textLayer("artist", "bottom-left", font(0.024, "#2B2B2B", 600), EXIF_INFO, { offset: { x: 0.025, y: -0.06 } }),
        textLayer("series", "bottom-right", font(0.016, "#6A6A6A", 400), [item(`fmt('Gallery Series ${String(i + 1).padStart(2, "0")}', exif)`, "Gallery Series")], { offset: { x: 0.025, y: -0.06 } }),
      ]
    )
  );
}

// ---------- technical (7) ----------
const TECH_VARIANTS = [
  ["#0E1A26", "#7FD4FF"],
  ["#101418", "#9AE6B4"],
  ["#1A0F1E", "#F0A0E0"],
  ["#0F1A0F", "#B7F0AD"],
  ["#1E1408", "#FFD37F"],
  ["#08080F", "#A0B0FF"],
  ["#141414", "#E0E0E0"],
];
for (let i = 0; i < 7; i++) {
  const [bg, fg] = TECH_VARIANTS[i];
  TEMPLATES.push(
    make(
      `technical-v${i + 1}`,
      `Technical Plate V${i + 1}`,
      "technical",
      extendCanvas({ top: 0.045, right: 0.045, bottom: 0.11, left: 0.045 }, solid(bg)),
      [
        textLayer("plate", "bottom-left", font(0.02, fg, 400),
          [
            item("fmt('CAM: {model}', exif)", "CAM: n/a"),
            item("fmt('LNS: {lens}', exif)", "LNS: n/a"),
            item("fmt('EXP: f/{aperture} {shutter} ISO{iso}', exif)", "EXP: n/a"),
          ],
          { lineHeight: 1.5, offset: { x: 0.02, y: -0.05 } }),
        textLayer("meta", "top-right", font(0.014, fg, 400), [item("date('YYYY/MM/DD HH:mm', exif.datetime)", "no date")], { offset: { x: -0.02, y: 0.03 } }),
      ]
    )
  );
}

// ---------- magazine (8) ----------
const MAG_VARIANTS = [
  ["#FFFFFF", "#111111", 0.032],
  ["#FFFFFF", "#000000", 0.038],
  ["#F8F4EF", "#3A2E1E", 0.03],
  ["#FFFFFF", "#8A1F2D", 0.034],
  ["#FFFFFF", "#1E3A5F", 0.036],
  ["#F5F5F5", "#222222", 0.03],
  ["#FFF8F0", "#5B3A1E", 0.033],
  ["#FFFFFF", "#2F4F2F", 0.035],
];
for (let i = 0; i < 8; i++) {
  const [bg, fg, size] = MAG_VARIANTS[i];
  TEMPLATES.push(
    make(
      `magazine-v${i + 1}`,
      `Magazine V${i + 1}`,
      "magazine",
      extendCanvas({ top: 0.02, right: 0.02, bottom: 0.1, left: 0.02 }, solid(bg)),
      [
        textLayer("headline", "top-left", font(size, fg, 600), [item("exif.model_pretty", "FRAMEGEIST")], { offset: { x: 0.03, y: 0.04 } }),
        textLayer("issue", "top-right", font(0.014, "#888888", 400), [item("'ISSUE 2026-09'", "ISSUE")], { offset: { x: -0.03, y: 0.045 } }),
        textLayer("credits", "bottom-left", font(0.016, "#555555", 400), EXIF_PARAMS, { offset: { x: 0.03, y: -0.05 } }),
      ]
    )
  );
}

// ---------- minimal (8) ----------
const MINIMAL_VARIANTS = [
  ["#DDDDDD", "bottom-right", { x: 0.02, y: 0.03 }, "fmt('f/{aperture}  ISO{iso}', exif)"],
  ["#CCCCCC", "bottom-left", { x: 0.02, y: 0.03 }, "exif.model_pretty"],
  ["#EEEEEE", "top-right", { x: -0.02, y: 0.03 }, "fmt('{focal}mm', exif)"],
  ["#BBBBBB", "top-left", { x: 0.02, y: 0.03 }, "date('YYYY.MM.DD', exif.datetime)"],
  ["#D0D0D0", "bottom-center", { x: 0, y: 0.04 }, "fmt('{shutter}  ISO{iso}', exif)"],
  ["#E0E0E0", "middle-right", { x: -0.015, y: 0 }, "exif.lens"],
  ["#C8C8C8", "bottom-left", { x: 0.015, y: 0.025 }, "fmt('f/{aperture}', exif)"],
  ["#DCDCDC", "top-center", { x: 0, y: 0.025 }, "exif.model_pretty"],
];
for (let i = 0; i < 8; i++) {
  const [color, anchor, offset, expr] = MINIMAL_VARIANTS[i];
  TEMPLATES.push(
    make(
      `minimal-v${i + 1}`,
      `Minimal V${i + 1}`,
      "minimal",
      { mode: "overlay", background: { type: "none" } },
      [
        textLayer("corner", anchor, font(0.022, color, 400), [item(expr, "framegeist")], { offset }),
      ]
    )
  );
}

// ---------- frame-shell (7) ----------
const SHELL_VARIANTS = [
  ["#1A1A1A", 0.09],
  ["#22201C", 0.1],
  ["#2B2B2B", 0.11],
  ["#3A2A1A", 0.09],
  ["#15151E", 0.12],
  ["#241414", 0.1],
  ["#1E2A1E", 0.11],
];
for (let i = 0; i < 7; i++) {
  const [bg, pad] = SHELL_VARIANTS[i];
  TEMPLATES.push(
    make(
      `frame-shell-v${i + 1}`,
      `Camera Shell V${i + 1}`,
      "frame-shell",
      extendCanvas({ top: pad, right: pad, bottom: pad + 0.05, left: pad }, solid(bg)),
      [
        textLayer("badge", "top-left", font(0.016, "#DDDDDD", 600), [item("exif.make", "FG")], { offset: { x: 0.03, y: 0.035 } }),
        textLayer("title", "bottom-left", font(0.024, "#EDEDED", 600), EXIF_INFO, { offset: { x: 0.03, y: -0.05 } }),
        textLayer("params", "bottom-right", font(0.016, "#AAAAAA", 400), EXIF_PARAMS, { offset: { x: 0.03, y: -0.055 } }),
      ]
    )
  );
}

// ---------- write ----------
if (!existsSync(OUT)) {
  console.error(`missing ${OUT}/ directory; run from repo root`);
  process.exit(1);
}
for (const f of readdirSync(OUT)) {
  if (f.endsWith(".json") && f.includes("-v")) {
    if (!TEMPLATES.some((t) => t.meta.id + ".json" === f)) {
      rmSync(join(OUT, f));
    }
  }
}
// The three hand-written seed templates are preserved untouched.
for (const tpl of TEMPLATES) {
  writeFileSync(join(OUT, `${tpl.meta.id}.json`), JSON.stringify(tpl, null, 2) + "\n");
}

// Manifest for the Web client (fetched at runtime, no upload: PRD G1).
const manifest = [];
for (const f of readdirSync(OUT)) {
  if (!f.endsWith(".json")) continue;
  const raw = JSON.parse(await import("node:fs").then((m) => m.readFileSync(join(OUT, f), "utf8")));
  manifest.push({ id: raw.meta.id, name: raw.meta.name, category: raw.meta.category });
}
manifest.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
mkdirSync("web", { recursive: true });
writeFileSync(join("web", "templates.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`generated ${TEMPLATES.length} templates + web/templates.json manifest`);
const byCat = {};
for (const t of TEMPLATES) byCat[t.meta.category] = (byCat[t.meta.category] ?? 0) + 1;
console.log(byCat);

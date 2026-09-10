// Deterministic generator for the collage layout library (PRD C5).
// Usage: node tools/gen-layouts.mjs   (writes templates/layouts/*.json)
import { writeFileSync, readdirSync, mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "templates/layouts";
const VERSION = "0.1.0";

function layout(id, name, cells, opts = {}) {
  return {
    meta: {
      id,
      name,
      version: VERSION,
      author: "framegeist",
      license: "CC0-1.0",
      slots: cells.length,
    },
    cells,
    gutter: opts.gutter ?? 0.012,
    background: opts.background ?? "#FFFFFF",
    aspect: opts.aspect ?? 1,
    info_bar: {
      enabled: opts.infoBar ?? false,
      height: 0.075,
      color: "#FFFFFF",
      text_color: "#555555",
    },
  };
}

function grid(cols, rows) {
  const cells = [];
  const cw = 1 / cols;
  const ch = 1 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: c * cw, y: r * ch, w: cw, h: ch });
    }
  }
  return cells;
}

// Asymmetric splits: a big cell plus smaller ones.
function bigTop(cols, rows) {
  // top half big cell spanning full width, bottom half grid(cols, rows)
  const cells = [{ x: 0, y: 0, w: 1, h: 0.5 }];
  const n = cols * rows;
  const cw = 1 / cols;
  for (let i = 0; i < n; i++) {
    cells.push({ x: (i % cols) * cw, y: 0.5 + Math.floor(i / cols) * (0.5 / rows), w: cw, h: 0.5 / rows });
  }
  return cells;
}

function bigLeft(cols, rows) {
  const cells = [{ x: 0, y: 0, w: 0.5, h: 1 }];
  const cw = 0.5 / cols;
  for (let i = 0; i < cols * rows; i++) {
    cells.push({ x: 0.5 + (i % cols) * cw, y: Math.floor(i / cols) * (1 / rows), w: cw, h: 1 / rows });
  }
  return cells;
}

function heroQuad() {
  return [
    { x: 0, y: 0, w: 0.66, h: 0.66 },
    { x: 0.66, y: 0, w: 0.34, h: 0.33 },
    { x: 0.66, y: 0.33, w: 0.34, h: 0.33 },
    { x: 0, y: 0.66, w: 0.33, h: 0.34 },
    { x: 0.33, y: 0.66, w: 0.34, h: 0.34 },
    { x: 0.66, y: 0.66, w: 0.34, h: 0.34 },
  ];
}

const LAYOUTS = [];

// 1. Square grids: 1x1 .. 5x5 with both info-bar variants
const aspects = { sq: 1, wide: 1.5, tall: 0.75 };
for (let cols = 1; cols <= 5; cols++) {
  for (let rows = 1; rows <= 5; rows++) {
    if (cols * rows === 1 && cols === 1 && rows === 1) {
      // 1x1 is just "single photo" — keep it as the degenerate case
    }
    const id = `grid-${cols}x${rows}`;
    const cells = grid(cols, rows);
    LAYOUTS.push(layout(id, `Grid ${cols} x ${rows}`, cells, { aspect: aspects.sq }));
    LAYOUTS.push(layout(`${id}-info`, `Grid ${cols} x ${rows} + EXIF`, cells, { aspect: aspects.sq, infoBar: true }));
  }
}

// 2. Wide variants for common grids
for (const [cols, rows] of [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [3, 3], [4, 2], [5, 2], [4, 3], [4, 4]]) {
  const cells = grid(cols, rows);
  LAYOUTS.push(layout(`grid-${cols}x${rows}-wide`, `Grid ${cols}x${rows} Wide`, cells, { aspect: aspects.wide }));
  LAYOUTS.push(layout(`grid-${cols}x${rows}-tall`, `Grid ${cols}x${rows} Tall`, cells, { aspect: aspects.tall }));
  LAYOUTS.push(layout(`grid-${cols}x${rows}-wide-info`, `Grid ${cols}x${rows} Wide + EXIF`, cells, { aspect: aspects.wide, infoBar: true }));
}

// 3. Asymmetric hero layouts
const heroDefs = [
  ["hero-1-2", "Hero + 2", 1, 1],
  ["hero-1-4", "Hero + 4", 2, 1],
  ["hero-1-6", "Hero + 6", 3, 1],
  ["hero-1-8", "Hero + 8", 2, 2],
];
for (const [id, name, cols, rows] of heroDefs) {
  LAYOUTS.push(layout(id, name, bigTop(cols, rows)));
  LAYOUTS.push(layout(`${id}-side`, `${name} (left)`, bigLeft(cols, rows)));
  LAYOUTS.push(layout(`${id}-info`, `${name} + EXIF`, bigTop(cols, rows), { infoBar: true }));
}

// 4. Film-strip style: 1 column/row strips
for (let n = 2; n <= 6; n++) {
  LAYOUTS.push(
    layout(`strip-h${n}`, `Horizontal Strip ${n}`,
      Array.from({ length: n }, (_, i) => ({ x: i / n, y: 0, w: 1 / n, h: 1 })), { aspect: 2.35 })
  );
  LAYOUTS.push(
    layout(`strip-v${n}`, `Vertical Strip ${n}`,
      Array.from({ length: n }, (_, i) => ({ x: 0, y: i / n, w: 1, h: 1 / n })), { aspect: 1 / 2.35 })
  );
}

// 5. Specials
LAYOUTS.push(layout("hero-quad-6", "Hero Quad 6", heroQuad()));
LAYOUTS.push(layout("hero-quad-6-info", "Hero Quad 6 + EXIF", heroQuad(), { infoBar: true }));
LAYOUTS.push(layout("split-2-diag", "Diagonal Split 2", [
  { x: 0, y: 0, w: 0.5, h: 1 },
  { x: 0.5, y: 0, w: 0.5, h: 1 },
], { gutter: 0.006, background: "#141414" }));
LAYOUTS.push(layout("pyramid-6", "Pyramid 6", [
  { x: 0.2, y: 0, w: 0.6, h: 0.34 },
  { x: 0, y: 0.34, w: 0.33, h: 0.33 },
  { x: 0.33, y: 0.34, w: 0.34, h: 0.33 },
  { x: 0.67, y: 0.34, w: 0.33, h: 0.33 },
  { x: 0.1, y: 0.67, w: 0.4, h: 0.33 },
  { x: 0.5, y: 0.67, w: 0.4, h: 0.33 },
]));

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) {
  if (f.endsWith(".json")) rmSync(join(OUT, f));
}
for (const l of LAYOUTS) {
  writeFileSync(join(OUT, `${l.meta.id}.json`), JSON.stringify(l, null, 2) + "\n");
}

// Mirror layouts + manifest into web/ (page-relative, self-contained dist).
mkdirSync(join("web", "layouts"), { recursive: true });
for (const l of LAYOUTS) {
  writeFileSync(join("web/layouts", `${l.meta.id}.json`), JSON.stringify(l, null, 2) + "\n");
}
writeFileSync(
  join("web", "layouts.json"),
  JSON.stringify(LAYOUTS.map((l) => ({ id: l.meta.id, name: l.meta.name, slots: l.meta.slots })), null, 2) + "\n",
);

// SVG thumbnails for the layout picker (tiny, crisp in both themes).
mkdirSync(join("web", "layout-thumbs"), { recursive: true });
for (const l of LAYOUTS) {
  const W = 120, H = Math.round(W / (l.aspect || 1));
  const rects = l.cells
    .map((c) => {
      const x = (c.x * W).toFixed(1), y = (c.y * H).toFixed(1);
      const w = (c.w * W).toFixed(1), h = (c.h * H).toFixed(1);
      const pad = Math.max(0.6, (l.gutter || 0.012) * 2);
      return `<rect x="${(+x + pad).toFixed(1)}" y="${(+y + pad).toFixed(1)}" width="${Math.max(1, w - pad * 2).toFixed(1)}" height="${Math.max(1, h - pad * 2).toFixed(1)}" rx="2.5" fill="currentColor" opacity="0.75"/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${rects}</svg>\n`;
  writeFileSync(join("web", "layout-thumbs", `${l.meta.id}.svg`), svg);
}

console.log(`generated ${LAYOUTS.length} layouts + web/layouts.json + layout-thumbs mirror`);

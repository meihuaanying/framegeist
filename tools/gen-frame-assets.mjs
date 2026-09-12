// Generates original line-art frame assets (camera body, phone, film strips,
// perforated cards, barcodes, seals, icons) with resvg — authored in-house,
// not copied from any product.
// Output: templates/assets/frame/<slug>[-light].png + web/frame mirror.
// Usage: node tools/gen-frame-assets.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const OUT = "templates/assets/frame";
const WEB = "web/frame";
mkdirSync(OUT, { recursive: true });
mkdirSync(WEB, { recursive: true });

const STROKE = 10;

function sprockets(w, horizontal) {
  let holes = "";
  if (horizontal) {
    for (let x = 30; x < w - 40; x += 80) {
      holes += `<rect x="${x}" y="14" width="42" height="26" rx="7" fill="currentColor"/>`;
      holes += `<rect x="${x}" y="70" width="42" height="26" rx="7" fill="currentColor"/>`;
    }
  } else {
    for (let y = 30; y < w - 40; y += 80) {
      holes += `<rect x="14" y="${y}" width="26" height="42" rx="7" fill="currentColor"/>`;
      holes += `<rect x="70" y="${y}" width="26" height="42" rx="7" fill="currentColor"/>`;
    }
  }
  return holes;
}

function filmEdge(w) {
  let marks = "";
  for (let x = 24; x < w - 60; x += 96) {
    marks += `<rect x="${x}" y="18" width="10" height="28" fill="currentColor"/>`;
    marks += `<rect x="${x + 16}" y="18" width="22" height="12" fill="currentColor" opacity="0.55"/>`;
    marks += `<circle cx="${x + 54}" cy="32" r="5" fill="currentColor" opacity="0.75"/>`;
  }
  return marks;
}

function perforatedCard(w, h, r) {
  const step = r * 2;
  let d = `M 0 ${r}`;
  d += ` A ${r} ${r} 0 0 1 ${r} 0`;
  for (let x = r; x + step <= w - r; x += step) {
    d += ` A ${r} ${r} 0 0 0 ${x + step} 0`;
  }
  d += ` A ${r} ${r} 0 0 1 ${w} ${r}`;
  for (let y = r; y + step <= h - r; y += step) {
    d += ` A ${r} ${r} 0 0 0 ${w} ${y + step}`;
  }
  d += ` A ${r} ${r} 0 0 1 ${w - r} ${h}`;
  for (let x = w - r; x - step >= r; x -= step) {
    d += ` A ${r} ${r} 0 0 0 ${x - step} ${h}`;
  }
  d += ` A ${r} ${r} 0 0 1 0 ${h - r}`;
  for (let y = h - r; y - step >= r; y -= step) {
    d += ` A ${r} ${r} 0 0 0 0 ${y - step}`;
  }
  d += ` A ${r} ${r} 0 0 1 ${r} 0 Z`;
  return d;
}

function barcode(w, h) {
  // Deterministic pseudo-random bar widths (mulberry32 seed 42).
  let seed = 42;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let bars = "";
  let x = 24;
  let black = true;
  while (x < w - 24) {
    const bw = 2 + Math.floor(rand() * 4) * 2;
    if (black) {
      bars += `<rect x="${x}" y="10" width="${bw}" height="${h - 20}" fill="currentColor"/>`;
    }
    x += bw;
    black = !black;
  }
  return bars;
}

const ICONS = {
  mountain: `
    <circle cx="176" cy="80" r="22" fill="none" stroke="currentColor" stroke-width="${STROKE - 2}"/>
    <path d="M24 200 L96 96 L144 168 L176 128 L232 200 Z" fill="none" stroke="currentColor" stroke-width="${STROKE - 2}" stroke-linejoin="round"/>`,
  camera: `
    <rect x="36" y="82" width="184" height="124" rx="20" fill="none" stroke="currentColor" stroke-width="${STROKE - 2}"/>
    <rect x="92" y="58" width="72" height="28" rx="8" fill="none" stroke="currentColor" stroke-width="${STROKE - 3}"/>
    <circle cx="128" cy="144" r="40" fill="none" stroke="currentColor" stroke-width="${STROKE - 2}"/>
    <circle cx="128" cy="144" r="16" fill="none" stroke="currentColor" stroke-width="${STROKE - 4}"/>`,
  drone: `
    <rect x="98" y="98" width="60" height="60" rx="14" fill="none" stroke="currentColor" stroke-width="${STROKE - 2}"/>
    <path d="M98 110 L52 76 M158 110 L204 76 M98 146 L52 180 M158 146 L204 180" stroke="currentColor" stroke-width="${STROKE - 3}"/>
    <circle cx="44" cy="68" r="20" fill="none" stroke="currentColor" stroke-width="${STROKE - 3}"/>
    <circle cx="212" cy="68" r="20" fill="none" stroke="currentColor" stroke-width="${STROKE - 3}"/>
    <circle cx="44" cy="188" r="20" fill="none" stroke="currentColor" stroke-width="${STROKE - 3}"/>
    <circle cx="212" cy="188" r="20" fill="none" stroke="currentColor" stroke-width="${STROKE - 3}"/>`,
  lantern: `
    <rect x="72" y="44" width="112" height="16" rx="6" fill="currentColor"/>
    <rect x="86" y="60" width="84" height="132" rx="42" fill="none" stroke="currentColor" stroke-width="${STROKE - 2}"/>
    <path d="M104 60 L104 192 M128 54 L128 198 M152 60 L152 192" stroke="currentColor" stroke-width="${STROKE - 4}" opacity="0.7"/>
    <rect x="72" y="192" width="112" height="16" rx="6" fill="currentColor"/>`,
  boat: `
    <path d="M20 168 Q128 208 236 168 Q128 188 20 168 Z" fill="none" stroke="currentColor" stroke-width="${STROKE - 3}" stroke-linejoin="round"/>
    <path d="M40 156 Q128 186 216 156" fill="none" stroke="currentColor" stroke-width="${STROKE - 3}"/>
    <path d="M92 148 L64 108 M128 150 L128 96 M164 148 L192 108" stroke="currentColor" stroke-width="${STROKE - 3}" stroke-linecap="round"/>`,
  film: `
    <rect x="40" y="64" width="176" height="128" rx="10" fill="none" stroke="currentColor" stroke-width="${STROKE - 2}"/>
    <g fill="currentColor">
      <rect x="52" y="76" width="16" height="12" rx="3"/><rect x="52" y="100" width="16" height="12" rx="3"/>
      <rect x="52" y="124" width="16" height="12" rx="3"/><rect x="52" y="148" width="16" height="12" rx="3"/>
      <rect x="188" y="76" width="16" height="12" rx="3"/><rect x="188" y="100" width="16" height="12" rx="3"/>
      <rect x="188" y="124" width="16" height="12" rx="3"/><rect x="188" y="148" width="16" height="12" rx="3"/>
    </g>`,
  pin: `
    <path d="M128 32 C86 32 56 64 56 104 C56 156 128 224 128 224 C128 224 200 156 200 104 C200 64 170 32 128 32 Z"
      fill="none" stroke="currentColor" stroke-width="${STROKE - 2}" stroke-linejoin="round"/>
    <circle cx="128" cy="104" r="26" fill="none" stroke="currentColor" stroke-width="${STROKE - 3}"/>`,
};

const ASSETS = [
  {
    slug: "camera-body",
    w: 640,
    h: 400,
    body: (c) => `
      <rect x="40" y="90" width="560" height="270" rx="36" fill="none" stroke="${c}" stroke-width="${STROKE}"/>
      <rect x="200" y="46" width="130" height="44" rx="12" fill="none" stroke="${c}" stroke-width="${STROKE}"/>
      <circle cx="320" cy="225" r="92" fill="none" stroke="${c}" stroke-width="${STROKE}"/>
      <circle cx="320" cy="225" r="46" fill="none" stroke="${c}" stroke-width="${STROKE - 2}"/>
      <circle cx="520" cy="140" r="14" fill="${c}"/>`,
  },
  {
    slug: "phone-frame",
    w: 360,
    h: 640,
    body: (c) => `
      <rect x="22" y="22" width="316" height="596" rx="52" fill="none" stroke="${c}" stroke-width="${STROKE}"/>
      <rect x="60" y="60" width="150" height="150" rx="30" fill="none" stroke="${c}" stroke-width="${STROKE - 2}"/>
      <circle cx="95" cy="95" r="18" fill="none" stroke="${c}" stroke-width="${STROKE - 4}"/>
      <circle cx="160" cy="95" r="13" fill="${c}"/>
      <circle cx="95" cy="160" r="13" fill="${c}"/>`,
  },
  {
    slug: "film-strip",
    w: 1600,
    h: 110,
    body: (c) => sprockets(1600, true).replaceAll("currentColor", c),
  },
  {
    slug: "film-strip-v",
    w: 110,
    h: 1600,
    body: (c) => sprockets(1600, false).replaceAll("currentColor", c),
  },
  {
    slug: "film-edge",
    w: 1600,
    h: 64,
    body: (c) => filmEdge(1600).replaceAll("currentColor", c),
  },
  {
    slug: "barcode",
    w: 512,
    h: 128,
    body: (c) => barcode(512, 128).replaceAll("currentColor", c),
  },
  {
    slug: "stamp-card",
    w: 520,
    h: 640,
    body: (c) => `<path d="${perforatedCard(520, 640, 16)}" fill="${c}"/>`,
    // Perforated cards are paper-colored in both variants.
    colors: [["", "#FFFFFF"], ["-light", "#FAF8F3"]],
  },
  ...Object.entries(ICONS).map(([slug, body]) => ({
    slug: `icon-${slug}`,
    w: 256,
    h: 256,
    body: (c) => body.replaceAll("currentColor", c),
  })),
  {
    slug: "seal-red",
    w: 256,
    h: 256,
    body: () => `
      <rect x="10" y="10" width="236" height="236" rx="26" fill="#C8102E"/>
      <rect x="42" y="42" width="172" height="172" fill="none" stroke="#FFFFFF" stroke-width="10"/>
      <path d="M80 92 L176 92 M80 128 L176 128 M80 164 L140 164" stroke="#FFFFFF" stroke-width="12" stroke-linecap="square"/>`,
  },
];

let count = 0;
for (const a of ASSETS) {
  const variants = a.colors ?? [["", "#111111"], ["-light", "#F2F2F0"]];
  for (const [variant, color] of variants) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a.w} ${a.h}" width="${a.w}" height="${a.h}">${a.body(color)}</svg>`;
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: a.w } });
    const png = resvg.render().asPng();
    writeFileSync(join(OUT, `${a.slug}${variant}.png`), png);
    writeFileSync(join(WEB, `${a.slug}${variant}.png`), png);
    count += 1;
    console.log(`${a.slug}${variant}.png ${(png.length / 1024).toFixed(1)} KB`);
  }
}
console.log(`frame assets done (${count} files)`);

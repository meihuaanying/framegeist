// Generates original line-art frame assets (camera body, phone, film strip)
// with resvg — authored in-house, not copied from any product.
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
    body: (c) => {
      let holes = "";
      for (let x = 30; x < 1560; x += 80) {
        holes += `<rect x="${x}" y="18" width="42" height="28" rx="7" fill="${c}"/>`;
        holes += `<rect x="${x}" y="64" width="42" height="28" rx="7" fill="${c}"/>`;
      }
      return holes;
    },
  },
];

for (const a of ASSETS) {
  for (const [variant, color] of [["", "#111111"], ["-light", "#F2F2F0"]]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a.w} ${a.h}" width="${a.w}" height="${a.h}">${a.body(color)}</svg>`;
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: a.w } });
    const png = resvg.render().asPng();
    writeFileSync(join(OUT, `${a.slug}${variant}.png`), png);
    writeFileSync(join(WEB, `${a.slug}${variant}.png`), png);
    console.log(`${a.slug}${variant}.png ${(png.length / 1024).toFixed(1)} KB`);
  }
}
console.log("frame assets done");

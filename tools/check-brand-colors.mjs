// v0.9.0 asset gate: verifies the badge variant matrix and that the primary
// variant really carries the official brand color (and that mono brands stay
// monochrome). Uses a minimal PNG decoder (resvg output is 8-bit RGBA/RGB,
// non-interlaced) so the gate has zero runtime dependencies.
//
// Usage: node tools/check-brand-colors.mjs
import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";

const COLORS = JSON.parse(readFileSync("tools/brand-colors.json", "utf8"));
const MANIFEST = JSON.parse(readFileSync("web/brand/index.json", "utf8"));

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

function pixelStats(png) {
  const { width, height, channels, data } = png;
  let n = 0;
  let satSum = 0;
  let hueX = 0;
  let hueY = 0;
  let dark = 0;
  let light = 0;
  const hueBuckets = new Array(12).fill(0);
  let satTotal = 0;
  // v1.1.0: ink box. The engine sizes a badge by height and derives its width from the
  // CANVAS aspect ratio, so a non-square canvas silently inflates the drawn mark.
  let inkX0 = width;
  let inkY0 = height;
  let inkX1 = -1;
  let inkY1 = -1;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const a = channels === 4 ? data[o + 3] : 255;
    if (a < 128) continue;
    const x = i % width;
    const y = (i / width) | 0;
    if (x < inkX0) inkX0 = x;
    if (y < inkY0) inkY0 = y;
    if (x > inkX1) inkX1 = x;
    if (y > inkY1) inkY1 = y;
    const r = data[o] / 255;
    const g = data[o + 1] / 255;
    const b = data[o + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
    n += 1;
    satSum += s;
    if (l < 0.25) dark += 1;
    if (l > 0.75) light += 1;
    if (s > 0.1 && max > min) {
      let h;
      if (max === r) h = ((g - b) / (max - min)) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      h = ((h * 60) + 360) % 360;
      const rad = (h * Math.PI) / 180;
      hueX += Math.cos(rad) * s;
      hueY += Math.sin(rad) * s;
    }
    // v1.1.0: dominant-hue share over the saturated pixels. Official wordmarks mix a black
    // letterform with a small coloured accent, so mean saturation over the whole ink box
    // cannot tell "brand colour" from "mostly black with an accent".
    if (s >= 0.25 && max * 255 >= 40) {
      let h;
      if (max === r) h = ((g - b) / (max - min)) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      h = ((h * 60) + 360) % 360;
      hueBuckets[Math.floor(h / 30) % 12] += 1;
      satTotal += 1;
    }
  }
  const meanSat = n ? satSum / n : 0;
  const meanHue = hueX === 0 && hueY === 0 ? null : ((Math.atan2(hueY, hueX) * 180) / Math.PI + 360) % 360;
  const hueShare = satTotal < 12 ? 0 : Math.max(...hueBuckets) / satTotal;
  const ink = inkX1 < 0 ? null : { x0: inkX0, y0: inkY0, x1: inkX1, y1: inkY1, w: inkX1 - inkX0 + 1, h: inkY1 - inkY0 + 1 };
  return {
    n,
    meanSat,
    meanHue,
    hueShare,
    darkRatio: n ? dark / n : 0,
    lightRatio: n ? light / n : 0,
    width,
    height,
    ink,
    padY: ink ? [ink.y0, height - 1 - ink.y1] : null,
    padX: ink ? [ink.x0, width - 1 - ink.x1] : null,
  };
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function hexToHue(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  let h;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  return ((h * 60) + 360) % 360;
}

const failures = [];
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name} ${detail}`);
};

check("manifest version 5", MANIFEST.version === 5, `v${MANIFEST.version}`);
check("color rule locked", typeof COLORS.rule === "string" && COLORS.icons && Object.keys(COLORS.icons).length >= 15, COLORS.rule);

const brandBySlug = new Map();
for (const g of ["camera", "phone", "lens"]) {
  for (const i of MANIFEST.groups[g] ?? []) if (!brandBySlug.has(i.slug)) brandBySlug.set(i.slug, i);
}
const brandItems = [...brandBySlug.values()];
const colorful = brandItems.filter((i) => i.color);
const colorLock = (slug) =>
  COLORS.icons?.[slug]?.colorful ? COLORS.icons[slug].hex : (COLORS.originalColorOverride?.[slug] ?? null);
check("manifest has colorful brands", colorful.length >= 10, `${colorful.length}`);
// v1.1.0: brands re-rendered from official artwork record the colour measured from the
// shipped asset (dominant hue), so they no longer mirror the Simple Icons lock entry.
const locked = colorful.filter((i) => !i.officialAsset);
check("manifest colorful matches lock file", locked.every((i) => colorLock(i.slug) === i.color), locked.map((i) => i.slug).join(","));

const fileVariants = { brand: ["", "-mono", "-light"], lockup: ["", "-mono", "-light"], series: ["", "-light"], game: ["", "-light"] };
const read = (dir, sub, slug, variant) => {
  const p = `${dir}/${sub}${slug}${variant}.png`;
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  return pixelStats(decodePng(readFileSync(p)));
};

for (const item of brandItems) {
  for (const variant of fileVariants.brand) read("templates/assets/brand", "", item.slug, variant);
  for (const variant of fileVariants.brand) read("web/brand", "thumbs/", item.slug, variant);
  const primary = read("templates/assets/brand", "", item.slug, "");
  const mono = read("templates/assets/brand", "", item.slug, "-mono");
  const light = read("templates/assets/brand", "", item.slug, "-light");
  if (item.color) {
    const hue = hexToHue(item.color);
    check(
      `brand ${item.slug}: primary is ${item.color}`,
      primary.hueShare >= 0.5 && hue != null && primary.meanHue != null && hueDistance(primary.meanHue, hue) <= 45,
      `share=${primary.hueShare.toFixed(2)} hue=${primary.meanHue?.toFixed(0)} want=${hue?.toFixed(0)}`,
    );
    if (!item.tintSkipped) {
      check(`brand ${item.slug}: mono variant stays black`, mono.meanSat < 0.12 && mono.darkRatio > 0.6, `sat=${mono.meanSat.toFixed(2)} dark=${mono.darkRatio.toFixed(2)}`);
      // A delivered official light variant (e.g. Meike's blue plate) is allowed to be coloured.
      if (!item.lightOfficial) {
        check(`brand ${item.slug}: light variant stays white`, light.meanSat < 0.12 && light.lightRatio > 0.6, `sat=${light.meanSat.toFixed(2)} light=${light.lightRatio.toFixed(2)}`);
      }
    }
  } else {
    check(`brand ${item.slug}: mono primary has no color`, primary.hueShare < 0.5, `share=${primary.hueShare.toFixed(2)}`);
  }
  // v1.1.0 geometry gate. The engine scales a badge by height and derives the drawn width
  // from the canvas aspect ratio, so the drawn size is governed by the ink height as a
  // fraction of the CANVAS height. A wordmark whose ink fills the canvas vertically gets
  // drawn several times too large and collides with the info block: that shipped once and
  // the colour gate could not see it. Square/icon marks may legitimately fill the canvas,
  // so the bound only applies to wide marks (ink aspect > 1.5).
  const WORDMARK_ASPECT = 2.2;
  // v1.1.0 geometry contract, measured against every pre-v1.1 asset: wordmarks (ink
// aspect > 2.2) keep ink height at 0.28-0.33 of the canvas, icons/squares fill it.
// A non-square or over-height canvas inflates the mark because the engine derives the
// badge width from the canvas aspect ratio — that is the regression this gate exists
// to catch. Threshold 0.34 leaves a little headroom over the legacy maximum (0.328).
const MAX_INK_HEIGHT_RATIO = 0.34;
  const geometryOk = (s) => {
    if (!s.ink) return false;
    const aspect = s.ink.w / s.ink.h;
    if (aspect <= WORDMARK_ASPECT) return true;
    return s.ink.h <= MAX_INK_HEIGHT_RATIO * s.height;
  };
  const geometryMsg = (s) =>
    `${s.width}x${s.height} ink=${s.ink ? `${s.ink.w}x${s.ink.h}` : "none"}` +
    ` aspect=${s.ink ? (s.ink.w / s.ink.h).toFixed(2) : "-"}` +
    ` inkH/canvasH=${s.ink ? (s.ink.h / s.height).toFixed(3) : "-"}`;
  check(`brand ${item.slug}: wordmark ink height stays bounded`, geometryOk(primary), geometryMsg(primary));
  if (!item.tintSkipped) {
    check(`brand ${item.slug}: mono wordmark ink height stays bounded`, geometryOk(mono), geometryMsg(mono));
  }
  if (!item.lightOfficial) {
    check(`brand ${item.slug}: light wordmark ink height stays bounded`, geometryOk(light), geometryMsg(light));
  }
}

const lockupItems = brandItems;
for (const item of lockupItems.slice(0, 60)) {
  const primary = read("templates/assets/lockup", "", item.slug, "");
  const mono = read("templates/assets/lockup", "", item.slug, "-mono");
  // v1.1.0: lockups are still the old synthetic composites and are not re-rendered from
  // official artwork, so a brand with an official asset keeps only the mono variant check.
  if (item.officialAsset) {
    check(`lockup ${item.slug}: mono variant stays black`, mono.meanSat < 0.12 && mono.darkRatio > 0.6, `sat=${mono.meanSat.toFixed(2)} dark=${mono.darkRatio.toFixed(2)}`);
    continue;
  }
  if (item.color) {
    const hue = hexToHue(item.color);
    check(
      `lockup ${item.slug}: primary is ${item.color}`,
      primary.meanSat >= 0.25 && hue != null && primary.meanHue != null && hueDistance(primary.meanHue, hue) <= 45,
      `sat=${primary.meanSat.toFixed(2)}`,
    );
  } else {
    check(`lockup ${item.slug}: stays mono`, primary.meanSat < 0.12, `sat=${primary.meanSat.toFixed(2)}`);
  }
  check(`lockup ${item.slug}: mono variant stays black`, mono.meanSat < 0.12, `sat=${mono.meanSat.toFixed(2)}`);
}

for (const group of ["series", "game"]) {
  for (const item of MANIFEST.groups[group] ?? []) {
    const primary = read(`templates/assets/${group}`, "", item.slug, "");
    read(`templates/assets/${group}`, "", item.slug, "-light");
    check(`${group} ${item.slug}: stays mono`, primary.meanSat < 0.12, `sat=${primary.meanSat.toFixed(2)}`);
  }
}

read("templates/assets/brand", "", "exif-auto", "");
read("templates/assets/brand", "", "exif-auto", "-light");

const okCount = checks.filter((c) => c.ok).length;
console.log(`brand color gate: ${okCount}/${checks.length} checks passed`);
if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exit(1);
}
console.log("brand color gate: variant matrix + official colors verified");

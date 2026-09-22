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
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const a = channels === 4 ? data[o + 3] : 255;
    if (a < 128) continue;
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
  }
  const meanSat = n ? satSum / n : 0;
  const meanHue = hueX === 0 && hueY === 0 ? null : ((Math.atan2(hueY, hueX) * 180) / Math.PI + 360) % 360;
  return { n, meanSat, meanHue, darkRatio: n ? dark / n : 0, lightRatio: n ? light / n : 0 };
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

check("manifest version 3", MANIFEST.version === 3, `v${MANIFEST.version}`);
check("color rule locked", typeof COLORS.rule === "string" && COLORS.icons && Object.keys(COLORS.icons).length >= 15, COLORS.rule);

const brandItems = (MANIFEST.groups.camera ?? []).filter((i) => i.official || i.color);
const colorful = brandItems.filter((i) => i.color);
const colorLock = (slug) =>
  COLORS.icons?.[slug]?.colorful ? COLORS.icons[slug].hex : (COLORS.originalColorOverride?.[slug] ?? null);
check("manifest has colorful brands", colorful.length >= 10, `${colorful.length}`);
check("manifest colorful matches lock file", colorful.every((i) => colorLock(i.slug) === i.color), colorful.map((i) => i.slug).join(","));

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
      primary.meanSat >= 0.25 && hue != null && primary.meanHue != null && hueDistance(primary.meanHue, hue) <= 45,
      `sat=${primary.meanSat.toFixed(2)} hue=${primary.meanHue?.toFixed(0)} want=${hue?.toFixed(0)}`,
    );
    check(`brand ${item.slug}: mono variant stays black`, mono.meanSat < 0.12 && mono.darkRatio > 0.6, `sat=${mono.meanSat.toFixed(2)} dark=${mono.darkRatio.toFixed(2)}`);
    check(`brand ${item.slug}: light variant stays white`, light.meanSat < 0.12 && light.lightRatio > 0.6, `sat=${light.meanSat.toFixed(2)} light=${light.lightRatio.toFixed(2)}`);
  } else {
    check(`brand ${item.slug}: mono primary has no color`, primary.meanSat < 0.12, `sat=${primary.meanSat.toFixed(2)}`);
  }
}

const lockupItems = (MANIFEST.groups.camera ?? []).filter((i) => i.slug);
for (const item of lockupItems.slice(0, 40)) {
  const primary = read("templates/assets/lockup", "", item.slug, "");
  const mono = read("templates/assets/lockup", "", item.slug, "-mono");
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

// Downloads 4 public-domain demo photos from the NASA Image Library
// (NASA media usage guidelines: most content is not copyrighted).
// Wikimedia/Openverse are unreachable from this network; NASA API works.
// Usage: node tools/fetch-pd-photos.mjs
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "templates/assets/photos";
mkdirSync(OUT, { recursive: true });
const UA = { "user-agent": "FrameGeist/0.2 (+https://github.com/meihuaanying/framegeist)" };

const SLOTS = [
  { name: "landscape", q: "earth surface daylight iss", fit: "landscape" },
  { name: "portrait", q: "astronaut portrait", fit: "portrait" },
  { name: "square", q: "moon phases full", fit: "square" },
  { name: "night", q: "earth at night city lights iss", fit: "landscape" },
];

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function fits(ratio, kind) {
  if (kind === "landscape") return ratio > 1.25;
  if (kind === "portrait") return ratio < 1.0;
  if (kind === "square") return ratio > 0.7 && ratio < 1.45;
  return true;
}

const credits = existsSync(join(OUT, "CREDITS.json")) ? JSON.parse(readFileSync(join(OUT, "CREDITS.json"), "utf8")) : {};

for (const slot of SLOTS) {
  console.log(`\n== ${slot.name}: "${slot.q}"`);
  let items = [];
  try {
    const res = await fetch(
      `https://images-api.nasa.gov/search?q=${encodeURIComponent(slot.q)}&media_type=image&page_size=25`,
      { headers: UA },
    );
    items = (await res.json()).collection.items ?? [];
  } catch (e) {
    console.log("search failed:", e.message);
    continue;
  }
  let picked = null;
  for (const it of items.slice(0, 12)) {
    const data = it.data?.[0];
    const href = it.links?.[0]?.href;
    if (!data || !href) continue;
    const variants = [
      href.replace("~medium.", "~large.").replace("~thumb.", "~large."),
      href.replace("~medium.", "~orig.").replace("~thumb.", "~orig."),
      href,
    ];
    for (const url of variants) {
      try {
        const bin = await fetch(url, { headers: UA });
        if (!bin.ok) continue;
        const buf = Buffer.from(await bin.arrayBuffer());
        const size = jpegSize(buf);
        if (!size || size.w < 1200) continue;
        const ratio = size.w / size.h;
        if (!fits(ratio, slot.fit)) continue;
        picked = { data, buf, size, ratio, url };
        break;
      } catch {
        continue;
      }
    }
    if (picked) break;
  }
  if (!picked) { console.log("no candidate fit"); continue; }
  const path = join(OUT, `${slot.name}.jpg`);
  writeFileSync(path, picked.buf);
  credits[slot.name] = {
    file: `${slot.name}.jpg`,
    title: picked.data.title,
    nasaId: picked.data.nasa_id,
    source: `https://images.nasa.gov/details/${picked.data.nasa_id}`,
    credit: picked.data.secondary_creator || picked.data.photographer || "NASA",
    license: "Public Domain (NASA media usage guidelines)",
    licenseUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    size: `${picked.size.w}x${picked.size.h}`,
    bytes: picked.buf.length,
  };
  console.log(`saved ${slot.name}.jpg ${picked.size.w}x${picked.size.h} (${(picked.buf.length / 1024 / 1024).toFixed(1)} MB) — ${picked.data.title}`);
}

writeFileSync(join(OUT, "CREDITS.json"), JSON.stringify(credits, null, 2) + "\n");
console.log("\nCREDITS.json updated");

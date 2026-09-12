// Downloads real-photography demo images for template previews/thumbnails
// (v0.4.0: real photos instead of museum paintings): 3 landscape, 2
// architecture, street, mist, dusk city, portrait, people, square — all from
// Lorem Picsum (Unsplash License, attribution appreciated).
// Usage: node tools/fetch-demo-photos.mjs
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const OUT = "templates/assets/photos";
mkdirSync(OUT, { recursive: true });
const UA = { "user-agent": "FrameGeist/0.4 (+https://github.com/meihuaanying/framegeist)" };

const JOBS = [
  { file: "landscape-1.jpg", id: 1015, w: 2400, h: 1600, subject: "fjord cliffs" },
  { file: "landscape-2.jpg", id: 1016, w: 2400, h: 1600, subject: "red rock canyon" },
  { file: "landscape-3.jpg", id: 1036, w: 2400, h: 1600, subject: "snow mountains" },
  { file: "architecture-1.jpg", id: 1029, w: 2400, h: 1600, subject: "city skyline" },
  { file: "architecture-2.jpg", id: 1040, w: 2400, h: 1600, subject: "castle" },
  { file: "street-1.jpg", id: 1071, w: 2400, h: 1600, subject: "classic car street" },
  { file: "mist-1.jpg", id: 1044, w: 2400, h: 1600, subject: "misty river" },
  { file: "night-1.jpg", id: 1067, w: 2400, h: 1600, subject: "city at dusk" },
  { file: "portrait-1.jpg", id: 1027, w: 1600, h: 2400, subject: "portrait" },
  { file: "people-1.jpg", id: 1011, w: 2400, h: 1600, subject: "person canoeing" },
  { file: "square-1.jpg", id: 1080, w: 1600, h: 1600, subject: "strawberries" },
];

const REMOVED = ["architecture-3.jpg"];

async function info(id) {
  try {
    const res = await fetch(`https://picsum.photos/id/${id}/info`, { headers: UA });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function download(url, path) {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 30_000) throw new Error(`too small (${buf.length})`);
  writeFileSync(path, buf);
  return buf.length;
}

for (const f of REMOVED) {
  try { rmSync(join(OUT, f), { force: true }); } catch { /* ignore */ }
}

const credits = {};
for (const job of JOBS) {
  const path = join(OUT, job.file);
  const meta = await info(job.id);
  const url = `https://picsum.photos/id/${job.id}/${job.w}/${job.h}.jpg`;
  try {
    const size = await download(url, path);
    credits[job.file] = {
      title: `${job.subject} (Picsum #${job.id})`,
      author: meta?.author ? `${meta.author} via Lorem Picsum` : "Unsplash contributor via Lorem Picsum",
      source: `https://picsum.photos/id/${job.id}/info`,
      license: "Unsplash License (free to use; attribution appreciated)",
      url,
      bytes: size,
    };
    console.log(`${job.file}: ${(size / 1024).toFixed(0)} KB — ${job.subject}`);
  } catch (e) {
    console.log(`${job.file}: FAILED ${e.message}`);
  }
}

writeFileSync(join(OUT, "CREDITS-DEMO.json"), JSON.stringify(credits, null, 2) + "\n");
console.log("CREDITS-DEMO.json updated");

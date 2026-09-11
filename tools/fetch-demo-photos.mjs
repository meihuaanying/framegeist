// Downloads 6 demo photos for template previews/thumbnails:
// 3 landscape + 3 architecture, CC0 from the Cleveland Museum of Art
// (open access API) plus one real photograph from Lorem Picsum (Unsplash).
// Records sources in CREDITS.json. Usage: node tools/fetch-demo-photos.mjs
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "templates/assets/photos";
mkdirSync(OUT, { recursive: true });
const UA = { "user-agent": "FrameGeist/0.3 (+https://github.com/meihuaanying/framegeist)" };

async function cleveland(q, want) {
  const url = `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q)}&cc0=1&has_image=1&limit=25&fields=id,title,creation_date,creators,images,share_license_status,url`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const out = [];
  for (const a of json.data ?? []) {
    if (a.share_license_status && a.share_license_status !== "CC0") continue;
    const img = a.images?.web?.url ?? a.images?.print?.url;
    if (!img) continue;
    out.push({
      title: a.title ?? "untitled",
      author: (a.creators?.[0]?.description ?? "Cleveland Museum of Art").replace(/<[^>]+>/g, ""),
      source: a.url ?? "https://www.clevelandart.org",
      license: "CC0-1.0 (Cleveland Museum of Art Open Access)",
      url: img,
    });
    if (out.length >= want) break;
  }
  return out;
}

async function download(url, path) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 30_000) throw new Error(`too small (${buf.length})`);
  writeFileSync(path, buf);
  return buf.length;
}

const credits = existsSync(join(OUT, "CREDITS-DEMO.json"))
  ? JSON.parse(readFileSync(join(OUT, "CREDITS-DEMO.json"), "utf8"))
  : {};

const jobs = [
  { file: "landscape-1.jpg", source: () => cleveland("landscape painting", 2).then((r) => r[0]) },
  { file: "landscape-2.jpg", source: () => cleveland("landscape print", 3).then((r) => r[1]) },
  { file: "landscape-3.jpg", source: async () => ({
      title: "Mountain river (Lorem Picsum #1015)",
      author: "Unsplash contributor via Lorem Picsum",
      source: "https://picsum.photos/id/1015/info",
      license: "Unsplash License (free to use; attribution appreciated)",
      url: "https://picsum.photos/id/1015/2400/1600.jpg",
    }) },
  { file: "architecture-1.jpg", source: () => cleveland("architecture drawing", 2).then((r) => r[0]) },
  { file: "architecture-2.jpg", source: () => cleveland("cathedral church building", 3).then((r) => r[1]) },
  { file: "architecture-3.jpg", source: async () => ({
      title: "City architecture (Lorem Picsum #1076)",
      author: "Unsplash contributor via Lorem Picsum",
      source: "https://picsum.photos/id/1076/info",
      license: "Unsplash License (free to use; attribution appreciated)",
      url: "https://picsum.photos/id/1076/1600/2400.jpg",
    }) },
];

for (const job of jobs) {
  const path = join(OUT, job.file);
  try {
    const meta = await job.source();
    if (!meta) { console.log(`${job.file}: no candidate`); continue; }
    const size = await download(meta.url, path);
    credits[job.file] = { ...meta, bytes: size };
    console.log(`${job.file}: ${(size / 1024).toFixed(0)} KB — ${meta.title.slice(0, 60)}`);
  } catch (e) {
    console.log(`${job.file}: FAILED ${e.message}`);
  }
}

writeFileSync(join(OUT, "CREDITS-DEMO.json"), JSON.stringify(credits, null, 2) + "\n");
console.log("CREDITS-DEMO.json updated");

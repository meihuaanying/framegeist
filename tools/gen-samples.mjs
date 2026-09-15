// Renders per-template samples/previews/thumbs from the v0.5.0 showcase photo
// map (tools/fetch-showcase-photos.mjs), then mirrors the small sizes to web/.
//   samples/<id>.jpg   900px  (site wall + report reference)
//   previews/<id>.jpg  640px  (wall cards + in-app Lightbox)
//   thumbs/<id>.jpg    240px  (picker grid)
// Usage: node tools/gen-samples.mjs [--concurrency 4] [--only id1,id2,...]
//   --only renders just the listed templates and skips the full-tree wipe.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CONC = (() => {
  const i = process.argv.indexOf("--concurrency");
  return i >= 0 ? Number(process.argv[i + 1]) || 4 : 4;
})();
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  if (i < 0) return null;
  return new Set((process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
})();

function cliPath() {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const p of ["target/release/framegeist", "target/debug/framegeist"]) {
    const full = join(ROOT, p + exe);
    if (existsSync(full)) return full;
  }
  throw new Error("framegeist CLI missing: run cargo build --release -p framegeist-cli");
}
const CLI = cliPath();

const map = JSON.parse(readFileSync(join(ROOT, "templates/assets/photos/showcase-map.json"), "utf8"));
const ids = execFileSync(CLI, ["templates"], { cwd: ROOT })
  .toString()
  .trim()
  .split(/\r?\n/)
  .map((l) => l.split("\t")[0])
  .filter(Boolean);
if (ids.length === 0) throw new Error("no templates listed");

for (const dir of ["templates/samples", "templates/previews", "templates/thumbs"]) {
  mkdirSync(join(ROOT, dir), { recursive: true });
  if (ONLY) continue;
  for (const f of readdirSync(join(ROOT, dir))) {
    if (f.endsWith(".jpg")) rmSync(join(ROOT, dir, f));
  }
}

function renderOne(args) {
  return new Promise((resolve) => {
    execFile(CLI, args, { cwd: ROOT }, (err) => resolve(err ? `FAIL ${args[2]}` : null));
  });
}

const jobs = [];
const failed = [];
for (const id of ONLY ? ids.filter((x) => ONLY.has(x)) : ids) {
  const entry = map[id];
  if (!entry?.file) {
    failed.push(`${id} (no showcase entry)`);
    continue;
  }
  const photo = join(ROOT, "templates/assets/photos", entry.file);
  jobs.push([photo, id, 900, "templates/samples"]);
  jobs.push([photo, id, 640, "templates/previews"]);
  jobs.push([photo, id, 240, "templates/thumbs"]);
}
console.log(`rendering ${jobs.length} samples from ${ids.length} showcase photos…`);

let next = 0;
let done = 0;
async function worker() {
  while (next < jobs.length) {
    const [photo, id, edge, dir] = jobs[next++];
    const out = join(ROOT, dir, `${id}.jpg`);
    rmSync(out, { force: true });
    const err = await renderOne(["render", photo, "--template", id, "--max-edge", String(edge), "-o", out]);
    if (err) failed.push(`${id}@${edge}`);
    done++;
    if (done % 46 === 0) console.log(`… ${done}/${jobs.length}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, worker));

if (failed.length) {
  console.log(`failed ${failed.length}: ${failed.slice(0, 10).join(", ")}`);
  process.exit(1);
}

for (const [src, dst] of [["templates/thumbs", "web/thumbs"], ["templates/previews", "web/previews"]]) {
  mkdirSync(join(ROOT, dst), { recursive: true });
  for (const f of readdirSync(join(ROOT, dst))) {
    if (f.endsWith(".jpg")) rmSync(join(ROOT, dst, f));
  }
  for (const f of readdirSync(join(ROOT, src))) {
    if (f.endsWith(".jpg")) copyFileSync(join(ROOT, src, f), join(ROOT, dst, f));
  }
}
console.log(`rendered=${jobs.length / 3} failed=0; thumbs+previews mirrored to web/`);

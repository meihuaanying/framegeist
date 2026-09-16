// v0.5.0 T1 gate — showcase photo uniquification.
// v0.6.0: adds showcase EXIF authenticity (real camera data injected from the
// three user-provided sample photos, docs/reports/v0.6.0/source-exif.json).
//
// Verifies per docs/V0.5.0-CONSTRAINTS.md §1 and docs/V0.6.0-CONSTRAINTS.md §M1:
//   1. every template (192+) has exactly one showcase photo;
//   2. all showcase photos are byte-unique (SHA-256);
//   3. orientation rules hold (portrait categories must be portrait);
//   4. tone bias holds in aggregate (dark categories visibly darker than bright);
//   5. showcase tree contains zero test photos;
//   6. rendered samples/previews/thumbs are one-per-template and unique;
//   7. every showcase photo carries real EXIF and follows the orientation->camera map.
//
// Usage: node tools/check-photo-uniqueness.mjs
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PHOTOS = join(ROOT, "templates/assets/photos");
const SHOWCASE = join(PHOTOS, "showcase");
const PORTRAIT_CATS = new Set(["phone", "personal", "polaroid", "ticket", "calendar"]);
const DARK_CATS = new Set(["blur-bg", "effect", "film", "black-frame"]);
const BRIGHT_CATS = new Set(["white-border", "portfolio", "minimal"]);
const SHOW_DIRS = ["templates/samples", "templates/previews", "templates/thumbs", "web/previews", "web/thumbs"];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function cliPath() {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const p of ["target/release/framegeist", "target/debug/framegeist"]) {
    const full = join(ROOT, p + exe);
    if (existsSync(full)) return full;
  }
  throw new Error("framegeist CLI missing");
}

const templates = [];
for (const file of readdirSync(join(ROOT, "templates"))) {
  if (!file.endsWith(".json")) continue;
  const raw = JSON.parse(readFileSync(join(ROOT, "templates", file), "utf8"));
  if (raw.meta?.id) templates.push({ id: raw.meta.id, category: raw.meta.category });
}
templates.sort((a, b) => (a.id < b.id ? -1 : 1));
const total = templates.length;
check("showcase: >=192 templates", total >= 192, `${total} templates`);

const map = JSON.parse(readFileSync(join(PHOTOS, "showcase-map.json"), "utf8"));
const missingMap = templates.filter((t) => !map[t.id]);
check("showcase: every template mapped", missingMap.length === 0, missingMap.slice(0, 3).map((t) => t.id).join(", "));

const hashes = new Map();
const dupes = [];
const stats = new Map();
const exif = new Map();
let missingFile = 0;
for (const t of templates) {
  const file = join(SHOWCASE, `${t.id}.jpg`);
  if (!existsSync(file)) {
    missingFile++;
    continue;
  }
  const buf = readFileSync(file);
  const h = sha(buf);
  if (hashes.has(h)) dupes.push(`${t.id} == ${hashes.get(h)}`);
  hashes.set(h, t.id);
  const out = JSON.parse(execFileSync(cliPath(), ["photo-stats", file], { cwd: ROOT }).toString());
  stats.set(t.id, out);
  exif.set(t.id, JSON.parse(execFileSync(cliPath(), ["probe", file], { cwd: ROOT }).toString()));
}
check("showcase: files exist for every template", missingFile === 0, `missing ${missingFile}`);
check("showcase: byte-unique photos", dupes.length === 0, dupes.slice(0, 3).join("; "));

const EXIF_FIELDS = ["lens", "focal_mm", "aperture", "shutter", "iso", "datetime"];
const emptyExif = [];
for (const t of templates) {
  const e = exif.get(t.id);
  if (!e) continue;
  const filled = EXIF_FIELDS.filter((k) => e[k] !== null && e[k] !== undefined && e[k] !== "");
  if (!e.model || filled.length < 4) emptyExif.push(`${t.id} model=${e.model} fields=${filled.length}`);
}
check("showcase: every photo carries real EXIF", emptyExif.length === 0, emptyExif.slice(0, 3).join("; "));

const CAMERA_BY_SOURCE = { "sony-a7r3": "ILCE-7RM3", "nikon-z6ii": "NIKON Z 6_2", "canon-r7": "Canon EOS R7" };
const mapSource = JSON.parse(readFileSync(join(PHOTOS, "showcase-map.json"), "utf8"));
const wrongCam = [];
const camCounts = { "NIKON Z 6_2": 0, "Canon EOS R7": 0, "ILCE-7RM3": 0 };
for (const t of templates) {
  const e = exif.get(t.id);
  if (!e) continue;
  const portrait = stats.get(t.id)?.height > stats.get(t.id)?.width;
  const want = portrait ? "ILCE-7RM3" : null;
  if (want && e.model !== want) wrongCam.push(`${t.id} portrait model=${e.model}`);
  if (!want && !["NIKON Z 6_2", "Canon EOS R7"].includes(e.model)) wrongCam.push(`${t.id} landscape model=${e.model}`);
  const src = mapSource[t.id]?.exif_source;
  if (src && CAMERA_BY_SOURCE[src] !== e.model) wrongCam.push(`${t.id} map=${src} probe=${e.model}`);
  if (camCounts[e.model] !== undefined) camCounts[e.model]++;
}
check("showcase: EXIF matches the orientation->camera map", wrongCam.length === 0, wrongCam.slice(0, 3).join("; "));
const totalCam = Object.values(camCounts).reduce((a, b) => a + b, 0);
const minShare = Math.min(...Object.values(camCounts)) / Math.max(1, totalCam);
check("showcase: camera distribution is balanced", minShare >= 0.15, JSON.stringify(camCounts));

const wrongOrient = [];
for (const t of templates) {
  const s = stats.get(t.id);
  if (!s) continue;
  const portrait = s.height > s.width;
  if (PORTRAIT_CATS.has(t.category) && !portrait) wrongOrient.push(`${t.id} ${s.width}x${s.height}`);
  if (!PORTRAIT_CATS.has(t.category) && portrait && t.category !== "game") {
    // landscape templates may still accept a portrait game/other photo; record only.
    wrongOrient.push(`(soft) ${t.id} ${s.width}x${s.height}`);
  }
}
const hardWrong = wrongOrient.filter((x) => !x.startsWith("(soft)"));
check("showcase: portrait categories get portrait photos", hardWrong.length === 0, hardWrong.slice(0, 3).join("; "));

const avg = (set) => {
  const vals = [...set].map((id) => stats.get(id)?.luminance).filter((v) => typeof v === "number");
  return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
};
const darkLum = avg(new Set(templates.filter((t) => DARK_CATS.has(t.category)).map((t) => t.id)));
const brightLum = avg(new Set(templates.filter((t) => BRIGHT_CATS.has(t.category)).map((t) => t.id)));
check(
  "showcase: dark categories are darker than bright",
  darkLum < brightLum - 0.04,
  `dark ${darkLum.toFixed(3)} vs bright ${brightLum.toFixed(3)}`,
);

const testDir = join(ROOT, "templates/assets/test-photos");
const testHashes = new Set();
if (existsSync(testDir)) {
  for (const f of readdirSync(testDir)) {
    if (/\.(jpe?g|png|webp|tiff?)$/i.test(f)) testHashes.add(sha(readFileSync(join(testDir, f))));
  }
}
const leaked = [...hashes.keys()].filter((h) => testHashes.has(h));
check("showcase: zero test photos", leaked.length === 0, `test hashes ${testHashes.size}`);

let showOK = true;
let showDetail = "";
for (const dir of SHOW_DIRS) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  const files = readdirSync(full).filter((f) => /\.(jpe?g|png)$/i.test(f));
  const hs = new Set();
  let dup = 0;
  for (const f of files) {
    const h = sha(readFileSync(join(full, f)));
    if (hs.has(h)) dup++;
    hs.add(h);
  }
  const expected = dir.startsWith("templates/") ? total : null;
  const countOK = expected === null ? true : files.length === expected;
  if (dup > 0 || !countOK) {
    showOK = false;
    showDetail += `${dir}: ${files.length} files, ${dup} dupes; `;
  }
}
check("showcase: sample mirrors complete and unique", showOK, showDetail || "samples/previews/thumbs");

console.log(failures === 0 ? "\nphoto uniqueness: all gates green" : `\nphoto uniqueness: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

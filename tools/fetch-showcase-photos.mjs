// v0.5.0 T1 — showcase photo uniquification pipeline.
//
// Assigns one globally unique photo to every template (184/184), downloads new
// ones from Lorem Picsum (Unsplash License), and writes:
//   templates/assets/photos/showcase/<template-id>.jpg  (one photo per template)
//   templates/assets/photos/showcase-map.json           (template id -> photo + stats)
//   templates/assets/photos/CREDITS-DEMO.json           (full provenance list)
//
// Matching rules (docs/V0.5.0-CONSTRAINTS.md §1):
//   - orientation: portrait categories (phone/personal/polaroid/ticket/calendar)
//     must get portrait photos; everything else gets landscape photos.
//   - tone: blur-bg/effect/film/black-frame prefer dark; white-border/portfolio/
//     minimal prefer bright; colorful/colorcard/festival prefer saturated.
//   - content safety: skip ids known to be plain-text/unsafe; cap each author to
//     at most 3 photos; fully deterministic via seeded PRNG.
//
// Usage: node tools/fetch-showcase-photos.mjs [--no-download] [--only id1,id2]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PHOTOS = join(ROOT, "templates/assets/photos");
const SHOWCASE = join(PHOTOS, "showcase");
const SMALL = join(ROOT, ".cache/showcase-small");
const SEED = 20260914;
const UA = { "user-agent": "FrameGeist/0.5 (+https://github.com/meihuaanying/framegeist)" };
const DL_FLAGS = new Set(process.argv.slice(2));
const NO_DOWNLOAD = DL_FLAGS.has("--no-download");
const ONLY = (() => {
  const raw = process.argv.find((a) => a.startsWith("--only="));
  return raw ? new Set(raw.slice("--only=".length).split(",").filter(Boolean)) : null;
})();
// --extend: assign only templates missing from showcase-map.json (new v0.5
// art templates), keeping every existing assignment untouched.
const EXTEND = DL_FLAGS.has("--extend");

const PORTRAIT_CATS = new Set(["phone", "personal", "polaroid", "ticket", "calendar"]);
const DARK_CATS = new Set(["blur-bg", "effect", "film", "black-frame"]);
const BRIGHT_CATS = new Set(["white-border", "portfolio", "minimal"]);
const SAT_CATS = new Set(["colorful", "colorcard", "festival"]);
// Picsum ids that are plain text / unsuitable as showcase photography.
const SKIP_IDS = new Set(["24", "30", "42", "48", "60", "91", "119", "145", "160", "177", "180", "202", "237", "249", "256", "265", "287", "323", "340", "351", "367", "403", "420", "445", "467", "488", "501", "519", "536", "555", "572", "590", "607", "625", "644", "663", "681", "700"]);
// The eleven v0.4.0 photos stay in use, each bound to exactly one template.
const EXISTING = [
  { file: "landscape-1.jpg", categories: ["drone"] },
  { file: "landscape-2.jpg", categories: ["fuji"] },
  { file: "landscape-3.jpg", categories: ["sports"] },
  { file: "architecture-1.jpg", categories: ["white-border"] },
  { file: "architecture-2.jpg", categories: ["colorwalk"] },
  { file: "street-1.jpg", categories: ["camera"] },
  { file: "mist-1.jpg", categories: ["portfolio"] },
  { file: "night-1.jpg", categories: ["effect"] },
  { file: "portrait-1.jpg", categories: ["personal"] },
  { file: "people-1.jpg", categories: ["magazine"] },
  { file: "square-1.jpg", categories: ["colorful"] },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function cliPath() {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const p of ["target/release/framegeist", "target/debug/framegeist"]) {
    const full = join(ROOT, p + exe);
    if (existsSync(full)) return full;
  }
  throw new Error("framegeist CLI missing: cargo build -p framegeist-cli");
}

function photoStats(file) {
  const out = execFileSync(cliPath(), ["photo-stats", file], { cwd: ROOT });
  return JSON.parse(out.toString());
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function fetchRetry(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, redirect: "follow" });
      if (res.status === 404) throw new Error("404");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (e.message === "404") throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

async function poolMap(items, fn, concurrency = 6) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

function loadTemplates() {
  const list = [];
  for (const file of readdirSync(join(ROOT, "templates"))) {
    if (!file.endsWith(".json")) continue;
    const raw = JSON.parse(readFileSync(join(ROOT, "templates", file), "utf8"));
    if (!raw.meta?.id) continue;
    list.push({ id: raw.meta.id, category: raw.meta.category });
  }
  list.sort((a, b) => (a.id < b.id ? -1 : 1));
  return list;
}

async function fetchPool() {
  const pool = [];
  for (let page = 1; page <= 15; page++) {
    const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=100`, { headers: UA });
    if (!res.ok) break;
    const items = await res.json();
    if (!items.length) break;
    for (const it of items) {
      const w = Number(it.width);
      const h = Number(it.height);
      pool.push({ id: String(it.id), author: it.author, w, h, url: it.url });
    }
    if (items.length < 100) break;
  }
  return pool;
}

function orientationOf(w, h) {
  if (h >= w * 1.15) return "portrait";
  if (w >= h * 1.15) return "landscape";
  return "square";
}

async function main() {
  mkdirSync(SHOWCASE, { recursive: true });
  mkdirSync(SMALL, { recursive: true });
  let templates = loadTemplates();
  console.log(`templates: ${templates.length}`);

  // Extend mode: keep existing assignments, only fill missing templates.
  const mapFile = join(PHOTOS, "showcase-map.json");
  const creditsFile = join(PHOTOS, "CREDITS-DEMO.json");
  const prevMap = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, "utf8")) : {};
  const prevCredits = existsSync(creditsFile) ? JSON.parse(readFileSync(creditsFile, "utf8")) : {};
  if (EXTEND) {
    const missing = templates.filter((t) => !prevMap[t.id]);
    console.log(`extend: ${missing.length} missing template(s)`);
    templates = missing;
  }

  // 1. existing-photo bindings: first template (by id) of each listed category.
  // A demo photo already bound elsewhere is never rebound (uniqueness).
  const usedExisting = {};
  const assignments = new Map(); // templateId -> { kind: "existing", file }
  {
    const boundFiles = new Set();
    for (const entry of Object.values(prevMap)) {
      if (entry.source?.startsWith("existing:")) {
        boundFiles.add(entry.source.slice("existing:".length));
      }
    }
    for (const e of EXISTING) {
      if (boundFiles.has(e.file)) continue;
      const tpl = templates.find((t) => e.categories.includes(t.category) && !assignments.has(t.id));
      if (tpl) {
        assignments.set(tpl.id, { kind: "existing", file: e.file });
        usedExisting[e.file] = tpl.id;
      }
    }
  }
  console.log(`existing photos bound: ${[...assignments.values()].filter((a) => a.kind === "existing").length}`);

  const need = templates.filter((t) => !assignments.has(t.id));
  const needPortrait = need.filter((t) => PORTRAIT_CATS.has(t.category)).length;
  const needLandscape = need.length - needPortrait;
  console.log(`need: ${need.length} (portrait ${needPortrait}, landscape ${needLandscape})`);

  // 2. candidate pool -> small stats.
  const pool = await fetchPool();
  const candidates = [];
  for (const p of shuffled(pool)) {
    if (SKIP_IDS.has(p.id)) continue;
    const o = orientationOf(p.w, p.h);
    if (o === "square") continue;
    candidates.push({ ...p, orientation: o });
  }
  const byOrient = { portrait: [], landscape: [] };
  for (const c of candidates) byOrient[c.orientation].push(c);
  console.log(`picsum pool: ${pool.length} (candidates ${candidates.length})`);

  // Existing assignments must not be re-downloaded / duplicated in extend mode.
  const existingIds = new Set();
  const authorUse = new Map();
  for (const entry of Object.values(prevMap)) {
    const m = /^picsum:(\d+)$/.exec(entry.source ?? "");
    if (m) existingIds.add(m[1]);
    if (entry.author) authorUse.set(entry.author, (authorUse.get(entry.author) ?? 0) + 1);
  }

  const smallStats = new Map();
  if (!NO_DOWNLOAD) {
    const picks = [
      ...byOrient.portrait.slice(0, needPortrait + 24),
      ...byOrient.landscape.slice(0, needLandscape + 40),
    ];
    console.log(`probing ${picks.length} candidates (small)…`);
    await poolMap(
      picks,
      async (c) => {
        const file = join(SMALL, `${c.orientation}-${c.id}.jpg`);
        try {
          if (!existsSync(file)) {
            const buf = await fetchRetry(`https://picsum.photos/id/${c.id}/320/214.jpg`);
            writeFileSync(file, buf);
          }
          smallStats.set(c.id, photoStats(file));
        } catch (e) {
          smallStats.set(c.id, null);
        }
      },
      8,
    );
  }

  // 3. assignment: tone bias, author cap 3, deterministic.
  const usedIds = new Set(existingIds);
  const toneScore = (c) => {
    const s = smallStats.get(c.id);
    return s || { luminance: 0.5, saturation: 0.5 };
  };
  const scoreFor = (c, cat) => {
    const s = toneScore(c);
    if (DARK_CATS.has(cat)) return s.luminance; // lower better
    if (BRIGHT_CATS.has(cat)) return -s.luminance; // higher better
    if (SAT_CATS.has(cat)) return -s.saturation; // higher better
    return Math.abs(s.luminance - 0.5); // middle band
  };
  const ordered = shuffled(need);
  for (const tpl of ordered) {
    const want = PORTRAIT_CATS.has(tpl.category) ? "portrait" : "landscape";
    const poolList = byOrient[want].filter((c) => !usedIds.has(c.id) && (authorUse.get(c.author) ?? 0) < 3);
    if (!poolList.length) throw new Error(`no candidate left for ${tpl.id} (${want})`);
    // deterministic tiny jitter keeps variety while honoring the tone bias.
    let best = poolList[0];
    let bestScore = Infinity;
    for (const c of poolList) {
      const jitter = smallStats.has(c.id) ? 0 : 0.35; // unprobed candidates last
      const score = scoreFor(c, tpl.category) + jitter + rand() * 0.02;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    usedIds.add(best.id);
    authorUse.set(best.author, (authorUse.get(best.author) ?? 0) + 1);
    assignments.set(tpl.id, { kind: "picsum", picsum: best, stats: smallStats.get(best.id) ?? null });
  }

  // 4. materialize showcase/<id>.jpg (one per template, byte-unique).
  const credits = {};
  const map = {};
  const targets = templates.filter((t) => !ONLY || ONLY.has(t.id));
  let downloaded = 0;
  let reused = 0;
  for (const tpl of targets) {
    const a = assignments.get(tpl.id);
    const dest = join(SHOWCASE, `${tpl.id}.jpg`);
    if (a.kind === "existing") {
      const src = join(PHOTOS, a.file);
      writeFileSync(dest, readFileSync(src));
      reused++;
      const old = JSON.parse(readFileSync(join(PHOTOS, "CREDITS-DEMO.json"), "utf8"))[a.file] ?? {};
      credits[`showcase/${tpl.id}.jpg`] = { templateId: tpl.id, ...old, origin: a.file };
      map[tpl.id] = { file: `showcase/${tpl.id}.jpg`, source: `existing:${a.file}`, orientation: null };
    } else if (NO_DOWNLOAD) {
      continue;
    } else {
      const c = a.picsum;
      const w = c.orientation === "portrait" ? 1067 : 1600;
      const h = c.orientation === "portrait" ? 1600 : 1067;
      let buf;
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          buf = await fetchRetry(`https://picsum.photos/id/${c.id}/${w}/${h}.jpg`);
          if (buf.length > 20_000) ok = true;
        } catch (e) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      if (!ok) {
        console.log(`FAIL download ${tpl.id} picsum#${c.id}`);
        continue;
      }
      // atomic write so a crash never leaves a truncated showcase file.
      const tmp = `${dest}.tmp`;
      writeFileSync(tmp, buf);
      renameSync(tmp, dest);
      downloaded++;
      const stats = photoStats(dest);
      const hash = sha256(buf);
      credits[`showcase/${tpl.id}.jpg`] = {
        templateId: tpl.id,
        title: `Picsum #${c.id} (${stats.width}x${stats.height})`,
        author: `${c.author} via Lorem Picsum`,
        source: `https://picsum.photos/id/${c.id}/info`,
        license: "Unsplash License (free to use; attribution appreciated)",
        url: `https://picsum.photos/id/${c.id}/${w}/${h}.jpg`,
        bytes: buf.length,
        sha256: hash,
        luminance: Number(stats.luminance.toFixed(4)),
        saturation: Number(stats.saturation.toFixed(4)),
      };
      map[tpl.id] = {
        file: `showcase/${tpl.id}.jpg`,
        source: `picsum:${c.id}`,
        author: c.author,
        orientation: c.orientation,
        luminance: Number(stats.luminance.toFixed(4)),
        saturation: Number(stats.saturation.toFixed(4)),
        sha256: hash,
      };
    }
    if ((downloaded + reused) % 25 === 0) {
      console.log(`… ${downloaded + reused}/${targets.length}`);
    }
  }

  if (NO_DOWNLOAD) {
    console.log(`plan only: ${assignments.size} assignments (no files written)`);
    return;
  }

  // 5. write map + credits. On partial runs keep previously written entries.
  const mergedMap = { ...prevMap, ...map };
  const mergedCredits = { ...prevCredits, ...credits };
  writeFileSync(mapFile, JSON.stringify(mergedMap, null, 2) + "\n");
  writeFileSync(creditsFile, JSON.stringify(mergedCredits, null, 2) + "\n");
  console.log(`showcase: ${downloaded} downloaded, ${reused} reused; map entries ${Object.keys(mergedMap).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

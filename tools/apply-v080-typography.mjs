// v0.8.0 M2: enlarge template typography and badge defaults.
//  - Data/Label layers x1.2, Support x1.1, Display unchanged (DESIGN-LANGUAGE v2 roles)
//  - badge image layers raised to >= 4.5% photo height
//  - overflow/overlap guard via `framegeist boxes` (revert offending layers)
//  - idempotent marker: meta.version === "1.2.0" (use --force to replay)
//
// Usage: node tools/apply-v080-typography.mjs [--dry] [--force] [--only id,id]
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI = process.platform === "win32" ? "target/release/framegeist.exe" : "target/release/framegeist";
const DIR = "templates";
const MIN_SIZE = 0.0095;
const BADGE_MIN = 0.045;
const TEXT_FACTOR = { data: 1.2, label: 1.2, support: 1.1, display: 1.0 };
const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? new Set(process.argv[i + 1].split(",")) : null; })();

const showcase = JSON.parse(readFileSync("templates/assets/photos/showcase-map.json", "utf8"));
const photoFor = (id) => {
  const entry = showcase[id];
  if (!entry) return null;
  const p = join("templates/assets/photos", entry.file);
  return existsSync(p) ? p : null;
};

function hasCJK(s) { return /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(s); }
function layerText(layer) { return (layer.content ?? []).map((i) => `${i.expr ?? ""} ${i.fallback ?? ""}`).join(" "); }
function isData(layer) {
  return (layer.content ?? []).some((i) => /date\(/.test(i.expr ?? "") || /\bexif\.(focal|aperture|shutter|iso|datetime|gps|weekday)/.test(i.expr ?? ""));
}
function roleOf(layer) {
  if (layer.type !== "text") return null;
  if (isData(layer)) return "data";
  const size = layer.font?.size ?? 0.03;
  if (size >= 0.05) return "display";
  if (size < 0.022) return "label";
  return "support";
}
function isBadgeAsset(asset) {
  return /@builtin\/(brand|lockup|series|game)\/|@user\//.test(asset ?? "");
}
function walk(layers, fn) {
  for (const layer of layers ?? []) {
    fn(layer);
    if (layer.type === "group") walk(layer.children, fn);
  }
}

function runBoxes(tplPath, photo) {
  try {
    const out = execFileSync(CLI, ["boxes", photo, "--template", tplPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (e) {
    return { error: String(e.stderr || e.message).slice(0, 200) };
  }
}
/// Axis-aligned boxes of rotated text are misleading; skip those layers.
function findConflicts(boxes, canvas) {
  const texts = (boxes ?? []).filter((b) => b.type === "text" && !b.rotation);
  const conflicts = [];
  for (const b of texts) {
    if (b.x < -2 || b.y < -2 || b.x + b.w > canvas.w + 2 || b.y + b.h > canvas.h + 2) {
      conflicts.push({ id: b.id, reason: "outside" });
      continue;
    }
    for (const o of texts) {
      if (o === b || o.id === b.id) continue;
      const ix = Math.max(0, Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x));
      const iy = Math.max(0, Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y));
      const inter = ix * iy;
      const minority = Math.min(b.w * b.h, o.w * o.h) || 1;
      if (inter / minority > 0.4) {
        conflicts.push({ id: b.id, reason: `overlap:${o.id}` });
        break;
      }
    }
  }
  return conflicts;
}
const conflictKey = (c) => `${c.id}|${c.reason}`;

const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const report = { generatedAt: new Date().toISOString(), templates: [] };
let changedCount = 0;
let revertedCount = 0;
let conflictTemplates = 0;

for (const file of files) {
  const path = join(DIR, file);
  const tpl = JSON.parse(readFileSync(path, "utf8"));
  const id = tpl.meta?.id;
  if (!id || (ONLY && !ONLY.has(id))) continue;
  if (!FORCE && String(tpl.meta.version ?? "") === "1.2.0") continue;

  const originalSizes = new Map();
  const changes = [];
  let badges = 0;
  walk(tpl.layers, (layer) => {
    if (layer.type === "text") {
      const role = roleOf(layer);
      const factor = TEXT_FACTOR[role] ?? 1.0;
      const before = layer.font?.size ?? 0.03;
      originalSizes.set(layer.id, before);
      const after = Math.round(Math.max(MIN_SIZE, before * factor) * 10000) / 10000;
      if (after !== before) {
        layer.font.size = after;
        changes.push({ id: layer.id, role, from: before, to: after });
      }
    }
    if (layer.type === "image" && isBadgeAsset(layer.asset)) {
      const before = layer.size?.height;
      if (before === undefined || before < BADGE_MIN) {
        layer.size = layer.size ?? {};
        layer.size.height = BADGE_MIN;
        badges += 1;
        changes.push({ id: layer.id, role: "badge", from: before ?? null, to: BADGE_MIN });
      }
    }
  });

  let conflicts = [];
  let reverted = [];
  let baseline = [];
  const photo = photoFor(id);
  let pass = 0;
  if (photo && changes.some((c) => c.role !== "badge")) {
    // Baseline first: pre-existing overlaps / rotated layouts are not our
    // regression; only new conflicts introduced by scaling are reverted.
    // Always stage the candidate in target/ so --dry still exercises the guard.
    const tmpPath = join("target", "v080-candidate.json");
    const writeTpl = (obj) => writeFileSync(tmpPath, JSON.stringify(obj, null, 2) + "\n");
    const findLayer = (obj, lid) => {
      const stack = [...(obj.layers ?? [])];
      while (stack.length) {
        const l = stack.shift();
        if (l.id === lid) return l;
        if (l.type === "group") stack.push(...(l.children ?? []));
      }
      return null;
    };
    const boxesNow = () => {
      const res = runBoxes(tmpPath, photo);
      return res.error ? [] : findConflicts(res.boxes, res.canvas);
    };
    const textChanges = changes.filter((c) => c.role !== "badge");
    const original = structuredClone(tpl);
    for (const c of textChanges) {
      const l = findLayer(original, c.id);
      if (l?.font) l.font.size = c.from;
    }
    writeTpl(original);
    baseline = boxesNow();
    const baselineKeys = new Set(baseline.map(conflictKey));
    writeTpl(tpl);
    conflicts = boxesNow().filter((c) => !baselineKeys.has(conflictKey(c)));
    if (conflicts.length) {
      pass = 1;
      const bad = new Set(conflicts.map((c) => c.id));
      reverted = [...bad];
      for (const lid of bad) {
        const l = findLayer(tpl, lid);
        if (l?.font && originalSizes.has(lid)) l.font.size = originalSizes.get(lid);
      }
      revertedCount += bad.size;
      conflictTemplates += 1;
      writeTpl(tpl);
      const remainingKeys = new Set(boxesNow().filter((c) => !baselineKeys.has(conflictKey(c))).map(conflictKey));
      conflicts = conflicts.filter((c) => remainingKeys.has(conflictKey(c)));
    }
  }

  tpl.meta.version = "1.2.0";
  if (!DRY) writeFileSync(path, JSON.stringify(tpl, null, 2) + "\n");
  changedCount += 1;
  const revertedSet = new Set((reverted ?? []).map((x) => (typeof x === "string" ? x : x.id)));
  const finalChanges = changes.filter((c) => !revertedSet.has(c.id));
  if (finalChanges.length || conflicts.length) {
    report.templates.push({ id, changes: finalChanges, badges, conflicts, guardPasses: pass });
  }
}

if (!DRY) {
  mkdirSync("docs/reports/v0.8.0", { recursive: true });
  writeFileSync("docs/reports/v0.8.0/typography-report.json", JSON.stringify(report, null, 2) + "\n");
}
console.log(`${DRY ? "[dry] " : ""}templates processed: ${changedCount}, with changes: ${report.templates.length}`);
console.log(`badge layers raised: ${report.templates.reduce((n, t) => n + t.badges, 0)}`);
console.log(`conflict templates: ${conflictTemplates}, reverted layers: ${revertedCount}`);
console.log(`report -> docs/reports/v0.8.0/typography-report.json`);

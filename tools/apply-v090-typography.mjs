// v0.9.0 M1: raise badge image layers to the new default size.
//  - badge layers (brand/lockup/series/game/user): height x1.3 (cap 0.12),
//    floored at 0.06, layers already >= 0.10 stay; missing size -> 0.065
//  - overflow/overlap guard via `framegeist boxes`: step down 1.3 -> 1.15 ->
//    1.0 for offending badges, only for conflicts NOT present in the baseline
//  - idempotent marker: meta.version === "1.3.0" (use --force to replay)
//
// Usage: node tools/apply-v090-typography.mjs [--dry] [--force] [--only id,id]
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI = process.platform === "win32" ? "target/release/framegeist.exe" : "target/release/framegeist";
const DIR = "templates";
const BADGE_FLOOR = 0.06;
const BADGE_TARGET = 0.065;
const BADGE_CAP = 0.12;
const BADGE_KEEP = 0.1;
const FACTORS = [1.3, 1.15, 1.0];
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

function isBadgeAsset(asset) {
  return /@builtin\/(brand|lockup|series|game)\/|@user\//.test(asset ?? "");
}
function walk(layers, fn) {
  for (const layer of layers ?? []) {
    fn(layer);
    if (layer.type === "group") walk(layer.children, fn);
  }
}
function findLayer(obj, lid) {
  const stack = [...(obj.layers ?? [])];
  while (stack.length) {
    const l = stack.shift();
    if (l.id === lid) return l;
    if (l.type === "group") stack.push(...(l.children ?? []));
  }
  return null;
}

function runBoxes(tplPath, photo) {
  try {
    const out = execFileSync(CLI, ["boxes", photo, "--template", tplPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (e) {
    return { error: String(e.stderr || e.message).slice(0, 200) };
  }
}
/// Badge-specific guard: outside canvas, or heavy overlap with a text box.
function badgeConflicts(boxes, canvas, badgeIds) {
  const texts = (boxes ?? []).filter((b) => b.type === "text" && !b.rotation);
  const badges = (boxes ?? []).filter((b) => badgeIds.has(b.id));
  const conflicts = [];
  for (const b of badges) {
    if (b.x < -2 || b.y < -2 || b.x + b.w > canvas.w + 2 || b.y + b.h > canvas.h + 2) {
      conflicts.push({ id: b.id, reason: "outside" });
      continue;
    }
    for (const o of texts) {
      const ix = Math.max(0, Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x));
      const iy = Math.max(0, Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y));
      const inter = ix * iy;
      if (inter / Math.max(1, b.w * b.h) > 0.25) {
        conflicts.push({ id: b.id, reason: `text-overlap:${o.id}` });
        break;
      }
    }
  }
  return conflicts;
}
const conflictKey = (c) => `${c.id}|${c.reason}`;

const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const report = { generatedAt: new Date().toISOString(), templates: [] };
let processed = 0;
let badgesRaised = 0;
let reverted = 0;
let conflictTemplates = 0;

for (const file of files) {
  const path = join(DIR, file);
  const tpl = JSON.parse(readFileSync(path, "utf8"));
  const id = tpl.meta?.id;
  if (!id || (ONLY && !ONLY.has(id))) continue;
  if (!FORCE && String(tpl.meta.version ?? "") === "1.3.0") continue;

  const original = structuredClone(tpl);
  const badgeIds = new Set();
  const changes = [];
  walk(tpl.layers, (layer) => {
    if (layer.type !== "image" || !isBadgeAsset(layer.asset)) return;
    badgeIds.add(layer.id);
    const before = layer.size?.height;
    let after;
    if (before === undefined || before === null) after = BADGE_TARGET;
    else if (before >= BADGE_KEEP) after = before;
    else after = Math.min(BADGE_CAP, Math.max(BADGE_FLOOR, Math.round(before * FACTORS[0] * 10000) / 10000));
    if (after !== before) {
      layer.size = layer.size ?? {};
      layer.size.height = after;
      badgesRaised += 1;
      changes.push({ id: layer.id, from: before ?? null, to: after, factor: FACTORS[0] });
    }
  });

  let conflicts = [];
  const photo = photoFor(id);
  if (photo && changes.length) {
    const tmpPath = join("target", "v090-candidate.json");
    const writeTpl = (obj) => writeFileSync(tmpPath, JSON.stringify(obj, null, 2) + "\n");
    const boxesNow = (obj) => {
      writeTpl(obj);
      const res = runBoxes(tmpPath, photo);
      return res.error ? [] : badgeConflicts(res.boxes, res.canvas, badgeIds);
    };
    const baselineKeys = new Set(boxesNow(original).map(conflictKey));
    conflicts = boxesNow(tpl).filter((c) => !baselineKeys.has(conflictKey(c)));
    if (conflicts.length) {
      conflictTemplates += 1;
      const bad = new Set(conflicts.map((c) => c.id));
      const kept = [];
      for (const lid of bad) {
        const layer = findLayer(tpl, lid);
        if (!layer) continue;
        const origLayer = findLayer(original, lid);
        const base = origLayer?.size?.height;
        let resolved = false;
        for (const factor of FACTORS.slice(1)) {
          const next = base === undefined || base === null
            ? BADGE_TARGET
            : Math.min(BADGE_CAP, Math.max(BADGE_FLOOR, Math.round(base * factor * 10000) / 10000));
          layer.size = { ...(layer.size ?? {}), height: next };
          const remaining = boxesNow(tpl).filter((c) => !baselineKeys.has(conflictKey(c)));
          if (!remaining.some((c) => c.id === lid)) {
            const change = changes.find((c) => c.id === lid);
            if (change) { change.to = next; change.factor = factor; }
            resolved = true;
            break;
          }
        }
        if (!resolved) {
          if (base === undefined || base === null) layer.size.height = BADGE_TARGET;
          else layer.size.height = base;
          const change = changes.find((c) => c.id === lid);
          if (change) { change.to = base ?? null; change.reverted = true; change.factor = 1.0; }
          reverted += 1;
        }
      }
      writeTpl(tpl);
      const remainingKeys = new Set(boxesNow(tpl).filter((c) => !baselineKeys.has(conflictKey(c))).map(conflictKey));
      conflicts = conflicts.filter((c) => remainingKeys.has(conflictKey(c)));
      void kept;
    }
  }

  tpl.meta.version = "1.3.0";
  if (!DRY) writeFileSync(path, JSON.stringify(tpl, null, 2) + "\n");
  processed += 1;
  const finalChanges = changes.filter((c) => !c.reverted);
  if (finalChanges.length || conflicts.length) {
    report.templates.push({ id, changes: finalChanges, conflicts, badges: badgeIds.size });
  }
}

if (!DRY) {
  mkdirSync("docs/reports/v0.9.0", { recursive: true });
  writeFileSync("docs/reports/v0.9.0/typography-report.json", JSON.stringify(report, null, 2) + "\n");
}
console.log(`${DRY ? "[dry] " : ""}templates processed: ${processed}`);
console.log(`badge layers raised: ${badgesRaised}, reverted: ${reverted}, conflict templates: ${conflictTemplates}`);
console.log(`report -> docs/reports/v0.9.0/typography-report.json`);

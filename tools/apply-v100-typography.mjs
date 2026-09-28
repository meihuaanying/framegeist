#!/usr/bin/env node
// FrameGeist v1.0.0 Step 5: convert template text layers into a single
// auto-fitted `infoBlock` (design language v3).
//
// Rules (v3 draft §2/§3/§8):
//   - one side only: bottom | left | right (top/middle text moves to bottom)
//   - at most three lines, biggest layer first (display > support > detail)
//   - all migrated text layers are removed; badges/shapes/images stay
//   - canvas becomes extend with padding on the chosen side when needed
//   - meta.version = 1.4.0 (idempotency marker), minEngineVersion = 1.0.0
//
// Usage:
//   node tools/apply-v100-typography.mjs                 # dry run + report
//   node tools/apply-v100-typography.mjs --apply         # write templates
//   node tools/apply-v100-typography.mjs --only a,b      # limit the batch
//   node tools/apply-v100-typography.mjs --apply --force # ignore the marker
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const TPL_DIR = path.join(ROOT, "templates");
const CLI = path.join(ROOT, "target", "release", "framegeist.exe");
const PHOTO = path.join(ROOT, "templates", "assets", "test-photos", "sample-landscape.jpg");
const REPORT = path.join(ROOT, "docs", "reports", "v1.0.0", "typography-v100-report.json");
const TMP = path.join(ROOT, "target", "v100-preview");
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? new Set(process.argv[i + 1].split(",")) : null;
})();

const SIDE_OF = (anchor) =>
  anchor.startsWith("bottom") ? "bottom"
  : anchor.startsWith("top") ? "top"
  : anchor.endsWith("-left") ? "left"
  : anchor.endsWith("-right") ? "right"
  : "middle";
const ALIGN_OF = (anchor) =>
  anchor.endsWith("-left") ? "left" : anchor.endsWith("-right") ? "right" : "center";
const roleOf = (size) => (size >= 0.05 ? "display" : size < 0.022 ? "detail" : "support");
const isLight = (hex) => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex ?? "");
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
};

function migrate(tpl) {
  const layers = tpl.layers ?? [];
  const texts = layers.filter((l) => l.type === "text");
  if (!texts.length) return { skip: "no text layers" };

  const pool = texts.slice().sort((a, b) => (b.font?.size ?? 0) - (a.font?.size ?? 0));
  // v3: the focal (largest) text layer decides the side so side-rail designs
  // keep their rail; top/middle-only layouts move to the bottom band.
  let side = SIDE_OF(String(pool[0].anchor ?? "bottom-center"));
  if (side === "top" || side === "middle") side = "bottom";
  const chosen = pool.slice(0, 3);
  const lines = chosen.map((l) => {
    const exprs = (l.content ?? []).map((c) => c.expr).filter(Boolean);
    return {
      expr: exprs.join(" · ") || "''",
      fallback: l.content?.[0]?.fallback ?? null,
      role: roleOf(l.font?.size ?? 0.02),
    };
  });
  const head = chosen[0];
  const anchor = String(head.anchor ?? "bottom-left");
  // v1.0.0: one family per block — prefer the family of a line that carries
  // non-ASCII (CJK) literals, since Latin display faces lack those glyphs.
  const hasNonAscii = (l) =>
    (l.content ?? []).some((c) => /[^\x00-\x7F]/.test(`${c.expr ?? ""}${c.fallback ?? ""}`));
  const fontSource = chosen.find(hasNonAscii) ?? head;
  const families = [];
  for (const l of [fontSource, ...chosen]) {
    for (const f of l.font?.family ?? []) if (!families.includes(f)) families.push(f);
  }
  const infoBlock = {
    side,
    align: side === "bottom" ? ALIGN_OF(anchor) : side === "right" ? "right" : "left",
    color: head.font?.color ?? "auto",
    font: { family: families.slice(0, 8) },
    lines,
  };

  const canvas = { ...(tpl.canvas ?? {}) };
  const pad = { ...(canvas.padding ?? {}) };
  const canvasChange = canvas.mode !== "extend" || !(Number(pad[side]) > 0);
  if (canvasChange) {
    canvas.mode = "extend";
    pad[side] = side === "bottom" ? 0.26 : 0.28;
    canvas.padding = pad;
    if (!canvas.background || canvas.background.type === "none") {
      const light = isLight(head.font?.color === "auto" ? "#111111" : head.font?.color);
      canvas.background = { type: "solid", color: light ? "#FFFFFF" : "#101418" };
    }
  }

  const removed = new Set(texts.map((l) => l.id));
  let attachStripped = 0;
  const kept = [];
  for (const l of layers) {
    if (l.type === "text") continue;
    if (l.type === "image" && l.attachTo && removed.has(l.attachTo)) {
      const { attachTo, ...rest } = l;
      kept.push(rest);
      attachStripped++;
      continue;
    }
    kept.push(l);
  }
  const out = {
    ...tpl,
    canvas,
    layers: kept,
    infoBlock,
  };
  out.meta = { ...(tpl.meta ?? {}), version: "1.4.0", minEngineVersion: "1.0.0" };
  return {
    out,
    stats: {
      side,
      lines: lines.length,
      textLayers: texts.length,
      dropped: texts.length - chosen.length,
      canvasChange,
      attachStripped,
      roles: lines.map((l) => l.role).join("/"),
    },
  };
}

/// CLI geometry guard: the info-block box must sit inside its band with 1..3 children.
function guard(file) {
  const raw = execFileSync(CLI, ["--assets-dir", path.join(TPL_DIR, "assets"), "boxes", "--template", file, PHOTO], { encoding: "utf8" });
  const v = JSON.parse(raw);
  const boxes = Array.isArray(v) ? v : v.boxes ?? [];
  const ib = boxes.find((b) => b.id === "info-block");
  if (!ib) return "no info-block box";
  const kids = ib.children ?? [];
  if (!kids.length || kids.length > 3) return `children ${kids.length}`;
  const { w, h } = v.canvas ?? {};
  if (!(ib.w > 0 && ib.h > 0 && ib.x >= -1 && ib.y >= -1 && ib.x + ib.w <= w + 1 && ib.y + ib.h <= h + 1)) return "box out of canvas";
  for (const k of kids) {
    if (k.x < ib.x - 1 || k.y < ib.y - 1 || k.x + k.w > ib.x + ib.w + 1 || k.y + k.h > ib.y + ib.h + 1) return "child out of block";
  }
  return null;
}

const files = readdirSync(TPL_DIR).filter((f) => f.endsWith(".json"));
const report = { generatedAt: new Date().toISOString(), apply: APPLY, entries: [], skipped: [], failed: [] };
if (APPLY) mkdirSync(TMP, { recursive: true });

for (const f of files) {
  const id = f.replace(/\.json$/, "");
  if (ONLY && !ONLY.has(id)) continue;
  const file = path.join(TPL_DIR, f);
  const tpl = JSON.parse(readFileSync(file, "utf8"));
  if (!FORCE && tpl.meta?.version === "1.4.0") {
    report.skipped.push({ id, reason: "already 1.4.0" });
    continue;
  }
  const res = migrate(tpl);
  if (res.skip) {
    report.skipped.push({ id, reason: res.skip });
    continue;
  }
  const probe = path.join(TMP, `${id}.json`);
  if (APPLY) {
    writeFileSync(file, JSON.stringify(res.out, null, 2) + "\n", "utf8");
  } else {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(probe, JSON.stringify(res.out, null, 2) + "\n", "utf8");
  }
  let err = null;
  try {
    err = guard(APPLY ? file : probe);
  } catch (e) {
    err = String(e?.stderr ?? e?.message ?? e).trim().slice(0, 160);
  }
  if (err) {
    report.failed.push({ id, error: err, stats: res.stats });
    if (APPLY) writeFileSync(file, JSON.stringify(tpl, null, 2) + "\n", "utf8"); // roll back
    continue;
  }
  report.entries.push({ id, ...res.stats });
}

mkdirSync(path.dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n", "utf8");
const bySide = {};
for (const e of report.entries) bySide[e.side] = (bySide[e.side] ?? 0) + 1;
console.log(`${APPLY ? "APPLY" : "DRY"}: migrated ${report.entries.length}, skipped ${report.skipped.length}, failed ${report.failed.length}`);
console.log(`sides: ${JSON.stringify(bySide)}`);
if (report.failed.length) console.log("failed:", JSON.stringify(report.failed.slice(0, 10)));
console.log(`report: ${path.relative(ROOT, REPORT)}`);

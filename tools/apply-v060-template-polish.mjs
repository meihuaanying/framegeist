// v0.6.0 template polish (contract §M2):
//   1. date('YYYY.MM.DD', exif.datetime) -> date('LOCAL', exif.datetime)
//   2. fallbacks "Unknown Camera" / "UNKNOWN CAMERA" -> neutral "Camera" / "CAMERA"
//   3. enable OpenType tabular numbers (tnum) on EXIF/reference text layers
//   4. minEngineVersion -> 0.6.0 on every touched template
//
// Usage:
//   node tools/apply-v060-template-polish.mjs --dry
//   node tools/apply-v060-template-polish.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry");

const stats = { templates: 0, dates: 0, fallbacks: 0, features: 0 };
const changed = [];

function walkLayers(layers, fn) {
  for (const layer of layers ?? []) {
    if (layer.type === "group") {
      walkLayers(layer.children, fn);
      continue;
    }
    fn(layer);
  }
}

for (const file of readdirSync(join(ROOT, "templates")).filter((f) => f.endsWith(".json"))) {
  const path = join(ROOT, "templates", file);
  const raw = readFileSync(path, "utf8");
  const tpl = JSON.parse(raw);
  if (!tpl.meta?.id) continue;
  let touched = false;
  walkLayers(tpl.layers, (layer) => {
    if (layer.type !== "text") return;
    let hasExif = false;
    for (const item of layer.content ?? []) {
      if (typeof item.expr !== "string") continue;
      if (item.expr.includes("exif.")) hasExif = true;
      const next = item.expr.replaceAll("date('YYYY.MM.DD', exif.datetime)", "date('LOCAL', exif.datetime)");
      if (next !== item.expr) {
        stats.dates++;
        item.expr = next;
        touched = true;
      }
      if (item.fallback === "Unknown Camera") {
        item.fallback = "Camera";
        stats.fallbacks++;
        touched = true;
      } else if (item.fallback === "UNKNOWN CAMERA") {
        item.fallback = "CAMERA";
        stats.fallbacks++;
        touched = true;
      }
    }
    if (hasExif) {
      layer.features = Array.isArray(layer.features) ? layer.features : [];
      if (!layer.features.includes("tnum")) {
        layer.features.push("tnum");
        stats.features++;
        touched = true;
      }
    }
  });
  if (!touched) continue;
  tpl.meta.minEngineVersion = "0.6.0";
  stats.templates++;
  changed.push(file);
  if (!DRY) writeFileSync(path, JSON.stringify(tpl, null, 2) + "\n");
}

console.log(
  `${DRY ? "[dry] " : ""}templates=${stats.templates} dates=${stats.dates} fallbacks=${stats.fallbacks} features=${stats.features}`,
);
console.log(changed.slice(0, 6).join(", ") + (changed.length > 6 ? ` … (${changed.length})` : ""));

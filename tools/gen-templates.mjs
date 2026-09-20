// Rebuilds the Web manifest + JSON mirror from the template library (PRD G1).
// v0.4.0: templates are authored files, no generation happens here anymore.
// Usage: node tools/gen-templates.mjs   (writes web/templates.json + web/templates/)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "templates";
const WEB = "web";

if (!existsSync(OUT)) {
  console.error(`missing ${OUT}/ directory; run from repo root`);
  process.exit(1);
}

/** v0.8.0: badge marks shown on the wall card (max 3, static slugs first;
 *  expression templates fall back to the neutral EXIF marker). */
function templateMarks(tpl) {
  const marks = [];
  const seen = new Set();
  const add = (slug, kind) => {
    const key = `${kind}/${slug}`;
    if (seen.has(key) || marks.length >= 3) return;
    seen.add(key);
    marks.push({ slug, kind });
  };
  const walk = (layers) => {
    for (const l of layers ?? []) {
      if (l.type === "image") {
        const m = /@builtin\/(brand|lockup|series|game)\/([a-z0-9-]+)/.exec(l.asset ?? "");
        if (m) add(m[2], m[1]);
      }
      if (l.type === "group") walk(l.children);
    }
  };
  walk(tpl.layers);
  const flat = JSON.stringify(tpl.layers ?? []);
  const usesExpression = flat.includes("{exif.brand_slug}") || flat.includes("{exif.lens_slug}") ||
    flat.includes("{exif.lens_series}");
  if (!marks.length && usesExpression) marks.push({ slug: "exif-auto", kind: "brand" });
  return marks;
}

const manifest = [];
const files = [];
for (const f of readdirSync(OUT)) {
  if (!f.endsWith(".json")) continue;
  const raw = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  if (!raw.meta?.id) continue;
  files.push(f);
  manifest.push({
    id: raw.meta.id,
    name: raw.meta.name,
    names: raw.meta.nameI18n ?? null,
    notice: raw.meta.notice ?? null,
    category: raw.meta.category,
    marks: templateMarks(raw),
  });
}
const CATEGORY_ORDER = [
  "white-border", "camera", "phone", "drone", "fuji", "film", "colorwalk", "colorful",
  "classic-watermark", "portfolio", "black-frame", "sports", "calendar", "magazine",
  "minimal", "borderless", "master", "personal", "polaroid", "festival", "effect",
  "colorcard", "blur-bg", "ticket", "game",
];
const catIndex = (c) => {
  const i = CATEGORY_ORDER.indexOf(c);
  return i < 0 ? CATEGORY_ORDER.length : i;
};
manifest.sort((a, b) => catIndex(a.category) - catIndex(b.category) || a.name.localeCompare(b.name));

mkdirSync(WEB, { recursive: true });
writeFileSync(join(WEB, "templates.json"), JSON.stringify(manifest, null, 2) + "\n");

// Mirror templates into web/ so the page and the Tauri desktop shell can
// resolve everything page-relative (self-contained dist). Stale mirrors are
// removed so deleted templates do not linger.
const webTemplates = join(WEB, "templates");
mkdirSync(webTemplates, { recursive: true });
const wanted = new Set(files);
for (const f of readdirSync(webTemplates)) {
  if (f.endsWith(".json") && !wanted.has(f)) rmSync(join(webTemplates, f));
}
for (const f of files) {
  writeFileSync(join(webTemplates, f), readFileSync(join(OUT, f)));
}

console.log(`manifest: ${manifest.length} templates -> web/templates.json + web/templates/ mirror`);
const byCat = {};
for (const t of manifest) byCat[t.category] = (byCat[t.category] ?? 0) + 1;
console.log(byCat);

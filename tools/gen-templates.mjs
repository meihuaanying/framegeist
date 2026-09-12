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
  });
}
manifest.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

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

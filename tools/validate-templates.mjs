// Template validation + real-render helper for template authors (v0.4.0).
//
// Fully validates each template through the engine (schema, sandbox,
// expressions) AND renders a real preview with a demo photo so the design
// can be inspected visually. Never edits templates.
//
// Usage:
//   node tools/validate-templates.mjs templates/foo.json [templates/bar.json ...]
//   node tools/validate-templates.mjs --all
//   node tools/validate-templates.mjs --dir templates [--photo <path>]
//
// Options:
//   --all            scan templates/*.json (top level)
//   --dir <dir>      scan a directory instead of explicit files
//   --photo <path>   photo used for the render (default: test-photos/sample-landscape.jpg)
//   --out <dir>      output directory (default: <temp>/framegeist-render)
//   --no-render      validate only
//
// Output: one line per template. PNG previews are written for each OK template.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const cli = process.platform === "win32" ? "target/release/framegeist.exe" : "target/release/framegeist";
const root = resolve(process.cwd());
const defaultPhoto = "templates/assets/test-photos/sample-landscape.jpg";

let files = [];
let dir = null;
let photo = defaultPhoto;
let doRender = true;
let outDir = join(process.env.TEMP || process.env.TMPDIR || "/tmp", "framegeist-render");

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--all") {
    dir = "templates";
  } else if (a === "--dir") {
    dir = args[++i];
  } else if (a === "--photo") {
    photo = args[++i];
  } else if (a === "--out") {
    outDir = args[++i];
  } else if (a === "--no-render") {
    doRender = false;
  } else {
    files.push(a);
  }
}

if (dir) {
  files = readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(dir, f));
}
if (files.length === 0) {
  console.error("no template files given (use files, --all or --dir <dir>)");
  process.exit(2);
}
if (!existsSync(join(root, cli))) {
  console.error(`engine binary missing: ${cli} (run: cargo build --release -p framegeist-cli)`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

let ok = 0;
let failed = 0;
for (const file of files) {
  const abs = join(root, file);
  let id = file;
  try {
    const meta = JSON.parse(readFileSync(abs, "utf8"));
    id = meta?.meta?.id ?? file;
  } catch (e) {
    console.log(`FAIL ${file}: invalid JSON (${e.message})`);
    failed++;
    continue;
  }
  if (!doRender) {
    console.log(`SKIP-RENDER ${id} (${file})`);
    ok++;
    continue;
  }
  const out = join(outDir, `${id}.png`);
  rmSync(out, { force: true });
  try {
    execFileSync(
      join(root, cli),
      ["render", photo, "--template", file, "--preview", "-o", out],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log(`OK ${id} -> ${out}`);
    ok++;
  } catch (e) {
    const stderr = (e.stderr || Buffer.from("")).toString().trim();
    console.log(`FAIL ${id} (${file}): ${stderr || e.message}`);
    failed++;
  }
}
console.log(`${ok} ok, ${failed} failed, ${files.length} total`);
process.exit(failed > 0 ? 1 : 0);

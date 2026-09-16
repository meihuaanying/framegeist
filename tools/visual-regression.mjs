// v0.6.0 visual regression gate (contract §M3/Q13): perceptual dHash + mean
// RGB comparison of every rendered sample against a committed baseline.
// dHash catches layout/typography drift; mean RGB catches tone/coverage drift.
//
// Usage:
//   node tools/visual-regression.mjs            # check against baseline
//   node tools/visual-regression.mjs --update   # rewrite the baseline (record why!)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const UPDATE = process.argv.includes("--update") || process.env.FG_UPDATE_VISUAL_BASELINES === "1";
const BASELINE = join(ROOT, "tools/visual-baselines.json");
const DIRS = ["templates/samples", "web/previews"];
const HAMMING_MAX = 10;
const MEAN_MAX = 2.5;

function cliPath() {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const p of ["target/release/framegeist", "target/debug/framegeist"]) {
    const full = join(ROOT, p + exe);
    if (existsSync(full)) return full;
  }
  throw new Error("framegeist CLI missing: run cargo build --release -p framegeist-cli");
}
const CLI = cliPath();

function fingerprint(rel) {
  const out = execFileSync(CLI, ["visual-hash", rel], { cwd: ROOT }).toString();
  const { dhash, mean } = JSON.parse(out);
  return { dhash, mean };
}

const files = [];
for (const dir of DIRS) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const f of readdirSync(full).filter((x) => x.endsWith(".jpg")).sort()) {
    files.push(`${dir}/${f}`);
  }
}
if (!files.length) throw new Error("no sample images found; run node tools/gen-samples.mjs");

if (UPDATE) {
  const items = {};
  for (const rel of files) items[rel] = fingerprint(rel);
  writeFileSync(BASELINE, JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2) + "\n");
  console.log(`visual baseline updated: ${files.length} images -> tools/visual-baselines.json`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.log("visual baseline missing; run with --update first");
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).items ?? {};

const hamming = (a, b) => {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};
const meanDist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

const failures = [];
let checked = 0;
for (const rel of files) {
  const want = baseline[rel];
  if (!want) {
    failures.push(`${rel}: no baseline entry`);
    continue;
  }
  const got = fingerprint(rel);
  const h = hamming(want.dhash, got.dhash);
  const m = meanDist(want.mean, got.mean);
  checked++;
  if (h > HAMMING_MAX || m > MEAN_MAX) {
    failures.push(`${rel}: hamming=${h} meanΔ=${m.toFixed(2)}`);
  }
}
console.log(`visual regression: ${checked}/${files.length} checked (hamming ≤ ${HAMMING_MAX}, meanΔ ≤ ${MEAN_MAX})`);
if (failures.length) {
  console.log(`FAIL ${failures.length}:`);
  for (const f of failures.slice(0, 15)) console.log(`  ${f}`);
  process.exit(1);
}
console.log("visual regression: all samples within tolerance");

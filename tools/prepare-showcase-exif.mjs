// v0.6.0 showcase EXIF pipeline: injects the real EXIF block of the three
// user-provided sample photos (docs/reports/v0.6.0/source-exif.json) into every
// showcase JPEG without re-encoding pixels, then refreshes the sha256 entries in
// showcase-map.json / CREDITS-DEMO.json.
//
// Mapping (deterministic, per contract §M0):
//   portrait  showcase photo -> sony-a7r3
//   landscape showcase photo -> nikon-z6ii / canon-r7 alternating by template id
//
// Usage: node tools/prepare-showcase-exif.mjs [--check]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const CHECK = process.argv.includes("--check");
const PHOTOS = join(ROOT, "templates/assets/photos");
const SHOWCASE = join(PHOTOS, "showcase");
const SOURCES = {
  "sony-a7r3": join(ROOT, "web/examples/sony-a7r3.jpg"),
  "nikon-z6ii": join(ROOT, "web/examples/nikon-z6ii.jpg"),
  "canon-r7": join(ROOT, "web/examples/canon-r7.jpg"),
};

function cliPath() {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const p of ["target/release/framegeist", "target/debug/framegeist"]) {
    const full = join(ROOT, p + exe);
    if (existsSync(full)) return full;
  }
  throw new Error("framegeist CLI missing: run cargo build --release -p framegeist-cli");
}
const CLI = cliPath();

for (const [id, file] of Object.entries(SOURCES)) {
  if (!existsSync(file)) throw new Error(`missing sample source ${id}: ${file} (run photo-shrink first)`);
}

const mapPath = join(PHOTOS, "showcase-map.json");
const creditsPath = join(PHOTOS, "CREDITS-DEMO.json");
const map = JSON.parse(readFileSync(mapPath, "utf8"));
const credits = JSON.parse(readFileSync(creditsPath, "utf8"));
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const ids = Object.keys(map).sort();
let landIdx = 0;
const tmp = mkdtempSync(join(tmpdir(), "fg-exif-check-"));
let injected = 0;
try {
  for (const id of ids) {
    const file = join(SHOWCASE, `${id}.jpg`);
    if (!existsSync(file)) throw new Error(`missing showcase photo ${file}`);
    const dims = JSON.parse(execFileSync(CLI, ["photo-stats", file], { cwd: ROOT }).toString());
    const orientation = dims.height > dims.width ? "portrait" : "landscape";
    const sourceId = orientation === "portrait" ? "sony-a7r3" : landIdx++ % 2 === 0 ? "nikon-z6ii" : "canon-r7";
    // Write the new container next to the target so the rename stays on one
    // volume (tmpdir may live on a different drive).
    const out = CHECK ? join(tmp, `${id}.jpg`) : `${file}.newexif`;
    execFileSync(CLI, ["exif-inject", file, "--from", SOURCES[sourceId], "-o", out], { cwd: ROOT, stdio: "pipe" });
    if (CHECK) {
      const probe = JSON.parse(execFileSync(CLI, ["probe", out], { cwd: ROOT }).toString());
      const expect = { "sony-a7r3": "ILCE-7RM3", "nikon-z6ii": "NIKON Z 6_2", "canon-r7": "Canon EOS R7" }[sourceId];
      if (probe.model !== expect) throw new Error(`${id}: probe model ${probe.model} != ${expect}`);
      rmSync(out, { force: true });
      continue;
    }
    renameSync(out, file);
    const buf = readFileSync(file);
    map[id].sha256 = sha(buf);
    map[id].exif_source = sourceId;
    if (credits[id]) {
      credits[id].sha256 = sha(buf);
      credits[id].exif_source = sourceId;
    }
    injected++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
  for (const id of ids) rmSync(join(SHOWCASE, `${id}.jpg.newexif`), { force: true });
}

if (CHECK) {
  console.log(`showcase exif check: ${ids.length}/${ids.length} photos carry the expected EXIF source`);
} else {
  writeFileSync(mapPath, JSON.stringify(map, null, 2) + "\n");
  writeFileSync(creditsPath, JSON.stringify(credits, null, 2) + "\n");
  console.log(`showcase exif injected: ${injected}/${ids.length} photos; map + credits sha256 refreshed`);
}

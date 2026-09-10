// Generates update.json (PRD L1) from a Release's assets.
// Usage: node tools/gen-update.mjs <version> <channel> <assetsDir> <outFile>
// Reads every file in assetsDir, computes sha256 + size, maps known file
// patterns to platform keys. Unknown files are ignored.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [version, channel, assetsDir, outFile] = process.argv.slice(2);
if (!version || !channel || !assetsDir || !outFile) {
  console.error("usage: node gen-update.mjs <version> <channel> <assetsDir> <outFile>");
  process.exit(1);
}

const PLATFORM_PATTERNS = [
  [/framegeist-cli-.*-win-x64\.zip$/, "win-x64-cli"],
  [/FrameGeist-.*-win-x64-setup\.exe$/, "win-x64-installer"],
  [/framegeist-desktop-.*-win-x64\.zip$/, "win-x64"],
  [/.*-win-x64\.zip$/, "win-x64"],
  [/.*\.apk$/, "android-arm64"],
  [/.*\.hap$/, "harmony-arm64"],
];

const REPO = "meihuaanying/framegeist";
const platforms = {};
const all = {};
for (const f of readdirSync(assetsDir)) {
  const bytes = readFileSync(join(assetsDir, f));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entry = { file: f, sha256, size: bytes.length };
  all[f] = entry;
  for (const [re, key] of PLATFORM_PATTERNS) {
    if (re.test(f) && !platforms[key]) {
      platforms[key] = {
        url: `https://github.com/${REPO}/releases/download/${version}/${encodeURIComponent(f)}`,
        sha256,
        size: bytes.length,
      };
      break;
    }
  }
}

let templates = null;
const fgpkg = Object.keys(all).find((f) => f.endsWith(".fgpkg"));
if (fgpkg) {
  templates = {
    version,
    url: `https://github.com/${REPO}/releases/download/${version}/${encodeURIComponent(fgpkg)}`,
    sha256: all[fgpkg].sha256,
    count: JSON.parse(readFileSync(join("web", "templates.json"), "utf8")).length,
  };
}

const update = {
  schemaVersion: 1,
  channel,
  generatedAt: new Date().toISOString(),
  latest: {
    version,
    releasedAt: new Date().toISOString(),
    notesUrl: `https://github.com/${REPO}/releases/tag/${version}`,
    platforms,
  },
  templates,
};

writeFileSync(outFile, JSON.stringify(update, null, 2) + "\n");
const checksums = Object.entries(all)
  .map(([f, e]) => `${e.sha256}  ${f}`)
  .join("\n");
writeFileSync(join(assetsDir, "SHA256SUMS.txt"), checksums + "\n");
console.log(`update.json written: ${Object.keys(platforms).join(", ") || "no platforms"}; templates=${!!templates}`);

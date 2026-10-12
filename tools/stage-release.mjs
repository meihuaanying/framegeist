#!/usr/bin/env node
// Stage the six release assets exactly as `.github/workflows/release.yml` does.
//
// Exists because the release workflow cannot run when the remote has no
// `.github/workflows` tree (the token lacks `workflow` scope, and any ref update
// whose tree contains `.github/` is rejected with a bare 404). Until that scope
// is restored, a release is staged and published from the workstation.
//
// Usage: node tools/stage-release.mjs v1.5.0 [--dist=dist]
//
// The template pack's `update.json` count is asserted against the repository, so
// a pack that does not match the tree it claims to ship fails here rather than in
// a user's updater.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const ver = process.argv[2];
const dist = (process.argv.find((a) => a.startsWith("--dist=")) ?? "--dist=dist").slice(7);
if (!ver || !/^v\d+\.\d+\.\d+$/.test(ver)) {
  console.error("usage: node tools/stage-release.mjs <vX.Y.Z> [--dist=dist]");
  process.exit(2);
}

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const need = [
  "target/release/framegeist.exe",
  "target/release/framegeist-desktop.exe",
];
for (const p of need) {
  if (!existsSync(p)) {
    console.error(`missing ${p}; build the release binaries first:`);
    console.error("  cargo build --release -p framegeist-cli -p framegeist-desktop");
    process.exit(2);
  }
}
const nsisDir = "target/release/bundle/nsis";
const nsisAll = existsSync(nsisDir)
  ? readdirSync(nsisDir).filter((f) => f.endsWith(".exe"))
  : [];
// The bundle directory accumulates one installer per build, so picking the first
// entry silently ships a stale one. Require an unambiguous match for the version
// being released.
const matching = nsisAll.filter((f) => f.includes(ver.slice(1)));
if (!nsisAll.length) {
  console.error("missing the NSIS installer; build it first:");
  console.error("  cd crates/framegeist-desktop && cargo tauri build --bundles nsis");
  process.exit(2);
}
if (matching.length !== 1) {
  console.error(
    `expected exactly one installer for ${ver} in ${nsisDir}, found ${matching.length}` +
      ` (all: ${nsisAll.join(", ")})`,
  );
  console.error("`cargo tauri build` takes the version from crates/framegeist-desktop/tauri.conf.json;");
  console.error("bump it and rebuild, or remove the stale bundles.");
  process.exit(2);
}
const setup = join(nsisDir, matching[0]);
console.log(`installer: ${matching[0]}`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// PowerShell's Compress-Archive is used because Node has no archive API; Windows
// PowerShell 5.1 refuses any destination extension other than .zip, so the
// template pack is built as a zip and renamed (the workflow runs under pwsh 7 and
// names it directly).
const ps = (args) => run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", args]);
ps(
  `Compress-Archive -Path 'target/release/framegeist.exe','templates/*.json','templates/assets' ` +
    `-DestinationPath '${dist}/framegeist-cli-${ver}-win-x64.zip' -Force`,
);
ps(
  `Compress-Archive -Path 'target/release/framegeist-desktop.exe' ` +
    `-DestinationPath '${dist}/framegeist-desktop-${ver}-win-x64.zip' -Force`,
);
ps(
  `Compress-Archive -Path 'templates/*.json','templates/assets/fonts' ` +
    `-DestinationPath '${dist}/framegeist-templates-${ver}.zip' -Force`,
);
renameSync(join(dist, `framegeist-templates-${ver}.zip`), join(dist, `framegeist-templates-${ver}.fgpkg`));
ps(`Copy-Item '${setup}' '${dist}/FrameGeist-${ver}-win-x64-setup.exe' -Force`);

// The pack must carry every template in the repository.
const want = readdirSync("templates").filter((f) => f.endsWith(".json"));
const list = run("powershell", [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
    `$z=[System.IO.Compression.ZipFile]::OpenRead((Resolve-Path '${dist}/framegeist-templates-${ver}.fgpkg')); ` +
    `$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose()`,
])
  .split(/\r?\n/)
  .map((s) => s.trim())
  // templates/assets/fonts also contributes fonts.json and sources.json at the root
  .filter((f) => f.endsWith(".json") && !f.includes("/"));
const missing = want.filter((w) => !list.includes(w));
if (missing.length) {
  console.error(`template pack is missing ${missing.length} template(s): ${missing.slice(0, 5).join(", ")}`);
  process.exit(3);
}
console.log(`template pack: ${want.length}/${want.length} templates present`);

run("node", ["tools/gen-update.mjs", ver, "stable", dist, join(dist, "update.json")]);
const update = JSON.parse(readFileSync(join(dist, "update.json"), "utf8"));
if (update.templates.count !== want.length) {
  console.error(`update.json says ${update.templates.count} templates, repository has ${want.length}`);
  process.exit(4);
}

console.log("");
for (const f of readdirSync(dist).sort()) {
  console.log(`  ${f.padEnd(42)} ${String(statSync(join(dist, f)).size).padStart(12)} B`);
}
console.log(`\nupdate.json templates.count = ${update.templates.count}`);
console.log(`\nnext:\n  gh release create ${ver} ${dist}/* --title "FrameGeist ${ver}" \\`);
console.log(`    --notes-file docs/releases/${ver}.md`);

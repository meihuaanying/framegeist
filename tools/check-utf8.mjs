// Pre-release guard (v0.6.1 postmortem): every tracked text file must be valid
// UTF-8. Windows PowerShell 5.1 Get-Content/Set-Content round-trips silently
// re-encode non-ASCII files as ANSI and can eat adjacent ASCII quotes — this
// scan catches that class of corruption before it reaches a release.
// Usage: node tools/check-utf8.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files"])
  .toString()
  .split("\n")
  .filter((f) => /\.(js|mjs|cjs|json|html|css|md|rs|toml|yml|yaml|ps1|txt|svg|webmanifest)$/.test(f));
const broken = [];
for (const f of files) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(f));
  } catch {
    broken.push(f);
  }
}
console.log(`utf8 scan: ${files.length} text files, ${broken.length} broken`);
for (const f of broken.slice(0, 20)) console.log(`  BROKEN ${f}`);
process.exit(broken.length ? 1 : 0);

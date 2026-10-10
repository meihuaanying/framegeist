// Run every release gate in one command.
//
// v1.5.0: `.github/workflows/ci.yml` runs only the Rust gates. The ten JS gates,
// the 408-baseline visual regression, E2E and perf were remembered rather than
// enforced, and the list had already drifted from reality twice (a brand-colours
// count, a template count). This script is the list, executable.
//
// The workflow cannot be extended from here (the release token has no workflow
// scope, so a workflow edit would 404 on push -- see AGENTS.md), so the checklist
// lives in the repository instead.
//
//   node tools/check-all-gates.mjs              # everything that needs no browser
//   node tools/check-all-gates.mjs --with-browser  # also E2E + perf (needs CDP)
//
// Every gate is optional-free: the script exits non-zero on the first failure so
// it can be dropped into a pre-commit hook or a release checklist.
import { spawnSync } from "node:child_process";

const withBrowser = process.argv.includes("--with-browser");
const only = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1].split(",") : null;
})();

// [label, command, args] -- order matters: cheap encoding/lint gates first so a
// broken file surfaces before the multi-minute renders.
const GATES = [
  ["utf8", "node", ["tools/check-utf8.mjs"]],
  ["i18n", "node", ["tools/check-i18n.mjs"]],
  ["templates", "node", ["tools/validate-templates.mjs", "--all"]],
  ["brand-colors", "node", ["tools/check-brand-colors.mjs"]],
  ["glyph-coverage", "node", ["tools/check-glyph-coverage.mjs"]],
  ["ui-contrast", "node", ["tools/check-ui-contrast.mjs"]],
  ["photo-uniqueness", "node", ["tools/check-photo-uniqueness.mjs"]],
  ["fmt", "cargo", ["fmt", "--all", "--check"]],
  ["clippy", "cargo", ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]],
  ["test", "cargo", ["test", "--release", "--workspace"]],
  // Never pass --update here: a baseline rewrite must be a deliberate, recorded act.
  ["visual-regression", "node", ["tools/visual-regression.mjs"]],
];

if (withBrowser) {
  GATES.push(
    ["e2e", "node", ["tools/e2e-audit.mjs", "target/e2e-shots"]],
    ["perf", "node", ["tools/perf-audit.mjs"]],
  );
}

const selected = only ? GATES.filter(([label]) => only.includes(label)) : GATES;
if (only && selected.length !== only.length) {
  const known = GATES.map(([l]) => l).join(", ");
  console.error(`unknown gate; known gates: ${known}`);
  process.exit(2);
}

const results = [];
for (const [label, cmd, args] of selected) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const started = Date.now();
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  // spawnSync reports status null when the process was killed by a signal.
  const ok = r.status === 0;
  results.push({ label, ok, secs, status: r.status, signal: r.signal });
  if (!ok) {
    console.error(`\nGATE FAILED: ${label} (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ""})`);
    console.error("summary: " + results.map((x) => `${x.label}=${x.ok ? "ok" : "FAIL"}`).join(" "));
    process.exit(1);
  }
}

console.log("\n=== all gates green ===");
for (const r of results) console.log(`  ${r.label.padEnd(20)} ${r.secs}s`);
if (withBrowser) {
  console.log("\nNote: E2E and perf need `FG_CDP_PORT` and a browser exposing CDP");
  console.log("(node tools/serve.mjs 8350 + msedge --headless=new --remote-debugging-port=9237 http://localhost:8350/web/).");
}
// Smoke test: WASM engine renders identically to the CLI (PRD N2 mini-gate).
// Usage: node tools/wasm-smoke.mjs
import { readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (b) => createHash("sha256").update(b).digest("hex");

const cliName = process.platform === "win32" ? "framegeist.exe" : "framegeist";
const engineCli = join(ROOT, "target/release", cliName);
const photo = await readFile(join(ROOT, "templates/assets/test-photos/sample-landscape.jpg"));
const wasmBytes = await readFile(join(ROOT, "web/pkg/framegeist_wasm_bg.wasm"));
const font = await readFile(join(ROOT, "templates/assets/fonts/JetBrainsMono-Regular.ttf"));

const glueUrl = new URL("../web/pkg/framegeist_wasm.js", import.meta.url).href;
const init = (await import(glueUrl)).default;
const { Engine } = await import(glueUrl);
await init(wasmBytes);

const engine = new Engine(["JetBrains Mono"], [font]);

const templateIds = ["classic-white-bottom-param", "polaroid-caption", "minimal-corner-iso"];
let failures = 0;
for (const id of templateIds) {
  const tpl = await readFile(join(ROOT, `templates/${id}.json`), "utf8");
  const out = engine.render(photo, tpl, "jpeg", false);
  const outBytes = Buffer.from(out);
  const outPath = join(process.env.TEMP ?? "/tmp", `fg-smoke-${id}.jpg`);
  await rm(outPath, { force: true });
  execFileSync(engineCli, [
    "render",
    join(ROOT, "templates/assets/test-photos/sample-landscape.jpg"),
    "--template", id,
    "-o", outPath,
  ], { cwd: ROOT });
  const cliBytes = await readFile(outPath);
  const a = sha(outBytes);
  const b = sha(cliBytes);
  const ok = a === b;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${id}`);
  console.log(`  wasm ${outBytes.length}B ${a.slice(0, 16)}…`);
  console.log(`  cli  ${cliBytes.length}B ${b.slice(0, 16)}…`);
}
if (failures > 0) {
  console.error(`${failures} mismatch(es): WASM render diverges from CLI`);
  process.exit(1);
}
console.log("wasm smoke: WASM renders byte-identical to CLI");

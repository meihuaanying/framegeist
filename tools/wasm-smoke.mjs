// Smoke test: WASM engine renders identically to the CLI (PRD N2 mini-gate).
// Usage: node tools/wasm-smoke.mjs
import { readFile, rm, writeFile, stat } from "node:fs/promises";
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

const fixtureDir = join(ROOT, "crates/framegeist-cli/tests/fixtures");
const templateIds = ["classic-white-bottom-param", "polaroid-caption", "minimal-corner-iso"];
let failures = 0;
for (const id of templateIds) {
  const fixturePath = join(fixtureDir, `${id}.json`);
  const tpl = await readFile(fixturePath, "utf8");
  const out = engine.render(photo, tpl, "jpeg", false);
  const outBytes = Buffer.from(out);
  const outPath = join(process.env.TEMP ?? "/tmp", `fg-smoke-${id}.jpg`);
  await rm(outPath, { force: true });
  execFileSync(engineCli, [
    "render",
    join(ROOT, "templates/assets/test-photos/sample-landscape.jpg"),
    "--template", fixturePath,
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

// collage pixel-identity (PRD C5/N2): cross-end renders may differ in a
// handful of resize rounding pixels, so the gate is DECODED PIXEL identity.
{
  const layoutJson = await readFile(join(ROOT, "templates/layouts/grid-2x2-info.json"), "utf8");
  const photoFiles = [
    join(ROOT, "templates/assets/test-photos/sample-landscape.jpg"),
    join(ROOT, "templates/assets/test-photos/sample-portrait.jpg"),
    join(ROOT, "templates/assets/test-photos/sample-square.jpg"),
    join(ROOT, "templates/assets/test-photos/sample-noexif.png"),
  ];
  const photos = await Promise.all(photoFiles.map((p) => readFile(p)));
  const jsPhotos = photos.map((p) => new Uint8Array(p));
  const outBytes = Buffer.from(engine.render_collage(jsPhotos, layoutJson, "jpeg", false));
  const outPath = join(process.env.TEMP ?? "/tmp", "fg-smoke-collage.jpg");
  await rm(outPath, { force: true });
  await writeFile(outPath, outBytes);
  const cliPath = join(process.env.TEMP ?? "/tmp", "fg-smoke-collage-cli.jpg");
  await rm(cliPath, { force: true });
  execFileSync(engineCli, [
    "collage",
    ...photoFiles,
    "--layout", "grid-2x2-info",
    "-o", cliPath,
  ], { cwd: ROOT });
  const pix = (f) =>
    execFileSync(engineCli, ["pixel-hash", f], { cwd: ROOT }).toString().trim();
  const diffOut = execFileSync(engineCli, ["pixel-diff", outPath, cliPath], { cwd: ROOT }).toString().trim();
  const ratio = Number(diffOut.match(/ratio=([0-9.]+)/)?.[1] ?? 1);
  const ok = ratio <= 0.001;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} collage grid-2x2-info (pixel ratio ${ratio} <= 0.001, PRD N2)`);
  console.log(`  wasm ${outBytes.length}B`);
  console.log(`  cli  ${(await stat(cliPath)).size}B`);
}
if (failures > 0) {
  console.error(`${failures} mismatch(es): WASM render diverges from CLI`);
  process.exit(1);
}
console.log("wasm smoke: frames byte-identical, collage within PRD N2 pixel gate");

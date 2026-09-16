// v0.6.0 reproducible WASM pipeline: cargo build (+simd128 via .cargo/config)
// -> wasm-bindgen -> wasm-opt (-O2) -> wasm-smoke cross-end gate.
// Usage: node tools/wasm-build.mjs [--no-opt]
import { execFileSync } from "node:child_process";
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const NO_OPT = process.argv.includes("--no-opt");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });

run("cargo", ["build", "-p", "framegeist-wasm", "--target", "wasm32-unknown-unknown", "--release"]);
run("wasm-bindgen", ["--out-dir", "web/pkg", "--target", "web", "target/wasm32-unknown-unknown/release/framegeist_wasm.wasm"]);

const wasm = join(ROOT, "web/pkg/framegeist_wasm_bg.wasm");
if (!NO_OPT) {
  const tmp = join(ROOT, "web/pkg/framegeist_wasm_bg.opt.wasm");
  try {
    run("npx", ["--yes", "--package=binaryen", "--", "wasm-opt", "-O2", "--enable-simd", "--enable-bulk-memory", "-o", tmp, wasm]);
    const before = statSync(wasm).size;
    const after = statSync(tmp).size;
    renameSync(tmp, wasm);
    console.log(`wasm-opt: ${before} -> ${after} bytes (${(100 - (after / before) * 100).toFixed(1)}% smaller)`);
  } catch (e) {
    rmSync(tmp, { force: true });
    console.log(`wasm-opt skipped (${e.message}); run "npm exec --yes --package=binaryen -- wasm-opt ..." manually if needed`);
  }
}
if (!existsSync(wasm)) throw new Error("wasm build missing");
console.log(`wasm size: ${statSync(wasm).size} bytes`);
run("node", ["tools/wasm-smoke.mjs"]);

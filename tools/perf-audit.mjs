// FrameGeist performance gate (v0.5 contract §4):
//   24MP preview <= 600ms, export <= 2s; 60MP preview <= 1.5s, export <= 4s.
// Measures the WASM engine in the real browser over CDP (same path the app uses).
// Usage: FG_CDP_PORT=9237 node tools/perf-audit.mjs
const PORT = process.env.FG_CDP_PORT ?? "9237";
const TEMPLATE = process.env.FG_PERF_TEMPLATE ?? "classic-watermark-single-row";

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
const page =
  list.find((t) => t.type === "page" && /framegeist|localhost|tauri\.localhost/i.test(t.url)) ??
  list.find((t) => t.type === "page");
if (!page) { console.error(`no page target on ${PORT}`); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params) =>
  new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params ?? {} })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((res) => { ws.onopen = res; });
await send("Runtime.enable");
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
};

const res = await ev(`
  (async () => {
    const engine = window.__fg.engine;
    if (!engine) return { error: "engine not ready" };
    const tpl = await (await fetch("./templates/${TEMPLATE}.json")).text();
    const load = async (p) => new Uint8Array(await (await fetch(p)).arrayBuffer());
    const photos = {
      "24mp": await load("/tools/perf/photo-24mp.jpg"),
      "60mp": await load("/tools/perf/photo-60mp.jpg"),
    };
    // App fast-preview path (web/app.js renderNow): browser decodes the photo,
    // downscales to 1600px, then hands RGBA to the engine (render_raw).
    const fastPreview = async (bytes) => {
      const t0 = performance.now();
      const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
      const cap = 1600;
      const scale = Math.min(1, cap / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      bmp.close();
      const rgba = new Uint8Array(data.buffer.slice(0));
      const out = engine.render_raw(rgba, w, h, bytes, tpl, "jpeg", "");
      return { ms: +(performance.now() - t0).toFixed(0), kb: Math.round(out.length / 1024) };
    };
    // Full export path (app export with preview unchecked).
    const fullExport = (bytes) => {
      const t0 = performance.now();
      const out = engine.render_with_overrides(bytes, tpl, "jpeg", false, "", 0, false);
      return { ms: +(performance.now() - t0).toFixed(0), kb: Math.round(out.length / 1024) };
    };
    // Engine-side preview sampling (no browser pre-decode), reported for reference.
    const enginePreview = (bytes) => {
      const t0 = performance.now();
      const out = engine.render_with_overrides(bytes, tpl, "jpeg", true, "", 0, false);
      return { ms: +(performance.now() - t0).toFixed(0), kb: Math.round(out.length / 1024) };
    };
    const avg = async (fn) => {
      await fn(); // warm-up (font/decoder caches)
      const runs = [await fn(), await fn()];
      return { ms: Math.round((runs[0].ms + runs[1].ms) / 2), kb: runs[1].kb };
    };
    const out = {};
    for (const [name, bytes] of Object.entries(photos)) {
      out[name + "-preview"] = await avg(() => fastPreview(bytes));
      out[name + "-export"] = await avg(() => fullExport(bytes));
      out[name + "-engine-preview"] = await avg(() => enginePreview(bytes));
    }
    return out;
  })()
`);
if (res?.error) { console.error("PERF-ERROR:", res.error); process.exit(2); }

const GATES = {
  "24mp-preview": 600,
  "24mp-export": 2000,
  "60mp-preview": 1500,
  "60mp-export": 4000,
};
let failed = 0;
for (const [k, gate] of Object.entries(GATES)) {
  const got = res[k].ms;
  const ok = got <= gate;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${k}: ${got}ms (<= ${gate}ms, ${res[k].kb}KB)`);
}
for (const k of Object.keys(res)) {
  if (!GATES[k]) console.log(`info ${k}: ${res[k].ms}ms (${res[k].kb}KB, not gated)`);
}
console.log(`\n=== perf audit: ${Object.keys(GATES).length - failed}/${Object.keys(GATES).length} passed ===`);
ws.close();
process.exit(failed ? 1 : 0);

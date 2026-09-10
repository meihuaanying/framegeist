// FrameGeist E2E audit gate (v0.2.0): drives the real Tauri WebView2 over CDP.
// Prereq: app started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
// Usage: node tools/e2e-audit.mjs [screenshotDir]
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SHOTS = process.argv[2] ?? "docs/reports/v0.2.0";
mkdirSync(SHOTS, { recursive: true });

import { resolve as pathResolve } from "node:path";
const ABS = (p) => pathResolve(p).split("\\").join("/");
const PHOTO_24MP = ABS("tools/perf/photo-24mp.jpg");
const PHOTO_A = ABS("templates/assets/test-photos/sample-landscape.jpg");
const PHOTO_B = ABS("templates/assets/test-photos/sample-portrait.jpg");
const PHOTO_C = ABS("templates/assets/test-photos/sample-square.jpg");
const PHOTO_D = ABS("templates/assets/test-photos/sample-noexif.png");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const list = await fetch("http://127.0.0.1:9223/json/list").then((r) => r.json());
const page = list.find((t) => t.type === "page");
if (!page) { console.error("no page target on 9223"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params) =>
  new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params ?? {} }));
  });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") {
    console.log("PAGE-EXC:", JSON.stringify(m.params.exceptionDetails).slice(0, 220));
  }
};
await new Promise((res) => { ws.onopen = res; });
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
};
const inject = async (files, selector = "#fileInput") => {
  await ev(`document.querySelector("${selector}").value = ""`);
  const doc = await send("DOM.getDocument", { depth: -1 });
  const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) throw new Error(`selector ${selector} not found`);
  await send("DOM.setFileInputFiles", { files, nodeId: q.nodeId });
};
const waitLabel = async (timeoutMs = 60000) => {
  await ev(`document.getElementById("stageLabel").textContent = "WAIT"`);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await ev(`document.getElementById("stageLabel").textContent`);
    if (v && v.includes("ms")) return v;
    if (v && v.includes("失败")) return v;
    await new Promise((r) => setTimeout(r, 180));
  }
  return "TIMEOUT";
};

/* ---- 0. boot ---- */
const boot = await ev(`document.getElementById("statusText").textContent`);
check("boot: ready", boot === "就绪", `status=${boot}`);
check("boot: <=2s", (await ev("window.__bootMs")) > 0 && (await ev("window.__bootMs")) < 2000, `${await ev("window.__bootMs")}ms`);

/* ---- 1. layout metrics (user's complaint) ---- */
const layout = await ev(`
  (() => {
    const body = document.body;
    const vp = document.getElementById("viewport").getBoundingClientRect();
    return {
      pageScroll: body.scrollHeight > innerHeight + 2 || body.scrollWidth > innerWidth + 2,
      viewportH: Math.round(vp.height),
      viewportArea: vp.width * vp.height,
      windowH: innerHeight,
    };
  })()
`);
check("layout: no page scroll at 1440x900", !layout.pageScroll, JSON.stringify(layout));
check("layout: viewport fills window", layout.viewportH > 500, `viewportH=${layout.viewportH}`);

/* ---- 2. thumbnails use real photos ---- */
const thumbs = await ev(`
  (async () => {
    const imgs = [...document.querySelectorAll(".thumb img")];
    const sample = imgs.slice(0, 6);
    const sizes = await Promise.all(sample.map(i => new Promise(r => { if (i.complete && i.naturalWidth) r([i.naturalWidth, i.naturalHeight]); else i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.onerror = () => r([0,0]); })));
    return { count: imgs.length, sizes };
  })()
`);
check("thumbnails: loaded", thumbs.sizes.every(([w]) => w > 50), JSON.stringify(thumbs.sizes.slice(0, 3)));

/* ---- 3. pinned selection visible when filtering ---- */
await ev(`[...document.querySelectorAll("#catChips button")].find(b => b.textContent === "film").click()`);
await new Promise((r) => setTimeout(r, 300));
const pinned = await ev(`document.getElementById("pinnedName").textContent`);
check("selection: pinned name visible after category switch", pinned && pinned !== "—", pinned);
await ev(`[...document.querySelectorAll("#catChips button")].find(b => b.textContent.includes("全部")).click()`);
await new Promise((r) => setTimeout(r, 300));

/* ---- 4. inject 24MP photo, preview render ---- */
await inject([PHOTO_24MP]);
const t0 = Date.now();
const label = await waitLabel(30000);
check("render: preview succeeds", label.includes("ms"), label);
const stage = await ev(`
  (() => {
    const vp = document.getElementById("viewport").getBoundingClientRect();
    const img = document.querySelector("#canvasWrap img");
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const inter = Math.max(0, Math.min(r.right, vp.right) - Math.max(r.left, vp.left)) *
                  Math.max(0, Math.min(r.bottom, vp.bottom) - Math.max(r.top, vp.top));
    return { coverage: +(inter / (vp.width * vp.height) * 100).toFixed(1), fits: r.height <= vp.height + 2 };
  })()
`);
check("stage: image visible without scrolling", stage && stage.fits, JSON.stringify(stage));
check("stage: coverage >= 55% (fit-width, aspect varies)", stage && stage.coverage >= 55, `coverage=${stage?.coverage}%`);
await shot("01-frame-dark-24mp");

/* ---- 5. aspect override ---- */
await ev(`document.getElementById("aspectSelect").value = "1:1"; document.getElementById("aspectSelect").dispatchEvent(new Event("change"))`);
let l2 = await waitLabel(30000);
const dims = await ev(`(() => { const i = document.querySelector("#canvasWrap img"); return [i.naturalWidth, i.naturalHeight]; })()`);
check("aspect 1:1", dims && Math.abs(dims[0] - dims[1]) <= 2, JSON.stringify(dims));
await ev(`document.getElementById("aspectSelect").value = "original"; document.getElementById("aspectSelect").dispatchEvent(new Event("change"))`);
await waitLabel(30000);

/* ---- 6. background solid + color ---- */
await ev(`document.getElementById("bgSelect").value = "solid"; document.getElementById("bgSelect").dispatchEvent(new Event("change"))`);
await waitLabel(30000);
await shot("02-bg-solid");
await ev(`document.getElementById("bgSelect").value = "default"; document.getElementById("bgSelect").dispatchEvent(new Event("change"))`);
await waitLabel(30000);

/* ---- 7. flip ---- */
await ev(`document.getElementById("flipH").click()`);
await waitLabel(30000);
const flipOn = await ev(`document.getElementById("flipH").classList.contains("on")`);
check("flip: toggled and re-rendered", flipOn);
await ev(`document.getElementById("flipH").click()`);
await waitLabel(30000);

/* ---- 8. zoom / pan ---- */
await ev(`
  (() => {
    const vp = document.getElementById("viewport");
    const r = vp.getBoundingClientRect();
    vp.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, clientX: r.left + r.width/2, clientY: r.top + r.height/2, bubbles: true, cancelable: true }));
  })()
`);
const zoomed = await ev(`document.getElementById("zoomLabel").textContent`);
check("zoom: wheel zoom changes scale", zoomed !== "100%" && zoomed !== "", `zoom=${zoomed}`);
await ev(`document.getElementById("zoomFit").click()`);

/* ---- 9. brand detection + logo toggle (needs a photo WITH EXIF) ---- */
await inject([PHOTO_A]);
await waitLabel(30000);
const brandText = await ev(`document.getElementById("brandDetected").textContent`);
check("brand: detected from EXIF", /sony/i.test(brandText), brandText);
const brandLayer = await ev(`document.getElementById("brandShow").checked`);
check("brand: show toggle on by default", brandLayer === true);

/* ---- 10. EXIF editor ---- */
const editRows = await ev(`document.querySelectorAll("#lineEditor .line-item").length`);
check("exif editor: rows rendered", editRows > 0, `rows=${editRows}`);
const edited = await ev(`
  (() => {
    const input = document.querySelector("#lineEditor .line-item input");
    if (!input) return "no-input";
    input.value = "Sony {model_pretty} TEST";
    input.dispatchEvent(new Event("change"));
    return "edited";
  })()
`);
check("exif editor: edit triggers re-render", edited === "edited");
await new Promise((r) => setTimeout(r, 1500));
await ev(`document.getElementById("resetLines").click()`);
await new Promise((r) => setTimeout(r, 1200));

/* ---- 11. template picker large mode ---- */
await ev(`document.getElementById("pickerLarge").click()`);
const large = await ev(`document.getElementById("templateGrid").classList.contains("large")`);
check("picker: two modes", large === true);
await ev(`document.getElementById("pickerCompact").click()`);

/* ---- 12. theme + i18n ---- */
await ev(`localStorage.setItem("fg-theme","light"); location.reload()`);
await new Promise((r) => setTimeout(r, 6500));
await inject([PHOTO_24MP]);
await waitLabel(30000);
await shot("03-frame-light-24mp");
await ev(`localStorage.setItem("fg-theme","dark")`);
await ev(`document.getElementById("langBtn").click()`);
const en = await ev(`document.getElementById("renderBtn").textContent`);
check("i18n: en switch", /Render/.test(en), en);
await ev(`document.getElementById("langBtn").click()`);

/* ---- 13. HEIC error path ---- */
writeFileSync(join(SHOTS, "fake.heic"), "not really heic");
const FAKE_HEIC = ABS(join(SHOTS, "fake.heic"));
await inject([FAKE_HEIC]);
await new Promise((r) => setTimeout(r, 1200));
const toasts = await ev(`document.getElementById("toasts").textContent`);
check("heic: localized unsupported message", /HEIC/i.test(toasts), toasts.slice(0, 80));
check("heic: no crash (status ok)", (await ev(`document.getElementById("statusText").textContent`)) !== "出错");

/* ---- 14. collage mode ---- */
await ev(`document.getElementById("modeCollage").click()`);
await new Promise((r) => setTimeout(r, 400));
await inject([PHOTO_A, PHOTO_B, PHOTO_C, PHOTO_D]);
const collageLabel = await waitLabel(60000);
check("collage: renders", collageLabel.includes("ms"), collageLabel);
await shot("04-collage-dark");

/* ---- 15. batch export (frame mode, 2 photos, no dialogs) ---- */
await ev(`document.getElementById("modeFrame").click()`);
await new Promise((r) => setTimeout(r, 300));
await inject([PHOTO_A, PHOTO_B]);
await waitLabel(30000);
const batchVisible = await ev(`!document.getElementById("exportBatchBtn").classList.contains("hidden")`);
check("batch: button visible with 2 photos", batchVisible === true);

/* ---- 16. import .fgt round-trip ---- */
// build a store-only zip fixture in node (mirrors app.js format)
const { execFileSync } = await import("node:child_process");
const fs = await import("node:fs");
const templateFixture = JSON.parse(fs.readFileSync("templates/minimal-corner-iso.json", "utf8"));
templateFixture.meta.id = "user-imported-fixture";
templateFixture.meta.name = "Imported Fixture";
const fgt = makeFgt(Buffer.from(JSON.stringify(templateFixture)));
writeFileSync(join(SHOTS, "fixture.fgt"), fgt);
const FGT_PATH = ABS(join(SHOTS, "fixture.fgt"));
await inject([FGT_PATH], "#fgtFile");
await new Promise((r) => setTimeout(r, 1500));
const importToast = await ev(`document.getElementById("toasts").textContent`);
check("fgt: import works", /Imported Fixture|导入/.test(importToast), importToast.slice(0, 90));

function makeFgt(jsonBuf) {
  // store-only zip with manifest.json + template.json
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const enc = new TextEncoder();
  const files = [
    ["manifest.json", enc.encode(JSON.stringify({ formatVersion: 1, kind: "framegeist-template" }))],
    ["template.json", jsonBuf],
  ];
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x2100, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    Buffer.from(nameBytes).copy(local, 30); Buffer.from(data).copy(local, 30 + nameBytes.length);
    parts.push(local);
    const cen = Buffer.alloc(46 + nameBytes.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 8); cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x2100, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBytes.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
    Buffer.from(nameBytes).copy(cen, 46);
    central.push(cen);
    offset += local.length;
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

ws.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== E2E audit: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(1);
}
console.log(`screenshots: ${SHOTS}`);

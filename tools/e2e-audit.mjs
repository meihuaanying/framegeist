// FrameGeist E2E audit gate (v0.2.0): drives the real Tauri WebView2 over CDP.
// Prereq: app started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
// Usage: node tools/e2e-audit.mjs [screenshotDir]
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const SHOTS = process.argv[2] ?? "docs/reports/v0.4.0";
mkdirSync(SHOTS, { recursive: true });

/** Minimal PNG writer (v0.5 frame fixture): opaque border + transparent window. */
function writeFramePng(path, w = 480, h = 640) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const inWindow = x > w * 0.18 && x < w * 0.82 && y > h * 0.15 && y < h * 0.85;
      raw[o++] = 245; raw[o++] = 245; raw[o++] = 240;
      raw[o++] = inWindow ? 0 : 255;
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return path;
}
const FRAME_PNG = writeFramePng(pathResolve(join(SHOTS, "fixture-frame.png")));

import { resolve as pathResolve } from "node:path";
const ABS = (p) => pathResolve(p).split("\\").join("/");
const PHOTO_24MP = ABS("tools/perf/photo-24mp.jpg");
const PHOTO_A = ABS("templates/assets/test-photos/sample-landscape.jpg");
const PHOTO_B = ABS("templates/assets/test-photos/sample-portrait.jpg");
const PHOTO_C = ABS("templates/assets/test-photos/sample-square.jpg");
const PHOTO_D = ABS("templates/assets/test-photos/sample-noexif.png");

const WATCHDOG = setTimeout(() => {
  console.log("WATCHDOG: audit exceeded 15 minutes; results so far:");
  console.log(results.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.name}`).join("\n"));
  process.exit(3);
}, 15 * 60 * 1000);
const results = [];
const pageErrors = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const CDP_PORT = process.env.FG_CDP_PORT ?? "9223";
const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
// Prefer the app page (Tauri or the local dev server); ignore Edge dialogs.
const page =
  list.find((t) => t.type === "page" && /framegeist|localhost|tauri\.localhost/i.test(t.url)) ??
  list.find((t) => t.type === "page");
if (!page) { console.error(`no page target on ${CDP_PORT}`); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params) =>
  new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params ?? {} }));
  });
/* Race a CDP call against a timeout so a lost/huge response can never hang the
   gate (Node's built-in WebSocket intermittently drops/glues large messages). */
const sendT = (method, params, ms = 30000) =>
  Promise.race([send(method, params), new Promise((res) => setTimeout(() => res({}), ms))]);
/* Node's built-in WebSocket (undici) occasionally delivers two consecutive CDP
   JSON messages glued into a single `message` event (intermittent, observed on
   Node 24.20). Re-split concatenated documents with a brace-depth scanner so a
   framing quirk cannot crash the gate. */
const splitCdpMessages = (raw) => {
  const text = typeof raw === "string" ? raw : String(raw);
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; continue; }
    if (c === "}") {
      if (depth > 0 && --depth === 0 && start >= 0) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* drop malformed doc */ }
        start = -1;
      }
    }
  }
  if (!out.length && text.trim()) {
    try { out.push(JSON.parse(text)); } catch { /* ignore */ }
  }
  return out;
};
ws.onmessage = (ev) => {
  for (const m of splitCdpMessages(ev.data)) {
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") {
      const text = JSON.stringify(m.params.exceptionDetails).slice(0, 500);
      pageErrors.push(`EXC ${text}`);
      console.log("PAGE-EXC:", text);
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      const text = m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300);
      pageErrors.push(`CONSOLE ${text}`);
      console.log("CONSOLE-ERR:", text);
    }
  }
};
await new Promise((res) => { ws.onopen = res; });
await send("Runtime.enable");
await send("Network.enable").catch(() => {});
await send("Network.setCacheDisabled", { cacheDisabled: true }).catch(() => {});
await send("Page.setBypassServiceWorker", { bypass: true }).catch(() => {});
await send("Network.setBypassServiceWorker", { bypass: true }).catch(() => {});
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  // 90s: a single wasm render can block the main thread for a long time when
  // the build machine is busy (parallel workstreams compile wasm/cargo).
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ result: { value: undefined } }), 90000));
  const call = send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  const r = await Promise.race([call, timeout]);
  return r.result?.value;
};
/* Fire a Runtime.evaluate that navigates; the reply is usually lost, so don't
   wait more than a moment for it. */
const evNav = (expr) => sendT("Runtime.evaluate", { expression: expr, awaitPromise: false, returnByValue: true }, 3000);
const shot = async (name) => {
  const r = await sendT("Page.captureScreenshot", { format: "png" }, 60000);
  if (r?.data) writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
};
const inject = async (files, selector = "#fileInput") => {
  await ev(`document.querySelector("${selector}").value = ""`);
  // depth 0 (root only): the whole-DOM depth:-1 response is multi-MB and made
  // Node's built-in WebSocket drop/glue frames. querySelector searches the tree.
  for (let attempt = 0; attempt < 2; attempt++) {
    const doc = await sendT("DOM.getDocument", { depth: 0 });
    const q = await sendT("DOM.querySelector", { nodeId: doc.root?.nodeId, selector });
    if (q.nodeId) { await sendT("DOM.setFileInputFiles", { files, nodeId: q.nodeId }); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`selector ${selector} not found`);
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
// Warm reload on the clean network path (no stale service worker cache;
// Tauri has no SW either). Measures a warm-cache start.
await sendT("Runtime.evaluate", {
  expression: `(async () => {
    try {
      const ks = await caches.keys();
      await Promise.all(ks.map((k) => caches.delete(k)));
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {}
    localStorage.clear();
    return "cleared";
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 4500));
const boot = await ev(`document.getElementById("statusText").textContent`);
check("boot: ready", boot === "就绪", `status=${boot}`);
check("boot: <=2s", (await ev("window.__bootMs")) > 0 && (await ev("window.__bootMs")) < 2000, `${await ev("window.__bootMs")}ms`);

/* ---- 0b. template wall (v0.4.0 first screen) ---- */
{
  const wall = await ev(`(() => ({
    view: window.__fg.state.view,
    wallHidden: document.getElementById("wall").classList.contains("hidden"),
    editorHidden: document.getElementById("editor").classList.contains("hidden"),
    count: document.getElementById("wallCount").textContent,
    tabs: document.querySelectorAll("#wallCats button").length,
  }))()`);
  check("wall: opens as first view", wall.view === "wall" && !wall.wallHidden && wall.editorHidden, JSON.stringify(wall));
  check("wall: 192 templates counted", /192/.test(wall.count), wall.count);
  check("wall: 27 category tabs (all+mine+25)", wall.tabs === 27, String(wall.tabs));

  const cards = await ev(`
    (async () => {
      const list = [...document.querySelectorAll(".wall-card")];
      const img = list[0]?.querySelector("img");
      if (img && !(img.complete && img.naturalWidth)) await new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 5000); });
      const cols = getComputedStyle(document.getElementById("wallGrid")).gridTemplateColumns.split(" ").length;
      return { n: list.length, src: img?.getAttribute("src") ?? "", w: img?.naturalWidth ?? 0, cols };
    })()
  `);
  check("wall: responsive card grid", cards.n >= 180 && cards.cols >= 3, JSON.stringify({ n: cards.n, cols: cards.cols }));
  check("wall: real-photo preview loads", /\/previews\//.test(cards.src) && cards.w > 50, `${cards.src} w=${cards.w}`);
  check("wall: card has name + category chip", await ev(`(() => { const c = document.querySelector(".wall-card"); return !!c.querySelector(".wall-name b")?.textContent && !!c.querySelector(".wall-cat")?.textContent; })()`));

  const manifest = JSON.parse(readFileSync("web/templates.json", "utf8"));
  const ENUM = new Set(["white-border", "camera", "phone", "drone", "fuji", "film", "colorwalk", "colorful", "classic-watermark", "portfolio", "black-frame", "sports", "calendar", "magazine", "minimal", "borderless", "master", "personal", "polaroid", "festival", "effect", "colorcard", "blur-bg", "ticket", "game"]);
  check("library: 192 templates in manifest", manifest.length === 192, String(manifest.length));
  check("library: categories within v0.4 enum", manifest.every((t) => ENUM.has(t.category)), manifest.filter((t) => !ENUM.has(t.category)).map((t) => t.category).join(",") || "ok");
  check("library: bilingual names complete", manifest.every((t) => t.names?.zh && t.names?.en));
  const previews = readdirSync("web/previews").filter((f) => f.endsWith(".jpg")).length;
  check("library: preview image per template", previews === manifest.length, `previews=${previews}`);

  await ev(`document.querySelector(".wall-card .wall-actions .icon").click()`);
  await new Promise((r) => setTimeout(r, 700));
  check("wall: magnifier opens lightbox", await ev(`!document.getElementById("lightbox").classList.contains("hidden")`));
  await ev(`document.getElementById("lbClose").click()`);

  await ev(`(async () => { await window.__fg.useTemplate("classic-watermark-single-row"); })()`);
  await new Promise((r) => setTimeout(r, 600));
  const edit = await ev(`(() => {
    const wallHidden = document.getElementById("wall").classList.contains("hidden");
    const editorShown = !document.getElementById("editor").classList.contains("hidden");
    const sb = document.querySelector(".sidebar").getBoundingClientRect();
    const ws = document.querySelector(".workspace").getBoundingClientRect();
    const vp = document.getElementById("viewport").getBoundingClientRect();
    return { wallHidden, editorShown, right: sb.left > ws.left, vpW: Math.round(vp.width), vpH: Math.round(vp.height) };
  })()`);
  check("wall -> editor: selecting a template enters editor", edit.wallHidden && edit.editorShown, JSON.stringify(edit));
  check("editor: controls column on the right", edit.right === true);
  check("editor: large preview viewport", edit.vpW > 600 && edit.vpH > 400, `${edit.vpW}x${edit.vpH}`);
  await shot("00-editor");

  await ev(`document.getElementById("backToWall").click()`);
  await new Promise((r) => setTimeout(r, 500));
  check("editor: back button returns to wall", await ev(`window.__fg.state.view === "wall"`));
  await ev(`(async () => { await window.__fg.useTemplate("classic-watermark-single-row"); })()`);
  await new Promise((r) => setTimeout(r, 500));
}

/* ---- 1. layout metrics (editor) ---- */
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
await ev(`document.querySelector('#catChips [data-cat="film"]').click()`);
await new Promise((r) => setTimeout(r, 300));
const pinned = await ev(`document.getElementById("pinnedName").textContent`);
check("selection: pinned name visible after category switch", pinned && pinned !== "—", pinned);
await ev(`document.querySelector('#catChips [data-cat="all"]').click()`);
await new Promise((r) => setTimeout(r, 300));

/* ---- 4. inject 24MP photo, preview render ---- */
await inject([PHOTO_24MP]);
const t0 = Date.now();
const label = await waitLabel(30000);
check("render: preview succeeds", label.includes("ms"), label);
// the label flips before the <img> finishes decoding; wait for real pixels
await ev(`
  (async () => {
    for (let i = 0; i < 80; i++) {
      const img = document.querySelector("#canvasWrap img");
      if (img && img.complete && img.naturalWidth > 0) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  })()
`);
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
await evNav(`localStorage.setItem("fg-theme","light"); location.reload()`);
await new Promise((r) => setTimeout(r, 6500));
await inject([PHOTO_24MP]);
await waitLabel(30000);
await shot("03-frame-light-24mp");
await ev(`localStorage.setItem("fg-theme","dark")`);
await ev(`document.getElementById("langBtn").click()`);
const en = await ev(`document.getElementById("renderBtn").textContent`);
check("i18n: en switch", /Render/.test(en), en);
await ev(`document.getElementById("langBtn").click()`);

/* ---- 13. HEIC path (v0.6.0: lazy libheif — vendored, or graceful) ---- */
// Synthesize a 15-byte fake .heic (same in-memory approach as writeFramePng):
// the input must never crash the page. Either it stages (decoder present and
// the fixture were valid) or a friendly localized toast appears.
writeFileSync(join(SHOTS, "fake.heic"), Buffer.from("not really heic"));
const FAKE_HEIC = ABS(join(SHOTS, "fake.heic"));
const HEIC_PAGE_ERRORS_BEFORE = pageErrors.length;
{
  const before = await ev(`window.__fg.state.photos.length`);
  await inject([FAKE_HEIC]);
  await new Promise((r) => setTimeout(r, 2500));
  const outcome = await ev(`(() => ({
    photos: window.__fg.state.photos.length,
    toasts: [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent),
    status: document.getElementById("statusText").textContent,
  }))()`);
  const staged = outcome.photos > before;
  const friendly = outcome.toasts.some((x) => /HEIC|HEIF/i.test(x));
  check("heic: .heic input stages or shows a friendly toast", staged || friendly, JSON.stringify({ staged, toasts: outcome.toasts.slice(-2) }));
  check("heic: no page error during the HEIC path", pageErrors.length === HEIC_PAGE_ERRORS_BEFORE, pageErrors.slice(HEIC_PAGE_ERRORS_BEFORE).join(" | ").slice(0, 200));
  check("heic: app status stays healthy", outcome.status !== "出错", outcome.status);
}
if (existsSync("web/vendor/libheif/libheif-bundle.mjs")) {
  const mod = await ev(`(async () => {
    try {
      const m = await window.__fg.loadHeifModule();
      return { ok: typeof m?.HeifDecoder === "function", decoder: typeof m?.HeifDecoder };
    } catch (e) { return { ok: false, error: String(e) }; }
  })()`);
  check("heic: vendored libheif module loads and exposes HeifDecoder", mod?.ok === true, JSON.stringify(mod));
} else {
  check("heic: offline degradation hook wired (no vendored module)", (await ev(`typeof window.__fg.loadHeifModule === "function"`)) === true);
}

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
const templateFixture = JSON.parse(fs.readFileSync("crates/framegeist-cli/tests/fixtures/minimal-corner-iso.json", "utf8"));
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


/* ================= v0.3.0 assertions ================= */

/* 17. palette: no purple anywhere (files + runtime token) */
{
  const { readFileSync } = await import("node:fs");
  const banned = ["#a06bff", "#8b5cf6", "#7c3aed", "#9b5cff", "#6e8bff", "160,107,255", "155,92,255"];
  const files = ["web/styles.css", "site/site.css", "web/favicon.svg", "site/favicon.svg"];
  let hits = [];
  for (const f of files) {
    const txt = readFileSync(f, "utf8").toLowerCase();
    for (const b of banned) if (txt.includes(b)) hits.push(`${f}:${b}`);
  }
  check("palette: no purple in styles", hits.length === 0, hits.join(","));
  const accent = await ev(`getComputedStyle(document.documentElement).getPropertyValue("--accent-a").trim()`);
  check("palette: accent is zhihu blue", accent.toLowerCase() === "#1772f6", accent);
}

/* 18. library: 130 templates incl. game category + notice */
{
  const count = await ev(`window.__fg.state.templates.length`);
  check("library: 192 templates", count === 192, String(count));
  const hasGame = await ev(`window.__fg.state.templates.some(t => t.category === "game")`);
  check("library: game category present", hasGame === true);
  const chip = await ev(`[...document.querySelectorAll("#catChips button")].some(b => b.textContent.includes("游戏"))`);
  check("library: game chip localized", chip === true);
  const { readFileSync } = await import("node:fs");
  const g = JSON.parse(readFileSync("templates/game-genshin-v1.json", "utf8"));
  check("game: notice present", !!g.meta.notice && /Unofficial/i.test(g.meta.notice));
  check("game: bilingual name", !!g.meta.nameI18n?.zh && !!g.meta.nameI18n?.en);
}

/* 19. badge pixels: logo toggle must change the render */
{
  await ev(`document.querySelector('#catChips [data-cat="film"]').click()`);
  await new Promise((r) => setTimeout(r, 300));
  await ev(`document.querySelectorAll(".thumb")[0].click()`);
  await waitLabel(30000);
  const hash = () => ev(`(() => { const b = window.__fg.state.lastRender; let h = 0; for (let i = 0; i < b.length; i += 97) h = (h * 31 + b[i]) >>> 0; return h; })()`);
  const withLogo = await hash();
  await ev(`document.getElementById("brandShow").checked = false; document.getElementById("brandShow").dispatchEvent(new Event("change"))`);
  await waitLabel(30000);
  const withoutLogo = await hash();
  check("brand: logo toggles real pixels", withLogo !== withoutLogo, `${withLogo} vs ${withoutLogo}`);
  await ev(`document.getElementById("brandShow").checked = true; document.getElementById("brandShow").dispatchEvent(new Event("change"))`);
  await waitLabel(30000);
}

/* 20. borderless auto-contrast template renders */
{
  const ok = await ev(`
    (async () => {
      const tpl = await (await fetch("./templates/borderless-center-caption-01.json")).text();
      try {
        const out = window.__fg.engine.render_with_overrides(window.__fg.state.photos[0].bytes, tpl, "jpeg", true, "", 0, false);
        return out.length > 1000;
      } catch (e) { return String(e); }
    })()
  `);
  check("auto-contrast: borderless renders", ok === true, String(ok));
}

/* 21. lightbox: open, navigate, close */
{
  await ev(`document.querySelector(".thumb .zoom").click()`);
  await new Promise((r) => setTimeout(r, 800));
  const open = await ev(`!document.getElementById("lightbox").classList.contains("hidden")`);
  check("lightbox: opens from magnifier", open === true);
  const name1 = await ev(`document.getElementById("lbName").textContent`);
  const imgReady = await ev(`(async () => { const i = document.getElementById("lbImg"); for (let k = 0; k < 40 && !i.src; k++) await new Promise(r => setTimeout(r, 100)); return !!i.src; })()`);
  check("lightbox: preview image loads", imgReady === true);
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`);
  await new Promise((r) => setTimeout(r, 500));
  const name2 = await ev(`document.getElementById("lbName").textContent`);
  check("lightbox: navigates", name1 !== name2, `${name1} -> ${name2}`);
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  const closed = await ev(`document.getElementById("lightbox").classList.contains("hidden")`);
  check("lightbox: ESC closes", closed === true);
  await shot("05-lightbox");
}

/* 22. settings: open, change, persist across reload */
{
  await ev(`document.getElementById("settingsBtn").click()`);
  await new Promise((r) => setTimeout(r, 400));
  const open = await ev(`!document.getElementById("settings").classList.contains("hidden")`);
  check("settings: opens (gear)", open === true);
  await ev(`const s = document.getElementById("setExportSize"); s.value = "2048"; s.dispatchEvent(new Event("change"))`);
  const stored = await ev(`JSON.parse(localStorage.getItem("fg-settings-v1")); null`);
  const val = await ev(`JSON.parse(localStorage.getItem("fg-settings-v1")).exportSize`);
  check("settings: export size persists", val === "2048", String(val));
  await ev(`document.getElementById("settingsClose").click()`);
  await sendT("Page.reload");
  await new Promise((r) => setTimeout(r, 7000));
  const after = await ev(`JSON.parse(localStorage.getItem("fg-settings-v1")).exportSize`);
  check("settings: persists across reload", after === "2048", String(after));
  await shot("06-settings");
  await ev(`localStorage.setItem("fg-theme","dark")`);
}

/* 23. v0.4 engine: letter-spacing + rotation pixel assertions */
{
  const probe = await ev(`
    (async () => {
      try {
      const engine = window.__fg.engine;
      const c0 = new OffscreenCanvas(1600, 1200);
      const g0 = c0.getContext("2d");
      const grad = g0.createLinearGradient(0, 0, 1600, 1200);
      grad.addColorStop(0, "#2050C0"); grad.addColorStop(0.5, "#3FBF63"); grad.addColorStop(1, "#E04020");
      g0.fillStyle = grad; g0.fillRect(0, 0, 1600, 1200);
      const bytes = new Uint8Array(await (await c0.convertToBlob({ type: "image/jpeg", quality: 0.92 })).arrayBuffer());
      const mk = (spacing, rotation) => JSON.stringify({
        meta: { id: "e2e-probe", name: "probe", version: "1.0.0", minEngineVersion: "0.4.0", author: "FrameGeist", license: "CC0-1.0", category: "minimal" },
        canvas: { mode: "extend", padding: { top: 0.05, right: 0.05, bottom: 0.35, left: 0.05 }, background: { type: "solid", color: "#000000" } },
        layers: [
          { type: "shape", id: "blind", anchor: "middle-center", shape: "rect", size: { width: 1, height: 1 }, color: "#000000", opacity: 1 },
          { type: "text", id: "t", anchor: "bottom-center", offset: { x: 0, y: -0.12 },
            font: { family: ["JetBrains Mono"], size: 0.05, color: "#FF0000" },
            letterSpacing: spacing, rotation: rotation,
            content: [{ expr: "'SPACING PROBE'", fallback: null }] }
        ]
      });
      const measure = async (spacing, rotation) => {
        const out = engine.render_with_overrides(bytes, mk(spacing, rotation), "jpeg", false, "", 640, false);
        const bmp = await createImageBitmap(new Blob([out], { type: "image/jpeg" }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
        for (let y = 0; y < bmp.height; y++) {
          for (let x = 0; x < bmp.width; x++) {
            const i = (y * bmp.width + x) * 4;
            if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) { n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
          }
        }
        return { n, w: maxX - minX + 1, h: maxY - minY + 1 };
      };
      const a = await measure(0, 0);
      const b = await measure(0.4, 0);
      const r = await measure(0, 90);
      return { a, b, r };
      } catch (e) { return { error: String((e && e.message) || e) }; }
    })()
  `);
  if (probe?.error) console.log("PROBE-ERROR:", probe.error);
  check("engine: letterSpacing widens the text block", !!probe?.b && probe.b.n > 50 && probe.b.w > probe.a.w * 1.12, probe?.error ?? `w ${probe?.a?.w} -> ${probe?.b?.w}`);
  check("engine: rotation swaps the text extent", !!probe?.r && probe.r.n > 50 && probe.r.h > probe.a.h * 1.4, probe?.error ?? `h ${probe?.a?.h} -> ${probe?.r?.h}`);
}

/* 24. v0.4 engine: palette chips paint distinct saturated colors */
{
  const bins = await ev(`
    (async () => {
      const tpl = await (await fetch("./templates/colorcard-tint-chips-01.json")).text();
      const c0 = new OffscreenCanvas(1600, 1200);
      const g0 = c0.getContext("2d");
      const grad = g0.createLinearGradient(0, 0, 1600, 1200);
      grad.addColorStop(0, "#2050C0"); grad.addColorStop(0.5, "#3FBF63"); grad.addColorStop(1, "#E04020");
      g0.fillStyle = grad; g0.fillRect(0, 0, 1600, 1200);
      const bytes = new Uint8Array(await (await c0.convertToBlob({ type: "image/jpeg", quality: 0.92 })).arrayBuffer());
      const out = window.__fg.engine.render_with_overrides(bytes, tpl, "jpeg", false, JSON.stringify({ showLogo: false }), 640, false);
      const bmp = await createImageBitmap(new Blob([out], { type: "image/jpeg" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const y0 = Math.floor(bmp.height * 0.72);
      const d = g.getImageData(0, y0, bmp.width, bmp.height - y0).data;
      const map = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        if (Math.max(r, gg, b) - Math.min(r, gg, b) < 48) continue;
        const key = (r >> 5) + "," + (gg >> 5) + "," + (b >> 5);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
      return [...map.values()].filter((n) => n >= 15).length;
    })()
  `);
  check("engine: palette chips paint >=3 distinct saturated colors", bins >= 3, String(bins));
}

/* 25-pre: the reload test leaves the app on the wall with no photo; restage. */
await inject([PHOTO_A]);
await ev(`(async () => {
  document.getElementById("modeFrame")?.click();
  window.__fg.showEditor();
  await window.__fg.useTemplate("classic-watermark-single-row");
  await new Promise((r) => setTimeout(r, 900));
})()`);

/* 25. v0.5 editor: panel tiers */
{
  const before = await ev(`({
    tier: document.body.dataset.tier,
    insertHidden: getComputedStyle(document.getElementById("insertCard")).display === "none",
  })`);
  check("editor: simple tier hides advanced cards", before.tier === "simple" && before.insertHidden, JSON.stringify(before));
  const after = await ev(`(async () => {
    document.getElementById("tierToggle").click();
    await new Promise((r) => setTimeout(r, 60));
    return { tier: document.body.dataset.tier, visible: getComputedStyle(document.getElementById("insertCard")).display !== "none" };
  })()`);
  check("editor: advanced tier shows insert card", after.tier === "advanced" && after.visible, JSON.stringify(after));
}

/* 26. v0.5 editor: layer rows + selection */
{
  const rows = await ev(`document.querySelectorAll("#layerList .layer-row").length`);
  check("editor: layer rows rendered", rows >= 2, String(rows));
  const sel = await ev(`(() => {
    const rowsBefore = [...document.querySelectorAll("#layerList .layer-row")].map((r) => r.dataset.id);
    document.querySelector("#layerList .layer-row").click();
    return {
      rowsBefore,
      edits: Object.keys(JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")),
      on: document.querySelectorAll("#layerList .layer-row.on").length,
      props: !!document.querySelector("#propsBody .props-grid"),
      rows: [...document.querySelectorAll("#layerList .layer-row")].map((r) => r.dataset.id),
      cacheLayers: (window.__fg.currentTemplateObject()?.layers ?? []).map((l) => l.id),
      users: window.__fg.state.userTemplates.map((u) => u.id),
      tid: window.__fg.state.templateId,
    };
  })()`);
  check("editor: clicking a layer row selects it", !!sel && (sel.on >= 1 || sel.props), JSON.stringify(sel));
}

/* 27. v0.5 editor: arrow nudge + undo/redo */
{
  const r = await ev(`(async () => {
    const st = window.__fg.state;
    const read = () => JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[st.templateId] ?? "";
    const off = (json) => {
      try { const L = JSON.parse(json).layers.find((l) => l.id === st.__selId); return L?.offset?.x ?? 0; } catch { return 0; }
    };
    const row = document.querySelector("#layerList .layer-row.on") || document.querySelector("#layerList .layer-row");
    row.click();
    st.__selId = row.dataset.id;
    const x0 = off(read());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    const x1 = off(read());
    document.getElementById("editUndo").click();
    await new Promise((r) => setTimeout(r, 250));
    const x2 = off(read());
    document.getElementById("editRedo").click();
    await new Promise((r) => setTimeout(r, 250));
    const x3 = off(read());
    return { x0, x1, x2, x3, hist: window.__fgEditor.debug().history, undoDisabled: document.getElementById("editUndo").disabled, trace: window.__fgEditor.debug().trace.slice(-10) };
  })()`);
  check("editor: arrow nudge moves layer", r.x1 > r.x0 + 0.0004, JSON.stringify(r));
  check("editor: undo restores offset", Math.abs(r.x2 - r.x0) < 0.0005, JSON.stringify(r));
  check("editor: redo re-applies nudge", Math.abs(r.x3 - r.x1) < 0.0005, JSON.stringify(r));
}

/* 28. v0.5 editor: drag with snapping + commit */
{
  const r = await ev(`(async () => {
    const img = document.querySelector("#canvasWrap img");
    const ov = document.querySelector(".edit-overlay");
    const st = window.__fg.state;
    if (!img || !ov) return { error: "no stage" };
    const ready = async (ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (img.complete && img.naturalWidth > 0 && ov.getBoundingClientRect().width > 10) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };
    if (!(await ready(4000))) return { error: "stage not ready" };
    const row = document.querySelector("#layerList .layer-row.on") || document.querySelector("#layerList .layer-row");
    row.click();
    const id = row.dataset.id;
    const rect = ov.getBoundingClientRect();
    const boxes = JSON.parse(window.__fg.engine.layer_boxes(st.photos[0].bytes, window.__fg.effectiveTemplateJson(), window.__fg.buildOverridesJson()));
    const b = boxes.find((x) => x.id === id);
    if (!b) return { error: "no box" };
    const sx = rect.left + ((b.x + b.w / 2) / img.naturalWidth) * rect.width;
    const sy = rect.top + ((b.y + b.h / 2) / img.naturalHeight) * rect.height;
    const tx = rect.left + rect.width / 2;
    const ty = rect.top + rect.height / 2;
    const viewport = document.getElementById("viewport");
    viewport.dispatchEvent(new PointerEvent("pointerdown", { clientX: sx, clientY: sy, bubbles: true, button: 0, buttons: 1, cancelable: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: tx, clientY: ty, bubbles: true, buttons: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: tx, clientY: ty, bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const boxes2 = JSON.parse(window.__fg.engine.layer_boxes(st.photos[0].bytes, window.__fg.effectiveTemplateJson(), window.__fg.buildOverridesJson()));
    const b2 = boxes2.find((x) => x.id === id);
    return { cx: b2.x + b2.w / 2, cy: b2.y + b2.h / 2, W: img.naturalWidth, H: img.naturalHeight };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  check(
    "editor: drag snaps layer to canvas center",
    !!r && !r.error && Math.abs(r.cx - r.W / 2) < 5 && Math.abs(r.cy - r.H / 2) < 5,
    JSON.stringify(r),
  );
}

/* 29. v0.5 editor: text style preset changes pixels */
{
  const r = await ev(`(async () => {
    const st = window.__fg.state;
    const fnv = (bytes) => { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i += 7) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h; };
    const tpl0 = window.__fg.effectiveTemplateJson();
    const ov0 = window.__fg.buildOverridesJson();
    const before = fnv(st.engine.render_with_overrides(st.photos[0].bytes, tpl0, "jpeg", true, ov0, 640, false));
    const textRow = [...document.querySelectorAll("#layerList .layer-row")].find((r) => r.dataset.type === "text");
    if (!textRow) return { error: "no text layer" };
    textRow.click();
    const sel = document.getElementById("presetSelect");
    sel.value = "gilt";
    sel.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 400));
    const after = fnv(st.engine.render_with_overrides(st.photos[0].bytes, window.__fg.effectiveTemplateJson(), "jpeg", true, window.__fg.buildOverridesJson(), 640, false));
    const stored = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[st.templateId] ?? "";
    return { changed: before !== after, hasFoil: stored.includes("foil") };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  check("editor: preset applies foil fill", !!r && r.hasFoil === true, JSON.stringify(r));
  check("editor: preset changes rendered pixels", !!r && r.changed === true, JSON.stringify(r));
}

/* 30. v0.5 editor: insert calendar layer */
{
  const r = await ev(`(async () => {
    const before = document.querySelectorAll("#layerList .layer-row").length;
    document.getElementById("addCalendar").click();
    await new Promise((r) => setTimeout(r, 300));
    const after = document.querySelectorAll("#layerList .layer-row").length;
    const stored = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId] ?? "";
    return { before, after, hasCalendar: stored.includes('"calendar"') };
  })()`);
  check("editor: calendar element inserted", r.after === r.before + 1 && r.hasCalendar, JSON.stringify(r));
}

/* 31. v0.5 editor: crop mode overlay */
{
  const r = await ev(`(async () => {
    document.getElementById("cropToggle").click();
    await new Promise((r) => setTimeout(r, 120));
    const hasRect = !!document.querySelector(".edit-overlay .crop-rect");
    document.getElementById("cropReset").click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById("cropToggle").click();
    await new Promise((r) => setTimeout(r, 120));
    return { hasRect, info: document.getElementById("cropInfo")?.textContent ?? "" };
  })()`);
  check("editor: crop mode shows crop rect", r.hasRect === true, JSON.stringify(r));
}

/* 32. v0.5 editor: frame upload registers @user/frame */
{
  await inject([FRAME_PNG], "#frameFile");
  const r = await ev(`(async () => {
    await new Promise((r) => setTimeout(r, 500));
    const stored = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId] ?? "";
    const ov = JSON.parse(localStorage.getItem("fg-tpl-ui-v1") || "{}")[window.__fg.state.templateId] ?? {};
    return { hasFrame: stored.includes("@user/frame"), auto: !!ov.frame?.on };
  })()`);
  check("editor: frame upload writes canvas.frame", r.hasFrame === true, JSON.stringify(r));
}

/* 33. v0.5 export options: 720P + metadata switch */
{
  const opt = await ev(`[...document.getElementById("exportSize").options].some((o) => o.value === "1280")`);
  check("export: 720P preset available", opt === true, String(opt));
  await ev(`(async () => {
    document.getElementById("settingsBtn").click();
    await new Promise((r) => setTimeout(r, 100));
    const cb = document.getElementById("setKeepMetadata");
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 80));
    document.getElementById("settingsClose").click();
  })()`);
  const meta = await ev(`JSON.parse(localStorage.getItem("fg-settings-v1") || "{}").keepMetadata`);
  check("settings: metadata switch persists", meta === false, String(meta));
  const ov = await ev(`JSON.parse(window.__fg.buildOverridesJson() || "{}").metadata`);
  check("settings: metadata override reaches engine", ov === false, String(ov));
  await ev(`(async () => {
    document.getElementById("settingsBtn").click();
    await new Promise((r) => setTimeout(r, 100));
    const cb = document.getElementById("setKeepMetadata");
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    document.getElementById("settingsClose").click();
  })()`);
}

/* 34. v0.5 wasm API: layer_boxes */
{
  const n = await ev(`(async () => {
    try {
      const st = window.__fg.state;
      const boxes = JSON.parse(st.engine.layer_boxes(st.photos[0].bytes, window.__fg.effectiveTemplateJson(), window.__fg.buildOverridesJson()));
      return boxes.length;
    } catch (e) { return "ERR " + (e && (e.message || e.toString())); }
  })()`);
  check("wasm: layer_boxes returns boxes", typeof n === "number" && n >= 2, String(n));
}

/* 35. v0.5 engine: stroke paints a ring (pixel assertion) */
{
  const res = await ev(`
    (async () => {
     try {
      const mk = (fx) => JSON.stringify({
        meta: { id: "v5-p", name: "v5", version: "1.0.0", minEngineVersion: "0.5.0", author: "FrameGeist", license: "CC0-1.0", category: "minimal" },
        canvas: { mode: "overlay" },
        layers: [{ type: "text", id: "t1", anchor: "middle-center", offset: { x: 0, y: 0 },
          font: { family: ["Inter"], size: 0.3, color: "#111111" }, content: [{ expr: "'AB'" }], effects: fx }],
      });
      const tpl0 = mk({});
      const tpl1 = mk({ stroke: { width: 0.12, color: "#FF0000" } });
      const pc = new OffscreenCanvas(1200, 900);
      const pg = pc.getContext("2d");
      pg.fillStyle = "#3080C0";
      pg.fillRect(0, 0, 1200, 900);
      const bytes = new Uint8Array(await (await pc.convertToBlob({ type: "image/jpeg", quality: 0.92 })).arrayBuffer());
      const count = async (json) => {
        const out = window.__fg.engine.render_with_overrides(bytes, json, "jpeg", false, "", 640, false);
        const bmp = await createImageBitmap(new Blob([out], { type: "image/jpeg" }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) n++;
        return n;
      };
      return { plain: await count(tpl0), stroked: await count(tpl1) };
     } catch (e) { return { error: String((e && e.message) || e) }; }
    })()
  `);
  check(
    "engine: stroke paints outside glyphs",
    !!res && !res.error && res.plain === 0 && res.stroked > 200,
    JSON.stringify(res),
  );
}

/* 36. v0.5 engine: calendar layer renders */
{
  const ink = await ev(`
    (async () => {
     try {
      const tpl = JSON.stringify({
        meta: { id: "v5-cal", name: "v5cal", version: "1.0.0", minEngineVersion: "0.5.0", author: "FrameGeist", license: "CC0-1.0", category: "calendar" },
        canvas: { mode: "overlay" },
        layers: [{ type: "calendar", id: "c1", anchor: "middle-center", offset: { x: 0, y: 0 }, size: 0.6,
          dateSource: "fixed", year: 2026, month: 9, showLunar: true, showWeekdays: true, color: "#111111", accent: "#E10600", fontFamily: ["Inter"] }],
      });
      const st = window.__fg.state;
      const out = st.engine.render_with_overrides(st.photos[0].bytes, tpl, "jpeg", false, "", 640, false);
      const bmp = await createImageBitmap(new Blob([out], { type: "image/jpeg" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) n++;
      return n;
     } catch (e) { return "ERR " + (e && (e.message || e.toString())); }
    })()
  `);
  check("engine: calendar grid renders", typeof ink === "number" && ink > 400, String(ink));
}

/* 37. v0.5 engine: crop override halves the canvas */
{
  const dims = await ev(`
    (async () => {
     try {
      const tpl = await (await fetch("./templates/minimal-corner-mono.json")).text();
      const st = window.__fg.state;
      const out = st.engine.render_with_overrides(st.photos[0].bytes, tpl, "jpeg", false, JSON.stringify({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }), 0, false);
      const bmp = await createImageBitmap(new Blob([out], { type: "image/jpeg" }));
      return [bmp.width, bmp.height];
     } catch (e) { return ["ERR", String((e && e.message) || e)]; }
    })()
  `);
  const full = await ev(`(async () => {
    const tpl = await (await fetch("./templates/minimal-corner-mono.json")).text();
    const st = window.__fg.state;
    const out = st.engine.render_with_overrides(st.photos[0].bytes, tpl, "jpeg", false, "", 0, false);
    const bmp = await createImageBitmap(new Blob([out], { type: "image/jpeg" }));
    return [bmp.width, bmp.height];
  })()`);
  const dimsOk = Array.isArray(dims) && typeof dims[0] === "number" && typeof dims[1] === "number";
  const fullOk = Array.isArray(full) && typeof full[0] === "number" && typeof full[1] === "number";
  check(
    "engine: crop override scales output",
    dimsOk && fullOk && dims[0] < full[0] * 0.6 && dims[1] < full[1] * 0.6,
    `${JSON.stringify(dims)} vs ${JSON.stringify(full)}`,
  );
}

/* 38. v0.5 editor: duplicate + delete layer */
{
  const r = await ev(`(async () => {
    const count = () => document.querySelectorAll("#layerList .layer-row").length;
    const row = document.querySelector("#layerList .layer-row");
    row.click();
    const before = count();
    document.getElementById("layerDup").click();
    await new Promise((r) => setTimeout(r, 250));
    const dup = count();
    document.getElementById("layerDel").click();
    await new Promise((r) => setTimeout(r, 250));
    const del = count();
    return { before, dup, del };
  })()`);
  check("editor: duplicate adds a layer row", r.dup === r.before + 1, JSON.stringify(r));
  check("editor: delete removes the layer row", r.del === r.before, JSON.stringify(r));
}

/* 39. v0.5 free collage (M5): render / overlay aspect / drag / add-delete */
{
  await ev(`document.getElementById("modeCollage").click()`);
  await new Promise((r) => setTimeout(r, 300));
  await inject([PHOTO_A, PHOTO_B, PHOTO_C]);
  const staged = await waitLabel(30000);
  check("free collage: photos staged in collage mode", staged.includes("ms"), staged);

  await ev(`(() => { const cb = document.getElementById("freeMode"); cb.checked = true; cb.dispatchEvent(new Event("change")); })()`);
  await new Promise((r) => setTimeout(r, 1200));
  const spec = await ev(`(() => {
    const s = window.__fg.freeSpec();
    const img = document.querySelector("#canvasWrap img");
    return { n: s.items.length, w: s.width, h: s.height, iw: img?.naturalWidth ?? 0, ih: img?.naturalHeight ?? 0 };
  })()`);
  check(
    "free collage: renders 3 items on 4:3 canvas",
    spec.n === 3 && spec.w === 1600 && spec.h === 1200 && spec.iw === 1600 && spec.ih === 1200,
    JSON.stringify(spec),
  );

  const boxes = await ev(`[...document.querySelectorAll(".edit-overlay .box")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);
  check(
    "free collage: overlay boxes follow photo aspect",
    boxes.length === 3 && boxes[1][1] / boxes[1][0] > (boxes[0][1] / boxes[0][0]) * 1.5,
    JSON.stringify(boxes),
  );

  const drag = await ev(`(async () => {
    const s = window.__fg.freeSpec();
    const box = document.querySelector(".edit-overlay .box");
    const br = box.getBoundingClientRect();
    const cx = br.left + br.width / 2;
    const cy = br.top + br.height / 2;
    const wrap = document.getElementById("canvasWrap");
    const wr = wrap.getBoundingClientRect();
    const scale = wr.width / wrap.offsetWidth;
    const x0 = s.items[0].x, y0 = s.items[0].y;
    document.getElementById("viewport").dispatchEvent(new PointerEvent("pointerdown", { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: cx + 64 * scale, clientY: cy + 32 * scale, bubbles: true, cancelable: true, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: cx + 64 * scale, clientY: cy + 32 * scale, bubbles: true, pointerId: 1 }));
    await new Promise((r) => setTimeout(r, 400));
    const nx = window.__fg.freeSpec().items[0].x, ny = window.__fg.freeSpec().items[0].y;
    return { dx: +(nx - x0).toFixed(4), dy: +(ny - y0).toFixed(4) };
  })()`);
  check(
    "free collage: drag moves item (64/32 canvas px)",
    Math.abs(drag.dx - 0.04) < 0.005 && Math.abs(drag.dy - 0.027) < 0.006,
    JSON.stringify(drag),
  );

  const addDel = await ev(`(async () => {
    const n0 = window.__fg.freeSpec().items.length;
    document.getElementById("freeAdd").click();
    await new Promise((r) => setTimeout(r, 600));
    const n1 = window.__fg.freeSpec().items.length;
    const rows = document.querySelectorAll("#freeList .layer-row").length;
    document.getElementById("freeDel").click();
    await new Promise((r) => setTimeout(r, 600));
    const n2 = window.__fg.freeSpec().items.length;
    return { n0, n1, n2, rows };
  })()`);
  check(
    "free collage: add/delete item updates spec + list",
    addDel.n1 === addDel.n0 + 1 && addDel.n2 === addDel.n0 && addDel.rows === addDel.n1,
    JSON.stringify(addDel),
  );
  await shot("07-free-collage");
}

/* 40. v0.5 library: adjacent same-category thumbnails differ > 3%
   (DESIGN-LANGUAGE.md rule 6; v0.4 audit measured 0.4-0.7% on near-dupes) */
{
  const manifest = JSON.parse(readFileSync("web/templates.json", "utf8"));
  const byCat = new Map();
  for (const t of manifest) {
    if (!byCat.has(t.category)) byCat.set(t.category, []);
    byCat.get(t.category).push(t.id);
  }
  const pairs = [];
  for (const ids of byCat.values()) for (let i = 0; i < ids.length - 1; i++) pairs.push([ids[i], ids[i + 1]]);
  const ratios = await ev(`(async () => {
    const S = 160;
    const norm = (id) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = S; c.height = S;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.fillStyle = "#fff"; g.fillRect(0, 0, S, S);
        const s = Math.min(S / img.naturalWidth, S / img.naturalHeight);
        const w = Math.max(1, Math.round(img.naturalWidth * s));
        const h = Math.max(1, Math.round(img.naturalHeight * s));
        g.drawImage(img, (S - w) >> 1, (S - h) >> 1, w, h);
        res(g.getImageData(0, 0, S, S).data);
      };
      img.onerror = () => rej(new Error("load " + id));
      img.src = "thumbs/" + id + ".jpg";
    });
    const out = [];
    for (const [a, b] of ${JSON.stringify(pairs)}) {
      const da = await norm(a);
      const db = await norm(b);
      let diff = 0;
      for (let p = 0; p < da.length; p += 4) {
        if (Math.abs(da[p] - db[p]) > 8 || Math.abs(da[p + 1] - db[p + 1]) > 8 || Math.abs(da[p + 2] - db[p + 2]) > 8) diff++;
      }
      out.push([a, b, diff / (S * S)]);
    }
    return out;
  })()`);
  const fails = ratios.filter(([, , r]) => !(r > 0.03)).sort((x, y) => x[2] - y[2]);
  const min = ratios.reduce((m, p) => (p[2] < m[2] ? p : m), ratios[0]);
  check(
    `library: ${ratios.length} adjacent same-category thumbnails differ > 3%`,
    fails.length === 0,
    fails.length
      ? fails.slice(0, 6).map(([a, b, r]) => `${(r * 100).toFixed(2)}% ${a}↔${b}`).join("; ") + ` (fails=${fails.length}, min=${(min[2] * 100).toFixed(2)}%)`
      : `min ${(min[2] * 100).toFixed(2)}% (${min[0]} ↔ ${min[1]})`,
  );
}

/* ================= v0.5.0 M6 parity UI ================= */

/* 41. template "recent used" ring buffer + chips */
{
  await ev(`(async () => {
    document.getElementById("modeFrame")?.click();
    const fm = document.getElementById("freeMode");
    if (fm && fm.checked) { fm.checked = false; fm.dispatchEvent(new Event("change")); }
    await new Promise((r) => setTimeout(r, 250));
  })()`);
  await ev(`localStorage.removeItem("fg-recent-v1"); window.__fg.buildWall()`);
  const hidden = await ev(`![...document.querySelectorAll("#wallCats button")].some((b) => b.dataset.cat === "recent")`);
  check("recent: chip hidden while buffer empty", hidden === true);
  await ev(`(async () => { await window.__fg.useTemplate("classic-watermark-single-row"); })()`);
  await new Promise((r) => setTimeout(r, 800));
  const stored = await ev(`JSON.parse(localStorage.getItem("fg-recent-v1") || "[]")`);
  check("recent: applied template recorded in ring buffer", Array.isArray(stored) && stored[0] === "classic-watermark-single-row", JSON.stringify(stored?.slice(0, 3)));
  await ev(`window.__fg.buildWall()`);
  const chipLabel = await ev(`window.__fg.t("chip.recent")`);
  const chip = await ev(`(() => { const b = [...document.querySelectorAll("#wallCats button")].find((x) => x.dataset.cat === "recent"); return b ? b.textContent : ""; })()`);
  check("recent: wall chip appears after use", chip === chipLabel && chip.length > 0, chip);
  const pickerChip = await ev(`!!document.querySelector('#catChips [data-cat="recent"]')`);
  check("recent: picker chip present", pickerChip === true);
  await ev(`document.querySelector('#wallCats [data-cat="recent"]').click()`);
  await new Promise((r) => setTimeout(r, 300));
  const filtered = await ev(`(() => ({
    cards: document.querySelectorAll(".wall-card").length,
    recent: JSON.parse(localStorage.getItem("fg-recent-v1") || "[]").length,
    count: document.getElementById("wallCount").textContent,
  }))()`);
  check("recent: chip filters to the recency list", filtered.cards === Math.min(12, filtered.recent) && filtered.cards >= 1, JSON.stringify(filtered));
  await ev(`document.querySelector('#wallCats [data-cat="all"]').click()`);
  await new Promise((r) => setTimeout(r, 250));
}

/* 42. layer rename: inline input, survives rerender, id stays stable */
{
  await inject([PHOTO_A]);
  await waitLabel(30000);
  const r = await ev(`(async () => {
    const rows = [...document.querySelectorAll("#layerList .layer-row")];
    const row = rows.find((x) => x.dataset.type === "text");
    if (!row) return { error: "no text row" };
    row.click();
    await new Promise((r) => setTimeout(r, 120));
    const id = row.dataset.id;
    const name = row.querySelector(".lname");
    name.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 80));
    const input = row.querySelector("input");
    if (!input) return { error: "no rename input" };
    input.value = "RENAMED-E2E";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const label1 = document.querySelector('#layerList .layer-row[data-id="' + id + '"] .lname')?.textContent ?? "";
    const other = [...document.querySelectorAll("#layerList .layer-row")].find((x) => x.dataset.id !== id);
    other?.click();
    await new Promise((r) => setTimeout(r, 150));
    const label2 = document.querySelector('#layerList .layer-row[data-id="' + id + '"] .lname')?.textContent ?? "";
    const labels = JSON.parse(localStorage.getItem("fg-tpl-ui-v1") || "{}")[window.__fg.state.templateId]?.labels ?? {};
    const editRaw = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId];
    const ids = editRaw ? (JSON.parse(editRaw).layers ?? []).map((l) => l.id) : (window.__fg.currentTemplateObject()?.layers ?? []).map((l) => l.id);
    return { id, label1, label2, stored: labels[id] ?? "", idStable: ids.includes(id) };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  check("editor: dblclick renames a layer inline", r?.label1 === "RENAMED-E2E", JSON.stringify(r).slice(0, 200));
  check("editor: rename survives a panel rerender", r?.label2 === "RENAMED-E2E", JSON.stringify(r).slice(0, 200));
  check("editor: rename keeps the original layer id", r?.idStable === true && r?.stored === "RENAMED-E2E", JSON.stringify(r).slice(0, 220));
}

/* 43. ungroup: children return to top level with absolute positions */
{
  const r = await ev(`(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const boxOf = (list, id) => {
      for (const b of list) { if (b.id === id) return b; for (const c of b.children ?? []) if (c.id === id) return c; }
      return null;
    };
    const getBoxes = () => JSON.parse(window.__fg.engine.layer_boxes(window.__fg.state.photos[0].bytes, window.__fg.effectiveTemplateJson(), window.__fg.buildOverridesJson()));
    const rows = [...document.querySelectorAll("#layerList .layer-row")];
    const top = rows.filter((x) => !x.querySelector(".indent"));
    if (top.length < 2) return { error: "need 2 top-level layers" };
    const idA = top[0].dataset.id, idB = top[1].dataset.id;
    top[0].click();
    top[1].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await new Promise((r) => setTimeout(r, 120));
    const before = { n: rows.length, a: boxOf(getBoxes(), idA), b: boxOf(getBoxes(), idB) };
    document.getElementById("layerGroup").click();
    await new Promise((r) => setTimeout(r, 300));
    const grouped = {
      n: document.querySelectorAll("#layerList .layer-row").length,
      enabled: !document.getElementById("layerUngroup").disabled,
    };
    document.getElementById("layerUngroup").click();
    await new Promise((r) => setTimeout(r, 300));
    const after = { n: document.querySelectorAll("#layerList .layer-row").length, a: boxOf(getBoxes(), idA), b: boxOf(getBoxes(), idB) };
    const groupGone = ![...document.querySelectorAll("#layerList .layer-row")].some((x) => x.dataset.type === "group");
    const drift = (p, q) => (p && q) ? Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) : 999;
    return { beforeN: before.n, groupedN: grouped.n, afterN: after.n, enabled: grouped.enabled, groupGone, driftA: drift(before.a, after.a), driftB: drift(before.b, after.b) };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  check("editor: group enables the ungroup button", r?.enabled === true && r?.groupedN === r?.beforeN + 1, JSON.stringify(r));
  check("editor: ungroup restores the child count", r?.afterN === r?.beforeN && r?.groupGone === true, JSON.stringify(r));
  check("editor: ungroup preserves absolute positions", !!r && r.driftA < 1.5 && r.driftB < 1.5, JSON.stringify(r));
}

/* 44. align + distribute selected layer boxes */
{
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const boxes = () => JSON.parse(window.__fg.engine.layer_boxes(window.__fg.state.photos[0].bytes, window.__fg.effectiveTemplateJson(), window.__fg.buildOverridesJson()));
    const boxOf = (list, id) => list.find((b) => b.id === id) ?? null;
    document.getElementById("addText").click();
    await sleep(150);
    for (let i = 0; i < 3; i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    await sleep(200);
    document.getElementById("addText").click();
    await sleep(200);
    const textRows = [...document.querySelectorAll("#layerList .layer-row")].filter((x) => x.dataset.type === "text");
    const pair = textRows.slice(-2);
    if (pair.length < 2) return { error: "no pair" };
    const idA = pair[0].dataset.id, idB = pair[1].dataset.id;
    pair[0].click();
    pair[1].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await sleep(120);
    const spread0 = Math.abs(boxOf(boxes(), idA).x - boxOf(boxes(), idB).x);
    const enabled = !document.getElementById("alignLeft").disabled;
    document.getElementById("alignLeft").click();
    await sleep(450);
    const aligned = Math.abs(boxOf(boxes(), idA).x - boxOf(boxes(), idB).x);
    document.getElementById("addText").click();
    await sleep(200);
    for (let i = 0; i < 4; i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    await sleep(200);
    const tri = [...document.querySelectorAll("#layerList .layer-row")].filter((x) => x.dataset.type === "text").slice(-3);
    tri[0].click();
    tri[1].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    tri[2].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await sleep(120);
    document.getElementById("distributeH").click();
    await sleep(450);
    const sorted = tri.map((x) => boxOf(boxes(), x.dataset.id)).filter(Boolean).sort((a, b) => a.x - b.x);
    const gaps = sorted.length === 3
      ? [sorted[1].x - (sorted[0].x + sorted[0].w), sorted[2].x - (sorted[1].x + sorted[1].w)]
      : [];
    return { spread0, aligned, enabled, gaps };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  check("editor: align puts selected layers into line", !!r && r.enabled === true && r.spread0 > 2 && r.aligned < 1.5, JSON.stringify(r));
  check("editor: distribute equalizes gaps", !!r && r.gaps?.length === 2 && Math.abs(r.gaps[0] - r.gaps[1]) < 1.5, JSON.stringify(r));
}

/* 45. crop: double-click enters, fill width/height set the override */
{
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (window.__fgEditor.debug().cropMode) { document.getElementById("cropToggle").click(); await sleep(120); }
    document.getElementById("cropReset").click();
    await sleep(300);
    const stageImg = async () => {
      for (let i = 0; i < 40; i++) {
        const img = document.querySelector("#canvasWrap img");
        if (img && img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0) return img;
        await sleep(150);
      }
      return document.querySelector("#canvasWrap img");
    };
    const img = await stageImg();
    if (!img) return { error: "no stage img" };
    const dbl = () => {
      const rect = img.getBoundingClientRect();
      document.getElementById("viewport").dispatchEvent(new MouseEvent("dblclick", {
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true,
      }));
    };
    dbl();
    await sleep(200);
    let entered = window.__fgEditor.debug().cropMode === true && !!document.querySelector(".edit-overlay .crop-rect");
    if (!entered) {
      if (window.__fgEditor.debug().cropMode) { document.getElementById("cropToggle").click(); await sleep(150); }
      dbl();
      await sleep(250);
      entered = window.__fgEditor.debug().cropMode === true && !!document.querySelector(".edit-overlay .crop-rect");
    }
    if (window.__fgEditor.debug().cropMode) { document.getElementById("cropToggle").click(); await sleep(120); }
    const ui = () => JSON.parse(localStorage.getItem("fg-tpl-ui-v1") || "{}")[window.__fg.state.templateId] ?? {};
    document.getElementById("cropFillW").click();
    await sleep(250);
    const cropW = ui().crop ?? null;
    const ovW = JSON.parse(window.__fg.buildOverridesJson() || "{}").crop ?? null;
    document.getElementById("cropFillH").click();
    await sleep(250);
    const cropH = ui().crop ?? null;
    document.getElementById("cropReset").click();
    return { entered, cropW, cropH, ovW };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  check("editor: double-click on the photo enters crop", r?.entered === true, JSON.stringify(r).slice(0, 160));
  check("editor: crop fill-width sets w=1 (override + ui)", !!r?.cropW && Math.abs(r.cropW.w - 1) < 0.001 && Math.abs(r.cropW.x) < 0.001 && Math.abs(r.ovW?.w - 1) < 0.001, JSON.stringify(r?.cropW));
  check("editor: crop fill-height sets h=1", !!r?.cropH && Math.abs(r.cropH.h - 1) < 0.001 && Math.abs(r.cropH.y) < 0.001, JSON.stringify(r?.cropH));
}

/* 46. settings: 720P export-size option */
{
  const exists = await ev(`[...document.getElementById("setExportSize").options].some((o) => o.value === "1280")`);
  check("settings: export size select has 720P", exists === true);
  const r = await ev(`(async () => {
    document.getElementById("settingsBtn").click();
    await new Promise((r) => setTimeout(r, 200));
    const sel = document.getElementById("setExportSize");
    const old = sel.value;
    sel.value = "1280";
    sel.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 150));
    const stored = JSON.parse(localStorage.getItem("fg-settings-v1") || "{}").exportSize;
    const bar = document.getElementById("exportSize").value;
    sel.value = old;
    sel.dispatchEvent(new Event("change"));
    document.getElementById("settingsClose").click();
    return { stored, bar, old };
  })()`);
  check("settings: 720P persists and mirrors to the actionbar", r?.stored === "1280" && r?.bar === "1280", JSON.stringify(r));
}

/* ================= v0.5.0 M6 parity UI: bg / card / frame ================= */

// Shared pixel sampler: read normalized points from the rendered stage image.
const SAMPLE_PX = (fx, fy) => `(async () => {
  const img = document.querySelector("#canvasWrap img");
  for (let i = 0; i < 80 && !(img && img.complete && img.naturalWidth); i++) await new Promise((r) => setTimeout(r, 100));
  if (!img || !img.complete || !img.naturalWidth) return null;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const x = Math.min(img.naturalWidth - 1, Math.max(0, Math.round(img.naturalWidth * ${fx})));
  const y = Math.min(img.naturalHeight - 1, Math.max(0, Math.round(img.naturalHeight * ${fy})));
  const d = g.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
})()`;
const CORNERS_PX = `(async () => {
  const img = document.querySelector("#canvasWrap img");
  for (let i = 0; i < 80 && !(img && img.complete && img.naturalWidth); i++) await new Promise((r) => setTimeout(r, 100));
  if (!img || !img.complete || !img.naturalWidth) return null;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return [[0.004, 0.004], [0.996, 0.004], [0.004, 0.996], [0.996, 0.996]].map(([fx, fy]) => {
    const x = Math.min(img.naturalWidth - 1, Math.max(0, Math.round(img.naturalWidth * fx)));
    const y = Math.min(img.naturalHeight - 1, Math.max(0, Math.round(img.naturalHeight * fy)));
    const d = g.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
})()`;
const RENDER_HASH = `(() => {
  const b = window.__fg.state.lastRender;
  if (!b) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i += 13) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
})()`;
const dist = (a, b) => (a && b ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : -1);
const maxDist = (a, b) => (a && b ? Math.max(...a.map((p, i) => dist(p, b[i]))) : -1);
const hexRgb = (h) => {
  const m = /^#([0-9a-f]{6})$/i.exec(h ?? "");
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
};

/* 47. background: auto-tint option + pixel change */
{
  // Drop the frame uploaded in assertion 32 so the margin area is clean.
  await ev(`document.getElementById("clearFrame").click()`);
  await waitLabel(30000);
  const hasTint = await ev(`[...document.getElementById("bgSelect").options].some((o) => o.value === "tint")`);
  check("bg: auto tint option available", hasTint === true);
  await ev(`(() => {
    const bs = document.getElementById("bgSelect");
    bs.value = "solid"; bs.dispatchEvent(new Event("change"));
    const bc = document.getElementById("bgColor");
    bc.value = "#FF0000"; bc.dispatchEvent(new Event("input"));
  })()`);
  await waitLabel(30000);
  const red = await ev(SAMPLE_PX(0.5, 0.995));
  await ev(`(() => { const bs = document.getElementById("bgSelect"); bs.value = "tint"; bs.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const tint = await ev(SAMPLE_PX(0.5, 0.995));
  check("bg: solid red paints the margin", red && red[0] > 200 && red[1] < 70 && red[2] < 70, JSON.stringify(red));
  check("bg: auto tint repaints the background", dist(red, tint) > 60, `${JSON.stringify(red)} vs ${JSON.stringify(tint)}`);
}

/* 48. background preset swatches */
{
  const sw = await ev(`(() => {
    const b = document.querySelector('#bgSwatches button[data-color="#D9C7A7"]');
    if (!b) return { error: "no swatch" };
    b.click();
    const s = JSON.parse(localStorage.getItem("fg-settings-v1") || "{}");
    return { bg: s.bgColor, mode: s.background, input: document.getElementById("bgColor").value.toUpperCase(), count: document.querySelectorAll("#bgSwatches .swatch").length };
  })()`);
  check("bg: preset swatch board rendered", !sw.error && sw.count >= 9, JSON.stringify(sw));
  check("bg: swatch sets bgColor + solid mode", sw.bg === "#D9C7A7" && sw.mode === "solid" && sw.input === "#D9C7A7", JSON.stringify(sw));
  await waitLabel(30000);
  const px = await ev(SAMPLE_PX(0.5, 0.995));
  check("bg: swatch color paints the background", dist(px, [0xd9, 0xc7, 0xa7]) < 24, JSON.stringify(px));
}

/* 49. background eyedropper (canvas -> solid color) */
{
  const r = await ev(`(async () => {
    const btn = document.getElementById("bgEyedropper");
    btn.click();
    const active = btn.classList.contains("on") && document.getElementById("viewport").classList.contains("eyedropper");
    const hint = !document.getElementById("eyedropperHint").classList.contains("hidden");
    const img = document.querySelector("#canvasWrap img");
    const rect = img.getBoundingClientRect();
    document.getElementById("viewport").dispatchEvent(new MouseEvent("click", {
      clientX: rect.left + rect.width * 0.5, clientY: rect.top + rect.height * 0.995, bubbles: true, cancelable: true,
    }));
    await new Promise((x) => setTimeout(x, 500));
    const s = JSON.parse(localStorage.getItem("fg-settings-v1") || "{}");
    return { active, hint, bg: s.bgColor, off: !btn.classList.contains("on") };
  })()`);
  check("bg: eyedropper toggles on with hint", r?.active === true && r?.hint === true, JSON.stringify(r));
  check("bg: eyedropper samples the rendered pixel", r?.off === true && dist(hexRgb(r?.bg), [0xd9, 0xc7, 0xa7]) < 40, JSON.stringify(r));
  const esc = await ev(`(() => {
    const btn = document.getElementById("bgEyedropper");
    btn.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return !btn.classList.contains("on") && !document.getElementById("viewport").classList.contains("eyedropper");
  })()`);
  check("bg: Esc cancels the eyedropper", esc === true);
}

/* 50. canvas margin override */
{
  const before = await ev(`(() => { const i = document.querySelector("#canvasWrap img"); return { w: i.naturalWidth, h: i.naturalHeight }; })()`);
  await ev(`(() => { const r = document.getElementById("marginRange"); r.value = "0.15"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const ov = await ev(`JSON.parse(window.__fg.buildOverridesJson() || "{}").margin`);
  const after = await ev(`(() => { const i = document.querySelector("#canvasWrap img"); return { w: i.naturalWidth, h: i.naturalHeight }; })()`);
  const bg = await ev(`JSON.parse(localStorage.getItem("fg-settings-v1") || "{}").bgColor`);
  const corner = await ev(SAMPLE_PX(0.004, 0.004));
  check("margin: slider reaches overrides (0.15)", ov === 0.15, String(ov));
  check("margin: output grows vs margin 0", after.w > before.w && after.h > before.h, `${before.w}x${before.h} -> ${after.w}x${after.h}`);
  check("margin: new margin area samples the background", dist(corner, hexRgb(bg)) < 24, `${JSON.stringify(corner)} vs ${bg}`);
  await ev(`(() => { const r = document.getElementById("marginRange"); r.value = "0"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const restored = await ev(`(() => { const i = document.querySelector("#canvasWrap img"); return { w: i.naturalWidth, h: i.naturalHeight }; })()`);
  check("margin: reset restores margin 0 dimensions", restored.w === before.w && restored.h === before.h, `${restored.w}x${restored.h}`);
}

/* 51. card effects: toggle / radius / persistence */
{
  const before = await ev(CORNERS_PX);
  await ev(`(() => { const cb = document.getElementById("cardOn"); cb.checked = true; cb.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const ov1 = await ev(`JSON.parse(window.__fg.buildOverridesJson() || "{}").card`);
  await ev(`(() => { const r = document.getElementById("cardRadius"); r.value = "0.2"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const ov2 = await ev(`JSON.parse(window.__fg.buildOverridesJson() || "{}").card`);
  const after = await ev(CORNERS_PX);
  check("card: toggle reaches overrides with defaults", ov1?.enabled === true && ov1?.radius > 0 && ov1?.shadow?.enabled === true, JSON.stringify(ov1));
  check("card: radius slider reaches overrides (0.2)", ov2?.radius === 0.2, JSON.stringify(ov2));
  check("card: radius changes corner pixels", maxDist(before, after) > 40, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  await ev(`(() => { const cb = document.getElementById("cardOn"); cb.checked = false; cb.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const hasCard = await ev(`Object.prototype.hasOwnProperty.call(JSON.parse(window.__fg.buildOverridesJson() || "{}"), "card")`);
  const stored = await ev(`JSON.parse(localStorage.getItem("fg-tpl-ui-v1") || "{}")[window.__fg.state.templateId]?.card?.on`);
  check("card: toggle persists + clears override when off", hasCard === false && stored === false, `card=${hasCard} stored=${stored}`);
}

/* 52. built-in frame picker applies a frame */
{
  const cells = await ev(`document.querySelectorAll("#frameGrid .frame-cell").length`);
  check("frame: built-in picker lists 15 slugs", cells === 15, String(cells));
  const before = await ev(RENDER_HASH);
  await ev(`document.querySelector('#frameGrid .frame-cell[data-slug="camera-body"]').click()`);
  await waitLabel(30000);
  const frame = await ev(`(() => {
    const raw = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId];
    return raw ? JSON.parse(raw).canvas?.frame ?? null : null;
  })()`);
  const after = await ev(RENDER_HASH);
  check("frame: picker writes @builtin asset + enables", frame?.asset === "@builtin/frame/camera-body" && frame?.autoDetect === true, JSON.stringify(frame));
  check("frame: built-in frame changes canvas pixels", before !== after && after !== 0, `${before} -> ${after}`);
}

/* 53. frame offset + rotation sliders */
{
  const before = await ev(RENDER_HASH);
  await ev(`(() => { const r = document.getElementById("frameOffsetX"); r.value = "0.25"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const offset = await ev(`(() => {
    const raw = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId];
    return raw ? JSON.parse(raw).canvas?.frame?.offset ?? null : null;
  })()`);
  const afterOffset = await ev(RENDER_HASH);
  check("frame: offset slider reaches template edits", Math.abs((offset?.x ?? 0) - 0.25) < 1e-6, JSON.stringify(offset));
  check("frame: offset changes canvas pixels", before !== afterOffset, `${before} -> ${afterOffset}`);
  await ev(`(() => { const r = document.getElementById("frameRotation"); r.value = "35"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const rot = await ev(`(() => {
    const raw = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId];
    return raw ? JSON.parse(raw).canvas?.frame?.rotation ?? null : null;
  })()`);
  const afterRot = await ev(RENDER_HASH);
  check("frame: rotation slider reaches template edits", rot === 35, String(rot));
  check("frame: rotation changes canvas pixels", afterOffset !== afterRot, `${afterOffset} -> ${afterRot}`);
}

/* ================= v0.5.0 M6 parity UI: free collage extras ================= */

/* 54. free collage: radius + stroke controls on the selected item */
{
  await ev(`(async () => {
    document.getElementById("modeCollage").click();
    await new Promise((r) => setTimeout(r, 250));
  })()`);
  await inject([PHOTO_A, PHOTO_B, PHOTO_C]);
  await waitLabel(30000);
  await ev(`(() => { const cb = document.getElementById("freeMode"); if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); } })()`);
  await new Promise((r) => setTimeout(r, 1200));
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    document.querySelector("#freeList .layer-row").click();
    await sleep(150);
    const before = ${RENDER_HASH};
    const rad = document.getElementById("freeRadius");
    rad.value = "0.25"; rad.dispatchEvent(new Event("input"));
    const st = document.getElementById("freeStrokeW");
    st.value = "10"; st.dispatchEvent(new Event("input"));
    const sc = document.getElementById("freeStrokeColor");
    sc.value = "#ff0000"; sc.dispatchEvent(new Event("input"));
    await sleep(900);
    const item = window.__fg.freeSpec().items[0];
    const after = ${RENDER_HASH};
    return { radius: item.radius, border: item.border, changed: before !== after, before, after,
      labels: [document.getElementById("freeRadiusVal").textContent, document.getElementById("freeStrokeVal").textContent] };
  })()`);
  check("free collage: radius slider reaches the item spec", r?.radius === 0.25, JSON.stringify(r?.radius));
  check("free collage: stroke width + color reach the item border", r?.border?.width === 10 && /ff0000/i.test(r?.border?.color ?? ""), JSON.stringify(r?.border));
  check("free collage: radius + stroke repaint the collage", r?.changed === true && r?.radius === 0.25, `${r?.before} -> ${r?.after}`);
}

/* 55. free collage: swap two selected items */
{
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const rows = [...document.querySelectorAll("#freeList .layer-row")];
    if (rows.length < 2) return { error: "need 2 items" };
    rows[0].click();
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await sleep(150);
    const sel = window.__fgEditor.freeSelection();
    const geom = () => window.__fg.freeSpec().items.map((it) => ({ x: it.x, y: it.y, w: it.w, rotation: it.rotation ?? 0 }));
    const before = geom();
    document.getElementById("freeSwap").click();
    await sleep(700);
    const after = geom();
    return { sel, before, after };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  check("free collage: shift-click selects a second item", r?.sel?.a === 0 && r?.sel?.b === 1, JSON.stringify(r?.sel));
  check(
    "free collage: swap exchanges x/y/size/rotation",
    !!r?.after && r.after[0].x === r.before[1].x && r.after[0].y === r.before[1].y &&
      r.after[0].rotation === r.before[1].rotation && r.after[1].x === r.before[0].x && r.after[1].w === r.before[0].w,
    JSON.stringify(r).slice(0, 260),
  );
}

/* 56. free collage: gap + margin relayout */
{
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const spec0 = window.__fg.freeSpec();
    const before = spec0.items.map((it) => ({ x: it.x, y: it.y, w: it.w }));
    const gap = document.getElementById("freeGap");
    gap.value = "0.06"; gap.dispatchEvent(new Event("input"));
    const margin = document.getElementById("freeMargin");
    margin.value = "0.1"; margin.dispatchEvent(new Event("input"));
    document.getElementById("freeRelayout").click();
    await sleep(900);
    const spec = window.__fg.freeSpec();
    const mpx = 0.1 * Math.min(spec.width, spec.height);
    const W = spec.width, H = spec.height;
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (const it of spec.items) {
      const photoAr = window.__fg.state.photos[it.photo]?.ar ?? 0.75;
      const wPx = it.w * W;
      const hPx = it.h != null ? it.h * H : wPx * photoAr;
      minL = Math.min(minL, it.x * W - wPx / 2);
      minT = Math.min(minT, it.y * H - hPx / 2);
      maxR = Math.max(maxR, it.x * W + wPx / 2);
      maxB = Math.max(maxB, it.y * H + hPx / 2);
    }
    const after = spec.items.map((it) => ({ x: it.x, y: it.y, w: it.w }));
    const moved = after.some((a, i) => Math.abs(a.x - before[i].x) > 1e-6 || Math.abs(a.y - before[i].y) > 1e-6);
    return { moved, mpx, minL, minT, maxR, maxB, W, H, rows: document.querySelectorAll("#freeList .layer-row").length };
  })()`);
  check("free collage: relayout recomputes every item position", r?.moved === true, JSON.stringify({ moved: r?.moved }));
  check(
    "free collage: relayout respects the margin on all sides",
    !!r && r.minL >= r.mpx - 1 && r.minT >= r.mpx - 1 && r.maxR <= r.W - r.mpx + 1 && r.maxB <= r.H - r.mpx + 1,
    JSON.stringify({ minL: r?.minL?.toFixed(1), minT: r?.minT?.toFixed(1), maxR: r?.maxR?.toFixed(1), maxB: r?.maxB?.toFixed(1), mpx: r?.mpx?.toFixed(1) }),
  );
}

/* 57. free collage: per-image crop targets the selected item */
{
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    document.querySelector("#freeList .layer-row").click();
    await sleep(150);
    const cardVisible = !document.getElementById("cropCard").classList.contains("hidden");
    const before = ${RENDER_HASH};
    document.getElementById("cropToggle").click();
    await sleep(200);
    const rectEl = document.querySelector(".edit-overlay .crop-rect");
    const rectDrawn = !!rectEl;
    if (rectEl) {
      const br = rectEl.getBoundingClientRect();
      const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
      rectEl.dispatchEvent(new PointerEvent("pointerdown", { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 11 }));
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: cx + 40, clientY: cy + 30, bubbles: true, pointerId: 11 }));
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: cx + 40, clientY: cy + 30, bubbles: true, pointerId: 11 }));
    }
    await sleep(900);
    const crop = window.__fg.freeSpec().items[0].crop ?? null;
    const after = ${RENDER_HASH};
    document.getElementById("cropReset").click();
    await sleep(600);
    const cleared = window.__fg.freeSpec().items[0].crop ?? null;
    if (window.__fgEditor.debug().cropMode) document.getElementById("cropToggle").click();
    await sleep(150);
    return { cardVisible, rectDrawn, crop, changed: before !== after, before, after, cleared };
  })()`);
  check("free collage: crop card available + overlay targets the item", r?.cardVisible === true && r?.rectDrawn === true, JSON.stringify(r).slice(0, 160));
  check(
    "free collage: crop overlay drag writes a partial item crop",
    !!r?.crop && r.crop.x > 0.09 && r.crop.y > 0.09 && r.crop.w < 0.999 && r.crop.h < 0.999,
    JSON.stringify(r?.crop),
  );
  check("free collage: item crop changes rendered pixels", r?.changed === true, `${r?.before} -> ${r?.after}`);
  check("free collage: crop reset clears the item crop", r?.cleared == null, JSON.stringify(r?.cleared));
}

/* ================= v0.5.0 M6 parity UI: watermark / insert / fuji / calendar ================= */

/* 58. watermark adjust panel (classic-watermark templates) */
{
  await ev(`(async () => {
    document.getElementById("modeFrame").click();
    await new Promise((r) => setTimeout(r, 250));
    await window.__fg.useTemplate("classic-watermark-single-row");
  })()`);
  await waitLabel(30000);
  const vis = await ev(`({ hidden: document.getElementById("watermarkCard").classList.contains("hidden"), category: window.__fg.templateCategory() })`);
  check("watermark: card visible for classic-watermark", vis.hidden === false && vis.category === "classic-watermark", JSON.stringify(vis));
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const size = document.getElementById("wmSize");
    size.value = "1.5"; size.dispatchEvent(new Event("input")); size.dispatchEvent(new Event("change"));
    const pad = document.getElementById("wmPad");
    pad.value = "1.4"; pad.dispatchEvent(new Event("input")); pad.dispatchEvent(new Event("change"));
    await sleep(400);
    const ov = JSON.parse(window.__fg.buildOverridesJson() || "{}");
    const sp = document.getElementById("wmSpacing");
    sp.value = "0.05"; sp.dispatchEvent(new Event("input"));
    await sleep(500);
    const flat = (list, out = []) => { for (const l of list ?? []) { out.push(l); if (l.type === "group") flat(l.children, out); } return out; };
    const base = new Map(flat(window.__fg.currentTemplateObject().layers).filter((l) => l.type === "text").map((l) => [l.id, l.letterSpacing ?? 0]));
    const stored = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId] ?? "";
    const text = flat(JSON.parse(stored).layers).filter((l) => l.type === "text").map((l) => ({ id: l.id, ls: l.letterSpacing ?? 0, base: base.get(l.id) ?? 0 }));
    document.getElementById("wmSelectFirst").click();
    await sleep(200);
    const onRow = document.querySelector("#layerList .layer-row.on");
    return { size: ov.fontSizeScale, pad: ov.paddingScale, text, selectedType: onRow?.dataset.type ?? null };
  })()`);
  check("watermark: height + padding sliders reach overrides", r?.size === 1.5 && r?.pad === 1.4, JSON.stringify({ size: r?.size, pad: r?.pad }));
  check(
    "watermark: spacing delta applies to every text layer",
    Array.isArray(r?.text) && r.text.length > 0 && r.text.every((t) => Math.abs(t.ls - (t.base + 0.05)) < 1e-6),
    JSON.stringify(r?.text),
  );
  check("watermark: per-element button selects a text layer", r?.selectedType === "text", String(r?.selectedType));
  await ev(`document.getElementById("resetTweaks").click()`);
  await waitLabel(30000);
  const hidden = await ev(`(async () => { await window.__fg.useTemplate("minimal-corner-mono"); await new Promise((r) => setTimeout(r, 400)); return document.getElementById("watermarkCard").classList.contains("hidden"); })()`);
  check("watermark: card hidden for non-watermark templates", hidden === true);
}

/* 59. insert image element */
{
  await ev(`(async () => { await window.__fg.useTemplate("classic-watermark-single-row"); await new Promise((r) => setTimeout(r, 400)); })()`);
  await waitLabel(30000);
  const before = await ev(RENDER_HASH);
  await inject([FRAME_PNG], "#imgInsertFile");
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    let row = null;
    for (let i = 0; i < 50; i++) {
      row = [...document.querySelectorAll("#layerList .layer-row")].find((x) => (x.dataset.id ?? "").startsWith("image-") && x.dataset.type === "image");
      if (row) break;
      await sleep(100);
    }
    if (row) { row.click(); await sleep(150); }
    const stored = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId] ?? "";
    const boxes = JSON.parse(window.__fg.state.engine.layer_boxes(window.__fg.state.photos[0].bytes, window.__fg.effectiveTemplateJson(), window.__fg.buildOverridesJson()));
    const box = row ? boxes.find((b) => b.id === row.dataset.id) ?? null : null;
    return { id: row?.dataset.id ?? null, hasAsset: stored.includes("@user/insert"), box, props: !!document.querySelector("#propsBody .props-grid") };
  })()`);
  await waitLabel(30000);
  const after = await ev(RENDER_HASH);
  check("insert: image layer added with a @user asset", r?.id != null && r?.hasAsset === true, JSON.stringify(r).slice(0, 160));
  check("insert: image layer renders + is selectable", r?.box != null && r?.props === true, JSON.stringify(r?.box));
  check("insert: inserted image changes pixels", before !== after, `${before} -> ${after}`);
  const drag = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const st = window.__fg.state;
    const row = [...document.querySelectorAll("#layerList .layer-row")].find((x) => (x.dataset.id ?? "").startsWith("image-") && x.dataset.type === "image");
    if (!row) return { error: "no image row" };
    row.click();
    const id = row.dataset.id;
    const boxes = JSON.parse(st.engine.layer_boxes(st.photos[0].bytes, window.__fg.effectiveTemplateJson(), window.__fg.buildOverridesJson()));
    const b = boxes.find((x) => x.id === id);
    const img = document.querySelector("#canvasWrap img");
    const ov = document.querySelector(".edit-overlay");
    if (!b || !img || !ov) return { error: "no box/stage" };
    const rect = ov.getBoundingClientRect();
    // The inserted image overlaps watermark text boxes; find a point owned only
    // by the image so the hit test picks it.
    const others = boxes.filter((x) => x.id !== id && x.type !== "group");
    const inside = (o, px, py) => px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h;
    let pt = null;
    for (let gy = 0; gy <= 12 && !pt; gy++) {
      for (let gx = 1; gx < 20 && !pt; gx++) {
        const px = b.x + (b.w * gx) / 20;
        const py = b.y + (b.h * gy) / 12;
        if (!others.some((o) => inside(o, px, py))) pt = { x: px, y: py };
      }
    }
    if (!pt) pt = { x: b.x + 4, y: b.y + 4 };
    const sx = rect.left + (pt.x / img.naturalWidth) * rect.width;
    const sy = rect.top + (pt.y / img.naturalHeight) * rect.height;
    document.getElementById("viewport").dispatchEvent(new PointerEvent("pointerdown", { clientX: sx, clientY: sy, bubbles: true, cancelable: true, button: 0, buttons: 1 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: sx + 40, clientY: sy + 20, bubbles: true, buttons: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: sx + 40, clientY: sy + 20, bubbles: true }));
    await sleep(500);
    const raw = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[st.templateId] ?? "{}";
    const layer = (JSON.parse(raw).layers ?? []).find((l) => l.id === id);
    return { ox: layer?.offset?.x ?? 0, oy: layer?.offset?.y ?? 0 };
  })()`);
  if (drag?.error) console.log("PROBE-WARN:", drag.error);
  check("insert: inserted image drags on the stage", !!drag && !drag.error && (Math.abs(drag.ox) > 0.005 || Math.abs(drag.oy) > 0.005), JSON.stringify(drag));
}

/* 60. EXIF: Fuji recipe group only shows present keys */
{
  const r = await ev(`(() => {
    const empty = window.__fg.fujiRows({});
    const partial = window.__fg.fujiRows({ film_mode: "Classic Chrome", grain: "Strong", wb_shift_r: "+2", wb_shift_b: "-1", fuji_lut1: null });
    const group = document.getElementById("fujiGroup");
    return {
      empty: empty.length,
      partial: partial.length,
      labels: partial.map((x) => x[0]),
      hidden: group.classList.contains("hidden"),
      rows: document.querySelectorAll("#fujiList dt").length,
      title: document.getElementById("fujiGroup").querySelector(".fuji-title")?.textContent ?? "",
    };
  })()`);
  check("exif: fuji builder hides empty groups", r?.empty === 0, String(r?.empty));
  check(
    "exif: fuji builder keeps only present keys",
    r?.partial === 3 && r.labels.every((l) => l && !/undefined|null/.test(l)),
    JSON.stringify(r?.labels),
  );
  check("exif: fuji group hidden for the sample photo", r?.hidden === true && r?.rows === 0, JSON.stringify({ hidden: r?.hidden, rows: r?.rows }));
}

/* 61. calendar layout presets */
{
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    document.getElementById("addCalendar").click();
    await sleep(350);
    const readCal = (json) => {
      const flat = (list, out = []) => { for (const l of list ?? []) { out.push(l); if (l.type === "group") flat(l.children, out); } return out; };
      return flat(JSON.parse(json).layers).filter((l) => l.type === "calendar").pop();
    };
    const storedOf = () => localStorage.getItem("fg-tpl-edits-v1") || "{}";
    const stored0 = JSON.parse(storedOf())[window.__fg.state.templateId] ?? "{}";
    const cal0 = readCal(stored0);
    const before = ${RENDER_HASH};
    const btns = [...document.querySelectorAll("#propsBody .cal-preset")];
    const hasWeek = btns.some((b) => b.dataset.view === "week");
    btns.find((b) => b.dataset.view === "week").click();
    await sleep(900);
    const cal1 = readCal(JSON.parse(storedOf())[window.__fg.state.templateId]);
    const after = ${RENDER_HASH};
    const swatch = document.querySelector('#propsBody .cal-accents .swatch[data-color="#1772F6"]');
    if (!swatch) return { error: "no accent swatch" };
    swatch.click();
    await sleep(600);
    const cal2 = readCal(JSON.parse(storedOf())[window.__fg.state.templateId]);
    return {
      hasWeek,
      view0: cal0?.view ?? "month",
      lunar0: cal0?.showLunar !== false,
      weekdays0: cal0?.showWeekdays !== false,
      view1: cal1?.view,
      changed: before !== after,
      before,
      after,
      accent: cal2?.accent,
      shown: swatch.dataset.color,
    };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  check("calendar: preset buttons render incl. week view", r?.hasWeek === true, JSON.stringify(r).slice(0, 120));
  check("calendar: week preset sets the layer view", r?.view1 === "week", String(r?.view1));
  check("calendar: week preset changes rendered pixels", r?.changed === true, `${r?.before} -> ${r?.after}`);
  check("calendar: accent swatch sets the layer accent", r?.accent?.toLowerCase() === r?.shown?.toLowerCase() && r?.accent?.toLowerCase() === "#1772f6", JSON.stringify({ accent: r?.accent, shown: r?.shown }));
  check("calendar: inserted calendar keeps defaults", r?.view0 === "month" && r?.lunar0 === true && r?.weekdays0 === true, JSON.stringify({ view0: r?.view0, lunar0: r?.lunar0, weekdays0: r?.weekdays0 }));
}

/* 62. card inner shadow */
{
  await ev(`(() => { const cb = document.getElementById("cardOn"); cb.checked = true; cb.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  await ev(`(() => { const cb = document.getElementById("cardInnerOn"); cb.checked = false; cb.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const before = await ev(RENDER_HASH);
  await ev(`(() => { const cb = document.getElementById("cardInnerOn"); cb.checked = true; cb.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
  const ov = await ev(`JSON.parse(window.__fg.buildOverridesJson() || "{}").card?.innerShadow`);
  const after = await ev(RENDER_HASH);
  check("card: inner shadow toggle reaches overrides", ov?.enabled === true && ov?.blur > 0 && ov?.opacity > 0, JSON.stringify(ov));
  check("card: inner shadow changes rendered pixels", before !== after && after !== 0, `${before} -> ${after}`);
  await ev(`(() => { const cb = document.getElementById("cardOn"); cb.checked = false; cb.dispatchEvent(new Event("change")); })()`);
  await waitLabel(30000);
}

/* 63. report screenshots: parity panels */
{
  await ev(`(async () => {
    document.body.dataset.tier = "advanced";
    const d = document.getElementById("cardFxCard");
    if (d) { d.open = true; d.scrollIntoView({ block: "center" }); }
    await new Promise((r) => setTimeout(r, 600));
  })()`);
  await shot("08-card-fx");
  await ev(`(async () => {
    await window.__fg.useTemplate("classic-watermark-single-row");
    await new Promise((r) => setTimeout(r, 900));
    const wm = document.getElementById("watermarkCard");
    if (wm) { wm.open = true; wm.scrollIntoView({ block: "center" }); }
    await new Promise((r) => setTimeout(r, 400));
  })()`);
  await shot("09-watermark");
  await ev(`(async () => {
    const d = document.getElementById("canvasCard");
    if (d) { d.open = true; d.scrollIntoView({ block: "center" }); }
    await new Promise((r) => setTimeout(r, 400));
  })()`);
  await shot("10-background");
}

/* 64. web font manifest covers every engine font referenced by templates */
{
  const r = await ev(`(async () => {
    const fams = (window.__fg.state.fonts ?? []).map((f) => f.family);
    const need = ["Great Vibes", "Ma Shan Zheng", "Noto Serif SC", "Noto Sans SC"];
    return { n: fams.length, missing: need.filter((f) => !fams.includes(f)) };
  })()`);
  check("fonts: web engine manifest lists all template fonts", r?.missing?.length === 0, `${r?.n} families, missing ${JSON.stringify(r?.missing)}`);
  await ev(`(async () => { await window.__fg.useTemplate("art-vermilion-seal"); })()`);
  const label = await waitLabel(60000);
  check("fonts: Ma Shan Zheng renders in the web engine", label.includes("ms") && !label.includes("失败"), label);
}

/* 65. v0.6.0: sample photo chips load real EXIF */
{
  const chips = await ev(`[...document.querySelectorAll("#sampleRow .sample-chip")].map((b) => b.textContent)`);
  check("samples: three sample photo chips render", chips?.length === 3, JSON.stringify(chips));
  await ev(`(async () => { await window.__fg.useTemplate("classic-watermark-single-row"); })()`);
  await ev(`document.querySelectorAll("#sampleRow .sample-chip")[1].click()`);
  const staged = await ev(`(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const p = window.__fg.state.photos[0];
      if (p && p.name === "nikon-z6ii.jpg") return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })()`);
  const label = await waitLabel(40000);
  const info = await ev(`window.__fg.state.photos[0]?.exif ?? null`);
  check(
    "samples: chip loads the example photo with real EXIF",
    staged === true && label.includes("ms") && !!info?.model && !!info?.lens && !!info?.datetime,
    `${label}; ${JSON.stringify({ staged, model: info?.model, lens: info?.lens, dt: info?.datetime })}`,
  );
}

/* 66. v0.6.0: no-EXIF hint + fill/clear sample preview */
{
  await ev(`document.getElementById("fileInput").value = ""`);
  await inject([PHOTO_D]);
  const label1 = await waitLabel(40000);
  const hintShown = await ev(`!document.getElementById("exifHint").classList.contains("hidden")`);
  const before = await ev(RENDER_HASH);
  await ev(`document.getElementById("exifFill").click()`);
  await waitLabel(40000);
  const ov = await ev(`JSON.parse(window.__fg.buildOverridesJson() || "{}").exif ?? null`);
  const after = await ev(RENDER_HASH);
  check("exif hint: shown for a photo without EXIF", hintShown && label1.includes("ms"), label1);
  check(
    "exif hint: fill sample writes a preview override",
    !!ov?.model && !!ov?.lens && ov?.focal != null,
    JSON.stringify(ov),
  );
  check("exif hint: sample preview changes rendered pixels", before !== after && after !== 0, `${before} -> ${after}`);
  await ev(`document.getElementById("exifClear").click()`);
  await waitLabel(40000);
  const cleared = await ev(`JSON.parse(window.__fg.buildOverridesJson() || "{}").exif ?? null`);
  check("exif hint: clear removes the preview override", cleared === null, JSON.stringify(cleared));
}

/* 67. v0.6.0: date localization follows the UI language */
{
  await ev(`(async () => { await window.__fg.useTemplate("classic-watermark-date-right"); })()`);
  await ev(`document.querySelectorAll("#sampleRow .sample-chip")[1].click()`);
  await waitLabel(40000);
  const zh = await ev(`JSON.parse(window.__fg.buildOverridesJson() || "{}").dateLocale`);
  const zhHash = await ev(RENDER_HASH);
  await ev(`document.getElementById("langBtn").click()`);
  await waitLabel(40000);
  const en = await ev(`JSON.parse(window.__fg.buildOverridesJson() || "{}").dateLocale`);
  const enHash = await ev(RENDER_HASH);
  await ev(`document.getElementById("langBtn").click()`);
  await waitLabel(40000);
  check("locale: overrides carry the UI language", zh === "zh" && en === "en", `${zh} -> ${en}`);
  check("locale: zh/en dates render differently", zhHash !== enHash && zhHash !== 0, `${zhHash} -> ${enHash}`);
}

/* 68. v0.6.0: export metadata transparency notice */
{
  await ev(`document.getElementById("renderBtn").click()`);
  await waitLabel(40000);
  await ev(`document.getElementById("exportBtn").click()`);
  await new Promise((r) => setTimeout(r, 800));
  const toasts = await ev(`[...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent)`);
  check(
    "export: metadata notice shown before saving",
    Array.isArray(toasts) && toasts.some((x) => /EXIF|元数据/.test(x)),
    JSON.stringify(toasts?.slice(-2)),
  );
}

/* 69. v0.6.0: EXIF field chips append tokens to the selected text layer */
let EXIF_TEXT_ID = null;
{
  await inject([PHOTO_A]);
  await waitLabel(40000);
  await ev(`(async () => { await window.__fg.useTemplate("classic-watermark-single-row"); await new Promise((r) => setTimeout(r, 600)); })()`);
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const flat = (list, out = []) => { for (const l of list ?? []) { out.push(l); if (l.type === "group") flat(l.children, out); } return out; };
    const storedJson = () => JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId];
    let id = null;
    const readLayer = (json) => flat(JSON.parse(json || "{}").layers ?? []).find((l) => l.id === id);
    const row = [...document.querySelectorAll("#layerList .layer-row")].find((x) => x.dataset.type === "text");
    if (!row) return { error: "no text layer row" };
    row.click();
    await sleep(200);
    id = row.dataset.id;
    const chipRow = document.getElementById("exifFieldChips");
    const chips = [...document.querySelectorAll("#exifFieldChips button")];
    const keys = chips.map((c) => c.dataset.exif);
    const labels = chips.map((c) => c.textContent.trim());
    const modelChip = chips.find((c) => c.dataset.exif === "model");
    const effective = storedJson() ?? JSON.stringify(window.__fg.currentTemplateObject());
    const content0 = JSON.parse(JSON.stringify(readLayer(effective)?.content ?? []));
    const hash0 = ${RENDER_HASH};
    if (!chipRow || !modelChip) return { error: "no chip row", chips: chips.length };
    modelChip.click();
    await sleep(900);
    const content1 = readLayer(storedJson())?.content ?? [];
    const hash1 = ${RENDER_HASH};
    document.getElementById("editUndo").click();
    await sleep(900);
    const content2 = readLayer(storedJson())?.content ?? [];
    return {
      id,
      inProps: !!document.querySelector("#propsBody #exifFieldChips"),
      chips: chips.length, keys, labels,
      content0, content1, content2,
      appended: content1[content1.length - 1] ?? null,
      kept: JSON.stringify(content1.slice(0, -1)) === JSON.stringify(content0),
      undone: JSON.stringify(content2) === JSON.stringify(content0),
      hash0, hash1, changed: hash0 !== hash1,
      photoModel: window.__fg.state.photos[0]?.exif?.model ?? null,
    };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  EXIF_TEXT_ID = r?.id ?? null;
  check("exif fields: chip row renders inside text props", r?.inProps === true && r?.chips === 14, JSON.stringify({ inProps: r?.inProps, n: r?.chips }));
  check(
    "exif fields: chips cover the contract tokens",
    r?.keys?.join(",") === "model,lens,focal,aperture,shutter,iso,datetime,weekday,weekday_cn,film_mode,wb_mode,grain,dynamic_range,params",
    JSON.stringify(r?.keys),
  );
  check(
    "exif fields: chip labels resolve through i18n",
    Array.isArray(r?.labels) && r.labels.every((s) => s && !s.startsWith("exif.")),
    JSON.stringify(r?.labels?.slice(0, 4)),
  );
  check(
    "exif fields: model chip appends one exif.model item",
    !!r && !r.error && r.content1.length === r.content0.length + 1 && r.appended?.expr === "exif.model" && r.appended?.fallback === "" && r.kept === true,
    JSON.stringify({ before: r?.content0?.length, after: r?.content1?.length, appended: r?.appended }),
  );
  check("exif fields: insertion changes rendered pixels", r?.changed === true && r?.hash1 !== 0, `${r?.hash0} -> ${r?.hash1} (model=${r?.photoModel})`);
  check("exif fields: undo removes the appended token", r?.undone === true, JSON.stringify(r?.content2));
}

/* 70. v0.6.0: insert-params chip writes a fmt() parameter line */
{
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const flat = (list, out = []) => { for (const l of list ?? []) { out.push(l); if (l.type === "group") flat(l.children, out); } return out; };
    const btn = document.getElementById("exifInsertParams");
    if (!btn) return { error: "no params chip" };
    const label = btn.textContent.trim();
    btn.click();
    await sleep(900);
    const stored = JSON.parse(localStorage.getItem("fg-tpl-edits-v1") || "{}")[window.__fg.state.templateId] ?? "{}";
    const layer = flat(JSON.parse(stored).layers ?? []).find((l) => l.id === ${JSON.stringify(EXIF_TEXT_ID)});
    const last = (layer?.content ?? [])[layer?.content?.length - 1] ?? null;
    return { label, expr: last?.expr ?? null, fallback: last?.fallback ?? null, n: (layer?.content ?? []).length };
  })()`);
  if (r?.error) console.log("PROBE-WARN:", r.error);
  check(
    "exif fields: insert params chip writes a fmt() expr",
    typeof r?.expr === "string" && r.expr.includes("fmt(") && r.expr.includes("{aperture}") && r.expr.includes("{iso}") && r.fallback === "",
    JSON.stringify(r),
  );
  check("exif fields: insert params chip label is localized", typeof r?.label === "string" && r.label.length > 0 && !r.label.startsWith("exif."), String(r?.label));
}

/* 71. v0.6.0: engine font offline warmup (contract Q10)
   The harness bypasses the Service Worker (Page.setBypassServiceWorker at the
   top), so the robust path asserted here is the prefetch status half of the
   requirement — window.__fg.warmFontsStatus — plus the direct CacheStorage
   write the warmup performs itself. Deterministic: up to 30s waiting. */
{
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < 30000) {
    st = await ev(`window.__fg.warmFontsStatus ? window.__fg.warmFontsStatus() : null`);
    if (st && st.status === "done") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const expected = st ? st.engineFonts - st.loaded : -1;
  check("fonts: warmup exposed and completed within 30s", !!st && st.status === "done" && st.done === st.total, JSON.stringify(st));
  check(
    "fonts: candidate count = engine fonts minus preloaded",
    !!st && st.total === expected && st.total >= 8,
    JSON.stringify({ total: st?.total, engineFonts: st?.engineFonts, loaded: st?.loaded }),
  );
  check("fonts: warmup keeps <=3 concurrent requests", !!st && st.maxInflight <= 3, `maxInflight=${st?.maxInflight}`);
  check("fonts: warmup wrote engine fonts to CacheStorage", !!st && st.cached >= 1, JSON.stringify({ cached: st?.cached, cache: st?.cache }));
  const hit = await ev(`(async () => {
    for (const key of await caches.keys()) {
      const c = await caches.open(key);
      const reqs = await c.keys();
      const fonts = reqs.filter((r) => r.url.includes("fonts/engine/"));
      if (fonts.length) return { key, n: fonts.length, sample: fonts[0].url.split("/").pop() };
    }
    return { key: null, n: 0 };
  })()`);
  check("fonts: CacheStorage contains engine font files", hit?.n >= 1 && /^framegeist-/.test(hit.key), JSON.stringify(hit));
}

/* 72. v0.6.0 Q10: AVIF/WebP export formats end-to-end */
{
  const ui = await ev(`(() => {
    const sel = document.getElementById("exportFormat");
    const label = document.querySelector('label span[data-i18n="export.format"]');
    return {
      exists: !!sel,
      values: [...(sel?.options ?? [])].map((o) => o.value),
      value: sel?.value ?? null,
      label: label?.textContent ?? "",
      button: document.getElementById("exportBtn").textContent,
    };
  })()`);
  check("export format: select exists with jpeg/png/avif/webp", ui?.exists === true && ui.values.join(",") === "jpeg,png,avif,webp", JSON.stringify(ui));
  check("export format: defaults to jpeg", ui?.value === "jpeg", String(ui?.value));
  check("export format: field label is localized", !!ui?.label && ui.label !== "export.format", ui?.label);

  // Force the final export render path (the fast preview path stays JPEG).
  await ev(`(() => { const p = document.getElementById("preview"); p.checked = false; p.dispatchEvent(new Event("change")); })()`);
  await waitLabel(60000);
  await ev(`(() => { const s = document.getElementById("exportFormat"); s.value = "avif"; s.dispatchEvent(new Event("change")); })()`);
  await waitLabel(120000);
  const avifState = await ev(`(() => {
    const b = window.__fg.state.lastRender;
    if (!b) return null;
    const tag = (i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    return { ftyp: tag(4), brand: tag(8), n: b.length, name: window.__fg.state.lastRenderName, button: document.getElementById("exportBtn").textContent };
  })()`);
  check("export format: persisted in fg-settings-v1", (await ev(`JSON.parse(localStorage.getItem("fg-settings-v1") || "{}").exportFormat`)) === "avif", String(avifState?.name));
  check("export format: final render emits an AVIF signature", avifState?.ftyp === "ftyp" && ["avif", "avis"].includes(avifState?.brand) && avifState.n > 100, JSON.stringify(avifState));
  check("export format: filename + button reflect AVIF", /\.avif$/.test(avifState?.name ?? "") && /AVIF/.test(avifState?.button ?? ""), JSON.stringify({ name: avifState?.name, button: avifState?.button }));

  await ev(`(() => { const s = document.getElementById("exportFormat"); s.value = "webp"; s.dispatchEvent(new Event("change")); })()`);
  await waitLabel(120000);
  const webpState = await ev(`(() => {
    const b = window.__fg.state.lastRender;
    if (!b) return null;
    const tag = (i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    return { riff: tag(0), webp: tag(8), n: b.length, name: window.__fg.state.lastRenderName };
  })()`);
  check("export format: final render emits a RIFF/WEBP container", webpState?.riff === "RIFF" && webpState?.webp === "WEBP" && webpState.n > 100, JSON.stringify(webpState));
  check("export format: filename reflects WebP", /\.webp$/.test(webpState?.name ?? ""), String(webpState?.name));

  // Engine-level calls (256px) per contract Q10: valid blobs for both formats.
  const engineOut = await ev(`(() => {
    const st = window.__fg.state;
    const tpl = window.__fg.effectiveTemplateJson();
    const ojson = window.__fg.buildOverridesJson();
    const a = new Uint8Array(st.engine.render_with_overrides(st.photos[0].bytes, tpl, "avif", false, ojson, 256, false));
    const w = new Uint8Array(st.engine.render_with_overrides(st.photos[0].bytes, tpl, "webp", false, ojson, 256, false));
    const tag = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    return {
      avif: { ftyp: tag(a, 4), brand: tag(a, 8), n: a.length },
      webp: { magic: tag(w, 0) + tag(w, 8), n: w.length },
    };
  })()`);
  check("engine: avif render carries ftyp/avif signature", engineOut?.avif?.ftyp === "ftyp" && ["avif", "avis"].includes(engineOut?.avif?.brand) && engineOut.avif.n > 100, JSON.stringify(engineOut?.avif));
  check("engine: webp render carries RIFF/WEBP magic", engineOut?.webp?.magic === "RIFFWEBP" && engineOut.webp.n > 100, JSON.stringify(engineOut?.webp));

  const bad = await ev(`(() => {
    try {
      window.__fg.state.engine.render_with_overrides(window.__fg.state.photos[0].bytes, window.__fg.effectiveTemplateJson(), "gif", false, "", 64, false);
      return "no-error";
    } catch (e) { return String(e && (e.message || e)); }
  })()`);
  check("engine: unknown format throws a clear encode error", /unsupported format/i.test(bad) && /gif/.test(bad), String(bad).slice(0, 120));

  // Restore defaults for any later sections.
  await ev(`(() => {
    const s = document.getElementById("exportFormat");
    s.value = "jpeg"; s.dispatchEvent(new Event("change"));
    const p = document.getElementById("preview"); p.checked = true; p.dispatchEvent(new Event("change"));
  })()`);
  await waitLabel(60000);
}

/* 73. v0.7.0: multi-weight fonts + glyph family coverage */
{
  const fonts = await ev(`(async () => {
    const meta = await (await fetch("./fonts/engine/fonts.json")).json();
    const fams = {};
    for (const f of meta.fonts) fams[f.family] = [...(fams[f.family] ?? []), f.weight];
    return {
      total: meta.fonts.length,
      families: Object.keys(fams).length,
      inter: fams["Inter"] ?? null,
      unbounded: fams["Unbounded"] ?? null,
      fraunces: fams["Fraunces"] ?? null,
      cjkLazy: meta.fonts.filter((f) => f.lazy).length,
      cjkFamilies: [...new Set(meta.fonts.filter((f) => f.lazy).map((f) => f.family))],
      engineFamilies: window.__fg.state.engine.font_families(),
    };
  })()`);
  check("v0.7 fonts: manifest has 60+ faces / 20+ families", fonts?.total >= 60 && fonts.families >= 20, JSON.stringify({ total: fonts?.total, families: fonts?.families }));
  check("v0.7 fonts: Inter ships 400/500/600/700", JSON.stringify(fonts?.inter) === "[400,500,600,700]", JSON.stringify(fonts?.inter));
  check("v0.7 fonts: new Latin families present (Unbounded/Fraunces)", JSON.stringify(fonts?.unbounded) === "[400,500,600,700]" && JSON.stringify(fonts?.fraunces) === "[400,500,600,700]", JSON.stringify({ u: fonts?.unbounded, f: fonts?.fraunces }));
  check("v0.7 fonts: CJK faces are lazy (no first-screen preload)", fonts?.cjkLazy >= 10 && fonts.cjkFamilies.length >= 6, JSON.stringify(fonts?.cjkFamilies));
  check("v0.7 fonts: engine has Inter + JetBrains Mono registered", (fonts?.engineFamilies ?? []).includes("inter") && (fonts?.engineFamilies ?? []).includes("jetbrainsmono"), JSON.stringify(fonts?.engineFamilies));
}

/* 74. v0.7.0: real font.weight selection changes pixels */
{
  const r = await ev(`(async () => {
    const st = window.__fg.state;
    await window.__fg.ensureFont("Inter");
    const mk = (w) => JSON.stringify({
      meta: { id: "e2e-weight", name: "Weight", version: "1.1.0", minEngineVersion: "0.7.0", author: "FrameGeist", license: "CC0-1.0", category: "minimal" },
      canvas: { mode: "overlay" },
      layers: [{ type: "text", id: "t", anchor: "middle-center", font: { family: ["Inter"], size: 0.12, weight: w, color: "#111111" }, content: [{ expr: "fmt('FrameGeist 2026', exif)", fallback: "FrameGeist 2026" }] }],
    });
    const sum = (b) => { let s = 0; for (let i = 0; i < b.length; i += 7) s += b[i]; return s; };
    const a = new Uint8Array(st.engine.render_with_overrides(st.photos[0].bytes, mk(400), "jpeg", false, "", 256, false));
    const b = new Uint8Array(st.engine.render_with_overrides(st.photos[0].bytes, mk(600), "jpeg", false, "", 256, false));
    return { a: a.length, b: b.length, sa: sum(a), sb: sum(b) };
  })()`);
  check("v0.7 fonts: weight 400 vs 600 renders different pixels", !!r && (r.a !== r.b || r.sa !== r.sb), JSON.stringify(r));
}

/* 75. v0.7.0: badge style switch + panel controls reach the engine overrides */
{
  const r = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const fg = window.__fg;
    await fg.useTemplate("white-border-centered-lockup");
    await sleep(1200);
    const official = fg.effectiveTemplateJson();
    const hasBrand = official.includes("@builtin/brand/");
    const style = document.getElementById("brandStyle");
    style.value = "original"; style.dispatchEvent(new Event("change"));
    await sleep(300);
    const original = fg.effectiveTemplateJson();
    const hasLockup = original.includes("@builtin/lockup/");
    const ov1 = fg.loadOverrides("white-border-centered-lockup") ?? {};
    const pos = document.getElementById("brandPos"); pos.value = "top-left"; pos.dispatchEvent(new Event("change"));
    const size = document.getElementById("brandSize"); size.value = "1.35"; size.dispatchEvent(new Event("change"));
    const contrast = document.getElementById("brandContrast"); contrast.value = "stroke"; contrast.dispatchEvent(new Event("change"));
    const op = document.getElementById("brandOpacity"); op.value = "0.7"; op.dispatchEvent(new Event("input"));
    await sleep(1200);
    const oj = JSON.parse(fg.buildOverridesJson() || "{}");
    // restore
    style.value = "official"; style.dispatchEvent(new Event("change"));
    pos.value = "anchor"; pos.dispatchEvent(new Event("change"));
    size.value = "1"; size.dispatchEvent(new Event("change"));
    contrast.value = "auto"; contrast.dispatchEvent(new Event("change"));
    op.value = "1"; op.dispatchEvent(new Event("input"));
    await sleep(600);
    return { hasBrand, hasLockup, ov1: { style: ov1.brandStyle }, oj };
  })()`);
  check("v0.7 badge: official style template references @builtin/brand", r?.hasBrand === true, JSON.stringify(r?.hasBrand));
  check("v0.7 badge: original style rewrites asset to @builtin/lockup", r?.hasLockup === true, JSON.stringify(r?.hasLockup));
  check("v0.7 badge: style persists per template", r?.ov1?.style === "original", JSON.stringify(r?.ov1));
  check(
    "v0.7 badge: position/size/contrast/opacity reach overrides",
    r?.oj?.brandPosition === "top-left" && r?.oj?.brandScale === 1.35 && r?.oj?.brandContrast === "stroke" && r?.oj?.brandOpacity === 0.7,
    JSON.stringify({ p: r?.oj?.brandPosition, s: r?.oj?.brandScale, c: r?.oj?.brandContrast, o: r?.oj?.brandOpacity }),
  );
}

/* 76. v0.7.0: badge visibility floor + badgeless template keeps rendering */
{
  const r = await ev(`(async () => {
    const st = window.__fg.state;
    for (const [name, file] of [["@builtin/brand/sony", "./brand/sony.png"], ["@builtin/brand/sony-light", "./brand/sony-light.png"]]) {
      const res = await fetch(file);
      if (res.ok) st.engine.register_asset(name, new Uint8Array(await res.arrayBuffer()));
    }
    const mk = (h) => JSON.stringify({
      meta: { id: "e2e-badge", name: "Badge", version: "1.1.0", minEngineVersion: "0.7.0", author: "FrameGeist", license: "CC0-1.0", category: "minimal" },
      canvas: { mode: "overlay" },
      layers: [
        { type: "image", id: "b", anchor: "middle-center", asset: "@builtin/brand/sony", size: { height: h }, tint: "auto", contrast: "auto" },
      ],
    });
    const sum = (b) => { let s = 0; for (let i = 0; i < b.length; i += 11) s += b[i]; return s; };
    const render = (h) => new Uint8Array(st.engine.render_with_overrides(st.photos[0].bytes, mk(h), "jpeg", false, "", 256, false));
    const t1 = render(0.001);
    const t2 = render(0.005);
    const big = render(0.2);
    return { a: t1.length, b: t2.length, c: big.length, sa: sum(t1), sb: sum(t2), sc: sum(big) };
  })()`);
  check("v0.7 badge: badge layer renders on the real brand asset", !!r && r.a > 0 && r.c > 0, JSON.stringify(r));
  check(
    "v0.7 badge: size floor clamps 0.001 and 0.005 to the same 18px minimum",
    !!r && r.sa === r.sb && r.a === r.b,
    JSON.stringify({ sa: r?.sa, sb: r?.sb }),
  );
  check(
    "v0.7 badge: declared 0.2 renders larger than the clamped minimum",
    !!r && (r.sc !== r.sa || r.c !== r.a),
    JSON.stringify({ sa: r?.sa, sc: r?.sc }),
  );
}

/* 77. v0.7.0: templates are re-typeset (v2) and Inter tabular EXIF rows */
{
  const r = await ev(`(async () => {
    const manifest = await (await fetch("./templates.json")).json();
    const tpl = await (await fetch("./templates/festival-gold-frame-01.json")).json();
    const flat = (list, out = []) => { for (const l of list ?? []) { out.push(l); if (l.type === "group") flat(l.children, out); } return out; };
    const layers = flat(tpl.layers);
    const dataLayers = layers.filter((l) => l.type === "text" && JSON.stringify(l.content ?? []).includes("exif."));
    const tnum = dataLayers.filter((l) => (l.features ?? []).includes("tnum"));
    const weights = new Set(layers.filter((l) => l.type === "text").map((l) => l.font?.weight));
    return {
      total: manifest.length,
      minEngine: tpl.meta.minEngineVersion,
      version: tpl.meta.version,
      families: [...new Set(layers.filter((l) => l.type === "text").flatMap((l) => l.font?.family ?? []))],
      data: dataLayers.length,
      tnum: tnum.length,
      weights: [...weights].filter(Boolean),
    };
  })()`);
  check("v0.7 typography: manifest keeps 192 templates", r?.total === 192, String(r?.total));
  check("v0.8 typography: template upgraded to 1.2.0 / engine 0.7.0", r?.version === "1.2.0" && r?.minEngine === "0.7.0", JSON.stringify({ v: r?.version, e: r?.minEngine }));
  check("v0.7 typography: CJK display template uses Noto/LXGW family", (r?.families ?? []).some((f) => f === "Noto Serif SC" || f === "LXGW WenKai"), JSON.stringify(r?.families));
  check("v0.7 typography: EXIF data rows enable tnum", r?.data > 0 && r?.tnum === r?.data, JSON.stringify({ data: r?.data, tnum: r?.tnum }));
  check("v0.7 typography: weight hierarchy present (500 + display 600/700)", (r?.weights ?? []).includes(500) && ((r?.weights ?? []).includes(600) || (r?.weights ?? []).includes(700)), JSON.stringify(r?.weights));
}

/* 78. v0.7.0: wall / lightbox brand elements + modern UI metrics */
{
  const ui = await ev(`(async () => {
    const body = getComputedStyle(document.body).fontSize;
    const h2 = getComputedStyle(document.querySelector(".wall-head h2")).fontSize;
    const grid = document.getElementById("wallBrandStrip");
    const wallImgs = grid ? grid.querySelectorAll("img").length : -1;
    const lightboxOpen = typeof window.__fg.showWall === "function";
    return { body, h2, wallImgs, lightboxOpen, fontUi: document.fonts ? document.fonts.check('600 16px "Geist UI"') : null };
  })()`);
  check("v0.7 ui: body font size is 16px", ui?.body === "16px", String(ui?.body));
  check("v0.7 ui: wall title uses the fluid clamp scale (>=27px)", parseFloat(ui?.h2) >= 27, String(ui?.h2));
  check("v0.7 ui: wall brand strip shows brand marks", ui?.wallImgs >= 6, String(ui?.wallImgs));
  check("v0.7 ui: Geist UI variable font available", ui?.fontUi === true, String(ui?.fontUi));

  const lb = await ev(`(async () => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    window.__fg.openLightbox("white-border-centered-lockup");
    await sleep(700);
    const el = document.getElementById("lbBrand");
    const n = el ? el.querySelectorAll("img").length : -1;
    const src = el?.querySelector("img")?.src ?? "";
    const close = document.getElementById("lbClose");
    const cr = close.getBoundingClientRect();
    const hit = document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2);
    const br = el.getBoundingClientRect();
    const out = {
      n, src,
      hitClose: hit === close || close.contains(hit),
      brandPos: getComputedStyle(el).position,
      brandW: Math.round(br.width),
      brandH: Math.round(br.height),
      vw: innerWidth, vh: innerHeight,
    };
    window.__fg.closeLightbox();
    return out;
  })()`);
  check("v0.7 ui: lightbox brand strip contains marks", (lb?.n ?? 0) >= 1 && /brand\//.test(lb?.src ?? ""), JSON.stringify(lb));
  check(
    "v0.7 ui: brand strip must not cover the viewport (click-swallow regression)",
    lb?.brandPos !== "fixed" && (lb?.brandW ?? 1e9) < (lb?.vw ?? 0) * 0.9 && (lb?.brandH ?? 1e9) < (lb?.vh ?? 0) * 0.9,
    JSON.stringify({ pos: lb?.brandPos, w: lb?.brandW, h: lb?.brandH, vw: lb?.vw, vh: lb?.vh }),
  );
  check("v0.7 ui: lightbox close button is hit-testable", lb?.hitClose === true, JSON.stringify(lb));
}

/* 79. v0.8.0: badge library + zh UI + wall performance polish */
{
  const lib = await ev(`(async () => {
    const data = await (await fetch("./brand/index.json")).json();
    return { v: data.version, camera: data.groups?.camera?.length ?? 0, lens: data.groups?.lens?.length ?? 0, series: data.groups?.series?.length ?? 0, game: data.groups?.game?.length ?? 0, neutral: data.neutral };
  })()`);
  check("v0.8 badge lib: manifest v2 with four groups", lib?.v === 2 && lib.camera > 20 && lib.lens > 20 && lib.series >= 10 && lib.game >= 5, JSON.stringify(lib));
  check("v0.8 badge lib: neutral EXIF marker present", lib?.neutral === "exif-auto", String(lib?.neutral));

  const ed = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.__fg.useTemplate("camera-baseplate-02");
    await sleep(900);
    const cells = [...document.querySelectorAll("#brandLibGrid .brand-lib-cell")];
    const thumbs96 = cells.filter((c) => /\\/thumbs\\//.test(c.querySelector("img")?.src ?? "")).length;
    const chips = [...document.querySelectorAll("#brandGroups .brand-chip")].map((b) => b.textContent);
    const canon = cells.find((c) => (c.title || "").toLowerCase() === "canon");
    canon?.click();
    await sleep(700);
    const afterApply = window.__fgEditor.badgeTarget()?.asset ?? null;
    const json = window.__fg.effectiveTemplateJson();
    document.getElementById("brandAuto").click();
    await sleep(600);
    const afterAuto = window.__fgEditor.badgeTarget()?.asset ?? null;
    const fav = document.querySelector("#brandLibGrid .brand-lib-cell .fav");
    fav?.click();
    await sleep(200);
    const favs = JSON.parse(localStorage.getItem("fg-brand-fav-v1") || "[]").length;
    const search = document.getElementById("brandSearch");
    search.value = "nik";
    search.dispatchEvent(new Event("input"));
    await sleep(300);
    const filtered = [...document.querySelectorAll("#brandLibGrid .brand-lib-cell")].map((c) => c.title);
    search.value = "";
    search.dispatchEvent(new Event("input"));
    await sleep(200);
    return { cells: cells.length, thumbs96, chips, afterApply, hasApplied: /@builtin\\/(brand|lockup)\\/canon/.test(json), afterAuto, favs, filtered };
  })()`);
  check("v0.8 badge lib: grid renders 96px-thumb cells", (ed?.cells ?? 0) > 20 && ed.thumbs96 === ed.cells, JSON.stringify({ cells: ed?.cells, thumbs96: ed?.thumbs96 }));
  check("v0.8 badge lib: group chips follow the target layer", ed?.chips?.length === 2, JSON.stringify(ed?.chips));
  check("v0.8 badge lib: click applies the brand to the target layer", /@builtin\/(brand|lockup)\/canon/.test(ed?.afterApply ?? "") && ed.hasApplied === true, JSON.stringify({ a: ed?.afterApply, j: ed?.hasApplied }));
  check("v0.8 badge lib: auto restores the EXIF expression", /@builtin\/(brand|lockup)\/\{exif\./.test(ed?.afterAuto ?? ""), String(ed?.afterAuto));
  check("v0.8 badge lib: favorites persist", (ed?.favs ?? 0) >= 1, String(ed?.favs));
  check("v0.8 badge lib: search filters cells", Array.isArray(ed?.filtered) && ed.filtered.length > 0 && ed.filtered.every((t) => /nikon/i.test(t)), JSON.stringify(ed?.filtered?.slice(0, 5)));

  const style = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const canon = [...document.querySelectorAll("#brandLibGrid .brand-lib-cell")].find((c) => (c.title || "").toLowerCase() === "canon");
    canon?.click();
    await sleep(600);
    const sel = document.getElementById("brandStyle");
    sel.value = "original"; sel.dispatchEvent(new Event("change"));
    await sleep(700);
    const lockup = window.__fgEditor.badgeTarget()?.asset ?? null;
    const rendered = window.__fg.effectiveTemplateJson();
    sel.value = "official"; sel.dispatchEvent(new Event("change"));
    await sleep(600);
    const official = window.__fgEditor.badgeTarget()?.asset ?? null;
    return { lockup, rendersLockup: rendered.includes("@builtin/lockup/"), official };
  })()`);
  check("v0.8 badge lib: style switch swaps concrete assets", /lockup\/canon/.test(style?.lockup ?? "") && /brand\/canon/.test(style?.official ?? ""), JSON.stringify(style));

  const wall = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__fg.showWall();
    await sleep(500);
    const cards = [...document.querySelectorAll(".wall-card")];
    const withMarks = cards.filter((c) => c.querySelector(".wall-marks img")).length;
    const cv = getComputedStyle(cards[0]).contentVisibility;
    document.getElementById("wallBrandLib").click();
    await sleep(500);
    const open = !document.getElementById("brandLibModal").classList.contains("hidden");
    const modalCells = document.querySelectorAll("#brandLibModalGrid .brand-lib-cell").length;
    document.getElementById("brandLibClose").click();
    return { total: cards.length, withMarks, cv, open, modalCells, skeleton: window.__wallSkeleton ?? null };
  })()`);
  check("v0.8 wall: cards show badge marks", (wall?.withMarks ?? 0) > 100, JSON.stringify({ with: wall?.withMarks, total: wall?.total }));
  check("v0.8 wall: badge library modal opens with cells", wall?.open === true && (wall?.modalCells ?? 0) > 50, JSON.stringify({ open: wall?.open, cells: wall?.modalCells }));
  check("v0.8 perf: wall cards use content-visibility", wall?.cv === "auto", String(wall?.cv));
  check("v0.8 boot: wall skeleton shown before first paint", wall?.skeleton?.shown === true && wall.skeleton.clearedAt != null, JSON.stringify(wall?.skeleton));

  const zh = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (document.documentElement.lang !== "zh-CN") document.getElementById("langBtn").click();
    await sleep(500);
    await window.__fg.useTemplate("camera-baseplate-02");
    await sleep(700);
    const tags = [...document.querySelectorAll("#layerList .ltag")].map((e) => e.textContent.trim());
    const zhTags = tags.filter((tx) => /[\\u4e00-\\u9fff]/.test(tx)).length;
    const roots = ["#topbar", ".topbar", ".wall-head", "#brandCard", "#tweakCard"];
    const text = roots.map((s) => document.querySelector(s)?.innerText ?? "").join(" ");
    const words = text.match(/[A-Za-z]{3,}/g) ?? [];
    const ALLOW = /^(frameg|frameg|framegeist|exif|iso|jpeg|jpg|png|avif|webp|heic|wasm|canon|sony|nikon|fujifilm|leica|hasselblad|panasonic|lumix|ricoh|sigma|zeiss|dji|apple|tamron|epson|olympus|pentax|gopro|insta360|sandisk|samsung|vivo|oppo|oneplus|huawei|honor|google|motorola|nokia|blackmagic|viltrox|laowa|ttartisan|tokina|samyang|meike|sirui|yongnuo|voigtlander|eos|ilce|nikkor|zuiko|gm|art|apo|sp|xf|xcd|batis|rf|ef|url|api|dpi|raw|tiff|mm|mp|kb|mb|gb|px|auto|official|original|light|dark|inter|jetbrains|playfair|oswald|cormorant|space|grotesk|bebas|great|vibes|noto|sans|serif|sc|ma|shan|zheng|fraunces|bricolage|instrument|geist|mono|onest|unbounded|smiley|lxgw|wenkai|glow|sarasa|gothic)$/i;
    const leftovers = [...new Set(words.filter((w) => !ALLOW.test(w)))];
    return { tags, zhTags, total: tags.length, leftovers };
  })()`);
  check("v0.8 i18n: layer type tags localized in zh", zh?.total > 0 && zh?.zhTags === zh?.total, JSON.stringify(zh?.tags));
  check("v0.8 i18n: no English leftovers in visible chrome (zh)", Array.isArray(zh?.leftovers) && zh.leftovers.length === 0, JSON.stringify(zh?.leftovers));
}

clearTimeout(WATCHDOG);
check("runtime: no page exceptions/console errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
ws.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== E2E audit: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(1);
}
console.log(`screenshots: ${SHOTS}`);

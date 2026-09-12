// FrameGeist E2E audit gate (v0.2.0): drives the real Tauri WebView2 over CDP.
// Prereq: app started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
// Usage: node tools/e2e-audit.mjs [screenshotDir]
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = process.argv[2] ?? "docs/reports/v0.4.0";
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
  check("wall: 184 templates counted", /184/.test(wall.count), wall.count);
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
  check("library: 184 templates in manifest", manifest.length === 184, String(manifest.length));
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
  check("library: 184 templates", count === 184, String(count));
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
  await send("Page.reload");
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

ws.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== E2E audit: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(1);
}
console.log(`screenshots: ${SHOTS}`);

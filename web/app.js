import init, { Engine } from "./pkg/framegeist_wasm.js";
import { initI18n, setLang, t, currentLang, localizeEngineError, applyI18n } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const BASE = new URL(".", document.baseURI).href;
const CC_REPO = "meihuaanying/framegeist";
const IS_TAURI = !!window.__TAURI__;
const APP_VERSION = "0.4.0";

/* ------------------------------------------------------------------ state */

const state = {
  engine: null,
  view: "wall",            // wall | editor
  fonts: [],              // [{family,file,license}] from fonts.json
  loadedFonts: new Set(),
  templates: [],
  layouts: [],
  userTemplates: [],      // [{id,name,category,json}]
  templateCache: new Map(),
  photos: [],             // [{bytes,name,exif}]
  mode: "frame",
  templateId: null,
  layoutId: null,
  lastRender: null,
  lastRenderName: null,
  sourceUrl: null,
  brandOverride: "auto",   // auto | none | brand:<slug> | custom
  zoom: { scale: 1, tx: 0, ty: 0, autoFit: true },
  customAssets: {},        // "@user/logo" / "@user/background" -> Uint8Array
  usedNames: new Set(),
};

const LS = {
  theme: "fg-theme", lang: "fg-lang", overrides: "fg-overrides-v1",
  settings: "fg-settings-v1", lineEdits: "fg-line-edits-v1",
  picker: "fg-picker-mode", userTpl: "fg-user-templates-v1",
};

const settings = loadJson(LS.settings, {
  aspect: "original", background: "default", bgColor: "#FFFFFF",
  flipH: false, flipV: false, showLogo: true, exportSize: "0",
  exportCustom: 3000, fontFamily: "",
  defaultFontSize: 1, defaultUseColor: false, defaultTextColor: "#111111",
  saveMode: "dialog", keepGps: false, channel: "stable",
});

function loadJson(key, fallback) {
  try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key)) ?? {}) }; }
  catch { return fallback; }
}
function saveSettings() { localStorage.setItem(LS.settings, JSON.stringify(settings)); }

/* ---------------------------------------------------------------- indexeddb */
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("fg-assets-v1", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
      if (!db.objectStoreNames.contains("fonts")) db.createObjectStore("fonts", { keyPath: "family" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    store === "fonts" ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(store, key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = key === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDelete(store, key) {
  const db = await idb();
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = resolve;
  });
}

/* ------------------------------------------------------------------- utils */
const b64encode = (bytes) => {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
};
const b64decode = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const stem = (name) => name.replace(/\.[^.]+$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withViewTransition = (fn) => {
  if (!document.startViewTransition) return fn();
  try {
    const vt = document.startViewTransition(fn);
    vt.ready?.catch(() => {});
    vt.finished?.catch(() => {});
    vt.updateCallbackDone?.catch(() => {});
    return vt;
  } catch {
    return fn();
  }
};

/* ------------------------------------------------------------------- theme */
function currentTheme() { return localStorage.getItem(LS.theme) ?? "auto"; }
function applyTheme() {
  const mode = currentTheme();
  const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const btn = $("themeBtn");
  btn.textContent = mode === "auto" ? "◐" : mode === "light" ? "☀" : "☾";
  btn.title = t(`theme.${mode}`);
}
function cycleTheme() {
  const order = ["auto", "light", "dark"];
  const next = order[(order.indexOf(currentTheme()) + 1) % 3];
  localStorage.setItem(LS.theme, next);
  withViewTransition(() => applyTheme());
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (currentTheme() === "auto") applyTheme(); });

/* --------------------------------------------------------------- overrides */
function overridesStore() { try { return JSON.parse(localStorage.getItem(LS.overrides) ?? "{}"); } catch { return {}; } }
function loadOverrides(id) {
  const stored = overridesStore()[id] ?? {};
  return {
    fontSizeScale: settings.defaultFontSize ?? 1,
    paddingScale: 1,
    useColor: settings.defaultUseColor ?? false,
    textColor: settings.defaultTextColor ?? "#111111",
    fontFamily: settings.fontFamily ?? "",
    ...stored,
  };
}
function saveOverrides(id, o) {
  const store = overridesStore();
  const def = { fontSizeScale: 1, paddingScale: 1, useColor: false, textColor: "#111111", fontFamily: "" };
  if (JSON.stringify({ ...def, ...o }) === JSON.stringify(def)) delete store[id];
  else store[id] = o;
  localStorage.setItem(LS.overrides, JSON.stringify(store));
  updateTweakUI();
}
function pushOverride(patch) {
  if (!state.templateId) return;
  saveOverrides(state.templateId, { ...loadOverrides(state.templateId), ...patch });
}
function buildOverridesJson() {
  const o = state.mode === "frame" && state.templateId ? loadOverrides(state.templateId) : {};
  const out = {};
  if (o.fontSizeScale && o.fontSizeScale !== 1) out.fontSizeScale = o.fontSizeScale;
  if (o.paddingScale && o.paddingScale !== 1) out.paddingScale = o.paddingScale;
  if (o.useColor && o.textColor) out.textColor = o.textColor;
  const family = o.fontFamily || settings.fontFamily;
  if (family) out.fontFamily = family;
  if (settings.aspect && settings.aspect !== "original") out.aspect = settings.aspect;
  if (settings.background && settings.background !== "default") out.background = settings.background;
  if (settings.background === "solid" || settings.background === "default") out.backgroundColor = settings.bgColor;
  if (settings.flipH) out.flipHorizontal = true;
  if (settings.flipV) out.flipVertical = true;
  out.showLogo = settings.showLogo && state.brandOverride !== "none";
  return Object.keys(out).length ? JSON.stringify(out) : "";
}
function exportMaxEdge() {
  const v = settings.exportSize;
  if (v === "custom") return Number(settings.exportCustom) || 0;
  return Number(v) || 0;
}

/* ----------------------------------------------------------- line editor */
function lineEdits() { try { return JSON.parse(localStorage.getItem(LS.lineEdits) ?? "{}"); } catch { return {}; } }
function saveLineEdits(store) { localStorage.setItem(LS.lineEdits, JSON.stringify(store)); }
function getLayerEdits(templateId) { return lineEdits()[templateId] ?? {}; }
function setLayerEdits(templateId, edits) {
  const store = lineEdits();
  if (edits === null) delete store[templateId];
  else store[templateId] = edits;
  saveLineEdits(store);
}

/// Human-editable representation of a content item + round-trip conversion.
function itemToText(item) {
  const e = item.expr.trim();
  const fmt = e.match(/^fmt\('(.*)', exif\)$/s);
  if (fmt) return fmt[1];
  const lit = e.match(/^'(.*)'$/s);
  if (lit) return lit[1];
  const direct = e.match(/^exif\.([a-z0-9_]+)$/);
  if (direct) return `{${direct[1]}}`;
  return null; // advanced expression, read-only
}
function textToItem(text, fallback) {
  return /\{[a-z0-9_]+\}/.test(text)
    ? { expr: `fmt('${text}', exif)`, ...(fallback != null ? { fallback } : {}) }
    : { expr: `'${text}'`, ...(fallback != null ? { fallback } : {}) };
}

/* ------------------------------------------------------------ templates */
async function fetchTemplateJson(id) {
  if (state.templateCache.has(id)) return state.templateCache.get(id);
  const user = state.userTemplates.find((u) => u.id === id);
  const json = user ? JSON.stringify(user.json) : await (await fetch(BASE + `templates/${id}.json`)).text();
  const obj = JSON.parse(json);
  state.templateCache.set(id, obj);
  return obj;
}
function currentTemplateObject() {
  return state.templateCache.get(state.templateId) ?? null;
}
/// Build the render-time template JSON: base + line edits + brand overrides.
function effectiveTemplateJson() {
  const base = currentTemplateObject();
  if (!base) return "{}";
  const clone = structuredClone(base);
  const edits = getLayerEdits(state.templateId);
  for (const layer of clone.layers ?? []) {
    if (layer.type === "text" && edits[layer.id]) layer.content = edits[layer.id];
    if (layer.type === "image") {
      if (state.brandOverride === "none") {
        // keep asset but engine skips via showLogo=false (handled in overrides)
      } else if (state.brandOverride === "custom" && layer.asset.includes("@builtin/brand/")) {
        layer.asset = "@user/logo";
      } else if (state.brandOverride.startsWith("brand:")) {
        const slug = state.brandOverride.slice("brand:".length);
        layer.asset = layer.asset.replace(/\{exif\.(brand|lens)_slug\}/g, slug);
      }
    }
  }
  return JSON.stringify(clone);
}

/* --------------------------------------------------------------- pickers */
const CATS = [
  "white-border", "camera", "phone", "drone", "fuji", "film", "colorwalk", "colorful",
  "classic-watermark", "portfolio", "black-frame", "sports", "calendar", "magazine",
  "minimal", "borderless", "master", "personal", "polaroid", "festival", "effect",
  "colorcard", "blur-bg", "ticket", "game",
];
let activeCat = "all";
let templateQuery = "";
let pickerMode = localStorage.getItem(LS.picker) || "compact";

function filteredTemplates() {
  const all = activeCat === "mine"
    ? state.userTemplates.map((u) => ({ id: u.id, name: u.name, category: "user" }))
    : state.templates;
  return all.filter(
    (x) => (activeCat === "all" || activeCat === "mine" || x.category === activeCat) &&
      (!templateQuery || x.name.toLowerCase().includes(templateQuery) || x.id.includes(templateQuery))
  );
}

function tplName(tpl) {
  return tpl.names?.[currentLang()] ?? tpl.name ?? tpl.id;
}

function thumbSrc(tpl) {
  return state.userTemplates.some((u) => u.id === tpl.id) ? null : `./thumbs/${tpl.id}.jpg`;
}
function buildTemplatePicker() {
  const chips = $("catChips");
  chips.innerHTML = "";
  const mk = (id, label) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.cat = id;
    b.className = activeCat === id ? "on" : "";
    b.onclick = () => { activeCat = id; buildTemplatePicker(); };
    chips.appendChild(b);
  };
  mk("all", t("chip.all"));
  mk("mine", t("chip.mine"));
  for (const c of CATS) mk(c, t("cat." + c));

  const list = filteredTemplates();
  $("tplCount").textContent = `${list.length}`;

  const grid = $("templateGrid");
  grid.className = `grid${pickerMode === "large" ? " large" : ""}`;
  grid.innerHTML = "";
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { root: grid, rootMargin: "80px" });
  for (const tpl of list) {
    const cell = document.createElement("div");
    cell.className = `thumb${tpl.id === state.templateId ? " on" : ""}`;
    cell.title = `${tpl.category} · ${tpl.name}`;
    const src = thumbSrc(tpl);
    const isUser = !src;
    cell.innerHTML = (src
      ? `<img loading="lazy" src="${src}" alt="">`
      : `<div style="display:grid;place-items:center;height:100%;background:linear-gradient(135deg,color-mix(in srgb,var(--accent-a) 22%,var(--bg-soft)),color-mix(in srgb,var(--accent-b) 22%,var(--bg-soft)));font-family:var(--font-display)">${tplName(tpl).slice(0, 14)}</div>`) +
      (isUser ? `<span class="badge">${t("chip.mine")}</span>` : "") +
      `<span class="tname">${tplName(tpl)}</span>` +
      `<button class="zoom">⤢</button>`;
    cell.onclick = (e) => {
      if (e.target.classList.contains("zoom")) { e.stopPropagation(); openLightbox(tpl.id); return; }
      if (state.photos.length) selectTemplate(tpl.id);
      else openLightbox(tpl.id);
    };
    grid.appendChild(cell);
    io.observe(cell);
  }
  updatePinned();
}
function updatePinned() {
  const tpl = state.templates.find((x) => x.id === state.templateId)
    || state.userTemplates.find((x) => x.id === state.templateId);
  $("pinnedName").textContent = tpl ? tplName(tpl) : "—";
  $("pinnedCat").textContent = tpl ? (tpl.category ?? "user") : "";
}
async function selectTemplate(id) {
  state.templateId = id;
  await fetchTemplateJson(id);
  buildTemplatePicker();
  updateTweakUI();
  buildLineEditor();
  updateBrandDetected();
  renderNow();
}

/* ---------------------------------------------------------- template wall */
function showWall() {
  state.view = "wall";
  withViewTransition(() => {
    $("wall").classList.remove("hidden");
    $("editor").classList.add("hidden");
  });
  buildWall();
}
function showEditor() {
  state.view = "editor";
  withViewTransition(() => {
    $("wall").classList.add("hidden");
    $("editor").classList.remove("hidden");
  });
  if (state.photos.length) renderNow();
  else showTemplatePreview();
  requestAnimationFrame(() => { if (state.zoom.autoFit) fitStage(); });
  setTimeout(() => { if (state.zoom.autoFit) fitStage(); }, 240);
}
function showTemplatePreview() {
  const tpl = currentTemplateObject();
  if (!tpl || !state.templateId) return;
  const wrap = $("canvasWrap");
  wrap.innerHTML = "";
  const img = document.createElement("img");
  img.className = "template-preview";
  img.src = `./previews/${state.templateId}.jpg`;
  img.alt = "";
  img.onload = () => { img.classList.add("shown"); if (state.zoom.autoFit) fitStage(); };
  wrap.appendChild(img);
  $("stagePlaceholder").classList.add("hidden");
  const meta = state.templates.find((x) => x.id === state.templateId);
  if (meta) $("stageLabel").textContent = tplName(meta);
}
async function useTemplate(id) {
  state.templateId = id;
  await fetchTemplateJson(id);
  showEditor();
  buildTemplatePicker();
  updatePinned();
  updateTweakUI();
  buildLineEditor();
  updateBrandDetected();
  if (state.photos.length) renderNow();
  else showTemplatePreview();
}
function buildWall() {
  const tabs = $("wallCats");
  tabs.innerHTML = "";
  const mk = (id, label) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.cat = id;
    b.className = activeCat === id ? "on" : "";
    b.onclick = () => { activeCat = id; buildWall(); buildTemplatePicker(); };
    tabs.appendChild(b);
  };
  mk("all", t("chip.all"));
  mk("mine", t("chip.mine"));
  for (const c of CATS) mk(c, t("cat." + c));

  const list = filteredTemplates();
  $("wallCount").textContent = t("wall.count", { n: list.length });

  const grid = $("wallGrid");
  grid.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "wall-empty";
    empty.textContent = t("wall.empty");
    grid.appendChild(empty);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "140px" });
  for (const tpl of list) {
    const cell = document.createElement("div");
    cell.className = `wall-card${tpl.id === state.templateId ? " on" : ""}`;
    cell.tabIndex = 0;
    const src = thumbSrc(tpl) ? `./previews/${tpl.id}.jpg` : null;
    const catLabel = t("cat." + tpl.category) !== `cat.${tpl.category}` ? t("cat." + tpl.category) : (tpl.category ?? "");
    cell.innerHTML = (src
      ? `<img loading="lazy" src="${src}" alt="">`
      : `<div style="display:grid;place-items:center;aspect-ratio:3/2;background:linear-gradient(135deg,color-mix(in srgb,var(--accent-a) 22%,var(--bg-soft)),color-mix(in srgb,var(--accent-b) 22%,var(--bg-soft)))">${tplName(tpl).slice(0, 16)}</div>`) +
      `<div class="wall-name"><b>${tplName(tpl)}</b><span class="wall-cat"></span></div>` +
      `<div class="wall-actions"><button class="use">${t("wall.use")}</button><button class="icon" title="${t("wall.preview")}">⤢</button></div>`;
    cell.querySelector(".wall-cat").textContent = catLabel;
    cell.onclick = (e) => {
      if (e.target.classList.contains("icon")) { e.stopPropagation(); openLightbox(tpl.id); return; }
      useTemplate(tpl.id);
    };
    cell.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); useTemplate(tpl.id); } };
    grid.appendChild(cell);
    io.observe(cell);
  }
}

let layoutQuery = "";
function buildLayoutPicker() {
  const grid = $("layoutGrid");
  grid.innerHTML = "";
  const list = state.layouts.filter(
    (l) => !layoutQuery || l.name.toLowerCase().includes(layoutQuery) || l.id.includes(layoutQuery)
  );
  for (const lay of list) {
    const cell = document.createElement("div");
    cell.className = `layout-thumb${lay.id === state.layoutId ? " on" : ""}`;
    cell.title = `${lay.name} (${lay.slots})`;
    cell.innerHTML = `<img src="./layout-thumbs/${lay.id}.svg" alt="" style="width:100%;height:auto">` +
      `<div class="lname">${lay.slots}</div>`;
    cell.onclick = () => { state.layoutId = lay.id; buildLayoutPicker(); renderNow(); };
    grid.appendChild(cell);
  }
}

/* ------------------------------------------------------------- brand UI */
let brandList = [];
function buildBrandGrid() {
  const grid = $("brandGrid");
  grid.innerHTML = "";
  for (const slug of brandList) {
    const cell = document.createElement("div");
    const active = state.brandOverride === `brand:${slug}` || (state.brandOverride === "custom" && slug === "__custom");
    cell.className = `brand-cell${active ? " on" : ""}`;
    cell.title = slug;
    cell.innerHTML = slug === "__custom"
      ? `<span style="font-size:10px">${t("brand.custom")}</span>`
      : `<img loading="lazy" src="./brand/${slug}.png" alt="">`;
    cell.onclick = () => {
      state.brandOverride = slug === "__custom" ? "custom" : `brand:${slug}`;
      buildBrandGrid();
      renderNow();
    };
    grid.appendChild(cell);
  }
  $("brandAuto").classList.toggle("on", state.brandOverride === "auto");
  $("brandNone").classList.toggle("on", state.brandOverride === "none");
}
function updateBrandDetected() {
  const info = state.photos[0]?.exif;
  if (!info || !info.brand_slug) { $("brandDetected").textContent = t("brand.detectedNone"); return; }
  const lens = info.lens_slug && info.lens_slug !== info.brand_slug ? ` (+${info.lens_slug})` : "";
  $("brandDetected").textContent = t("brand.detected", { brand: info.brand_slug + lens });
}

/* --------------------------------------------------------------- photos */
async function acceptFiles(fileList) {
  const files = [...fileList].filter((f) => /image\//.test(f.type) || /\.(jpe?g|png|webp|tiff?|heic|heif)$/i.test(f.name));
  if (!files.length) { toast("error", t("err.decode")); return; }
  const heic = files.find((f) => /\.(heic|heif)$/i.test(f.name));
  if (heic) { toast("error", t("err.heic")); }
  const good = files.filter((f) => !/\.(heic|heif)$/i.test(f.name));
  if (!good.length) return;
  state.photos = [];
  for (const f of good) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let exif = null;
      try { exif = JSON.parse(state.engine.probe_exif(bytes)); } catch { /* no exif */ }
      state.photos.push({ bytes, name: f.name, exif });
    } catch (e) {
      toast("error", `${f.name}: ${e.message || e}`);
    }
  }
  if (!state.photos.length) return;
  updateFileMeta();
  showExif();
  updateBrandDetected();
  await showSource();
  await renderNow();
}
function updateFileMeta() {
  const meta = $("fileMeta");
  meta.innerHTML = "";
  if (!state.photos.length) return;
  const s = document.createElement("span");
  s.className = "name";
  s.textContent = state.photos.length === 1 ? state.photos[0].name : t("drop.multi", { n: state.photos.length });
  meta.appendChild(s);
  if (state.photos[0]) {
    const kb = state.photos[0].bytes.length / 1024;
    const info = document.createElement("span");
    info.className = "muted";
    info.textContent = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
    meta.appendChild(info);
  }
}
async function showSource() {
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  if (!state.photos.length) return;
  state.sourceUrl = URL.createObjectURL(new Blob([state.photos[0].bytes]));
  setStage(state.sourceUrl, t("stage.original"));
}

function setStage(url, label) {
  const wrap = $("canvasWrap");
  wrap.innerHTML = "";
  const img = new Image();
  img.onload = () => { img.classList.add("shown"); if (state.view === "editor") fitStage(); };
  img.src = url;
  wrap.appendChild(img);
  $("stagePlaceholder").classList.add("hidden");
  if (label) $("stageLabel").textContent = label;
}

/* -------------------------------------------------------------- exif panel */
function showExif() {
  const dl = $("exifList");
  dl.innerHTML = "";
  const info = state.photos[0]?.exif;
  if (!info) { $("exifEmpty").classList.remove("hidden"); dl.classList.add("hidden"); return; }
  $("exifEmpty").classList.add("hidden");
  dl.classList.remove("hidden");
  const rows = [
    ["exif.make", info.make], ["exif.model", info.model_pretty ?? info.model],
    ["exif.lens", info.lens], ["exif.focal", info.focal_mm != null ? `${info.focal_mm} mm` : null],
    ["exif.aperture", info.aperture != null ? `f/${info.aperture}` : null],
    ["exif.shutter", info.shutter], ["exif.iso", info.iso],
    ["exif.datetime", info.datetime], ["exif.orientation", info.orientation],
  ];
  for (const [key, val] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = t(key);
    const dd = document.createElement("dd");
    if (val === null || val === undefined || val === "") { dd.textContent = "—"; dd.className = "none"; }
    else dd.textContent = String(val);
    dl.appendChild(dt); dl.appendChild(dd);
  }
}

/* ----------------------------------------------------------- line editor UI */
const EDITABLE_FIELDS = ["model_pretty", "make", "lens", "focal", "aperture", "shutter", "iso", "datetime", "brand_slug", "lens_slug"];
function buildLineEditor() {
  const box = $("lineEditor");
  box.innerHTML = "";
  const tpl = currentTemplateObject();
  if (!tpl) return;
  const edits = getLayerEdits(state.templateId);
  let textLayers = (tpl.layers ?? []).filter((l) => l.type === "text");
  for (const layer of textLayers) {
    const items = edits[layer.id] ?? layer.content;
    const div = document.createElement("div");
    div.style.marginBottom = "8px";
    const head = document.createElement("div");
    head.className = "muted";
    head.style.margin = "4px 0 4px";
    head.textContent = `${layer.id}`;
    div.appendChild(head);
    items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "line-item";
      const text = itemToText(item);
      if (text === null) {
        const ro = document.createElement("span");
        ro.className = "ro";
        ro.textContent = item.expr + "  ·  " + t("exifEdit.advanced");
        ro.title = item.expr;
        row.appendChild(ro);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.value = text;
        input.onchange = () => {
          const newItems = [...items];
          newItems[idx] = textToItem(input.value, item.fallback);
          const e = { ...edits, [layer.id]: newItems };
          setLayerEdits(state.templateId, e);
          renderNow();
        };
        row.appendChild(input);
      }
      const mk = (label, fn, title) => {
        const b = document.createElement("button");
        b.className = "mini"; b.textContent = label; b.title = title ?? "";
        b.onclick = fn;
        row.appendChild(b);
      };
      mk("↑", () => moveLine(edits, layer.id, items, idx, -1));
      mk("↓", () => moveLine(edits, layer.id, items, idx, +1));
      mk("✕", () => {
        const newItems = items.filter((_, i) => i !== idx);
        setLayerEdits(state.templateId, { ...edits, [layer.id]: newItems });
        buildLineEditor(); renderNow();
      }, "delete");
      div.appendChild(row);
    });
    const add = document.createElement("button");
    add.className = "mini"; add.style.width = "auto"; add.style.padding = "0 8px";
    add.textContent = t("exifEdit.add");
    add.onclick = () => {
      const newItems = [...items, { expr: "'新文字'", fallback: null }];
      setLayerEdits(state.templateId, { ...edits, [layer.id]: newItems });
      buildLineEditor(); renderNow();
    };
    div.appendChild(add);
    box.appendChild(div);
  }
  // field chips
  const chips = $("fieldChips");
  chips.innerHTML = "";
  const lastInput = () => document.activeElement && document.activeElement.tagName === "INPUT" ? document.activeElement : null;
  for (const f of EDITABLE_FIELDS) {
    const b = document.createElement("button");
    b.textContent = `{${f}}`;
    b.onclick = () => {
      const input = lastInput();
      if (!input) return;
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, pos) + `{${f}}` + input.value.slice(pos);
      input.dispatchEvent(new Event("change"));
    };
    chips.appendChild(b);
  }
}
function moveLine(edits, layerId, items, idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= items.length) return;
  const newItems = [...items];
  [newItems[idx], newItems[j]] = [newItems[j], newItems[idx]];
  setLayerEdits(state.templateId, { ...edits, [layerId]: newItems });
  buildLineEditor(); renderNow();
}

/* ------------------------------------------------------------- tweaks UI */
function updateTweakUI() {
  const o = state.templateId ? loadOverrides(state.templateId) : {};
  $("sizeRange").value = o.fontSizeScale ?? 1;
  $("sizeVal").textContent = `${Math.round((o.fontSizeScale ?? 1) * 100)}%`;
  $("padRange").value = o.paddingScale ?? 1;
  $("padVal").textContent = `${Math.round((o.paddingScale ?? 1) * 100)}%`;
  $("useColor").checked = !!o.useColor;
  $("colorPick").value = o.textColor ?? "#111111";
  $("colorPick").disabled = !o.useColor;
  // font select
  const sel = $("fontSelect");
  sel.innerHTML = "";
  const def = document.createElement("option");
  def.value = ""; def.textContent = t("tweak.fontDefault");
  sel.appendChild(def);
  for (const f of state.fonts) {
    const opt = document.createElement("option");
    opt.value = f.family; opt.textContent = f.family;
    sel.appendChild(opt);
  }
  sel.value = o.fontFamily || (state.fonts.some((f) => f.family === settings.fontFamily) ? settings.fontFamily : "");
}

async function ensureFont(family) {
  if (!family || state.loadedFonts.has(family)) return;
  const meta = state.fonts.find((f) => f.family === family)
    || state.userFonts?.find((f) => f.family === family);
  if (!meta) return;
  try {
    let bytes;
    if (meta.file) {
      const res = await fetch(`${BASE}fonts/engine/${meta.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else {
      bytes = meta.bytes instanceof Uint8Array ? meta.bytes : new Uint8Array(meta.bytes);
    }
    state.engine.add_font(family, bytes);
    state.loadedFonts.add(family);
  } catch (e) {
    toast("error", `${t("err.font")}: ${family} (${e.message || e})`);
  }
}

/* ----------------------------------------------------------------- render */
function renderOverridesJson() { return buildOverridesJson(); }

const builtinAssetCache = new Set();
/// Fetch and register built-in image assets (@builtin/<kind>/<slug>[-light].png)
/// on demand — the WASM engine has no filesystem (v0.3.0 T-A fix).
async function ensureBuiltinAssets(templateJson) {
  const wanted = new Set();
  for (const m of String(templateJson).matchAll(/@builtin\/([a-z]+)\/([a-z0-9-]+)/g)) {
    wanted.add(`${m[1]}/${m[2]}`);
  }
  const info = state.photos[0]?.exif;
  if (info?.brand_slug) wanted.add(`brand/${info.brand_slug}`);
  if (info?.lens_slug) wanted.add(`brand/${info.lens_slug}`);
  if (info?.lens_series) wanted.add(`series/${info.lens_series}`);
  if (state.brandOverride.startsWith("brand:")) {
    wanted.add(`brand/${state.brandOverride.slice("brand:".length)}`);
  }
  for (const key of wanted) {
    if (builtinAssetCache.has(key)) continue;
    builtinAssetCache.add(key);
    const [kind, slug] = key.split("/");
    for (const variant of ["", "-light"]) {
      try {
        const res = await fetch(`${BASE}${kind}/${slug}${variant}.png`);
        if (!res.ok) continue;
        state.engine.register_asset(
          `@builtin/${kind}/${slug}${variant}`,
          new Uint8Array(await res.arrayBuffer()),
        );
      } catch { /* missing asset -> blank slot (by design) */ }
    }
  }
}

async function fastPreviewRgba(photoBytes) {
  const blob = new Blob([photoBytes]);
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const cap = 1600;
  const scale = Math.min(1, cap / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  bmp.close();
  return { rgba: new Uint8Array(data.buffer.slice(0)), w, h };
}

let renderToken = 0;
async function renderNow() {
  if (!state.engine || !state.photos.length) { showTemplatePreview(); return; }
  const token = ++renderToken;
  setStatus("busy", t("status.rendering"));
  const skeletonTimer = setTimeout(() => $("skeleton").classList.add("on"), 250);
  const t0 = performance.now();
  try {
    let out;
    if (state.mode === "frame") {
      await ensureFont(loadOverrides(state.templateId).fontFamily || settings.fontFamily);
      const tpl = effectiveTemplateJson();
      await ensureBuiltinAssets(tpl);
      const ojson = renderOverridesJson();
      if ($("preview").checked) {
        try {
          const { rgba, w, h } = await fastPreviewRgba(state.photos[0].bytes);
          out = state.engine.render_raw(rgba, w, h, state.photos[0].bytes, tpl, "jpeg", ojson);
        } catch {
          out = state.engine.render_with_overrides(state.photos[0].bytes, tpl, "jpeg", true, ojson, 0, settings.keepGps);
        }
      } else {
        out = state.engine.render_with_overrides(state.photos[0].bytes, tpl, "jpeg", false, ojson, exportMaxEdge(), settings.keepGps);
      }
    } else {
      const lay = await (await fetch(BASE + `layouts/${state.layoutId}.json`)).text();
      out = state.engine.render_collage(state.photos.map((p) => p.bytes), lay, "jpeg", $("preview").checked);
    }
    if (token !== renderToken) return;
    const ms = (performance.now() - t0).toFixed(0);
    state.lastRender = out;
    state.lastRenderName = state.mode === "frame"
      ? `${stem(state.photos[0].name)}-${state.templateId}.jpg`
      : `framegeist-collage-${state.layoutId}.jpg`;
    const url = URL.createObjectURL(new Blob([out], { type: "image/jpeg" }));
    withViewTransition(() => setStage(url, `${t("stage.rendered")} · ${ms} ms · ${(out.length / 1024).toFixed(0)} KB`));
    $("exportBtn").disabled = false;
    $("exportBatchBtn").classList.toggle("hidden", !(state.mode === "frame" && state.photos.length > 1));
    $("exportBatchBtn").textContent = t("btn.exportBatch", { n: state.photos.length });
    setStatus("ready", t("status.ready"));
  } catch (e) {
    if (token !== renderToken) return;
    setStatus("error", t("err.render"));
    toast("error", `${t("err.render")}: ${localizeEngineError(e)}`);
  } finally {
    clearTimeout(skeletonTimer);
    $("skeleton").classList.remove("on");
  }
}

/* -------------------------------------------------------------- zoom/pan */
function fitStage() {
  const vp = $("viewport").getBoundingClientRect();
  if (vp.width < 10 || vp.height < 10) return;
  const img = $("canvasWrap").querySelector("img");
  if (!img || !img.naturalWidth) return;
  const pad = 48;
  const scale = Math.min((vp.width - pad) / img.naturalWidth, (vp.height - pad) / img.naturalHeight, 1.6);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  state.zoom = { scale, tx: (vp.width - w) / 2, ty: (vp.height - h) / 2, autoFit: true };
  applyZoom();
}
function applyZoom() {
  const z = state.zoom;
  $("canvasWrap").style.transform = `translate(${z.tx}px, ${z.ty}px) scale(${z.scale})`;
  $("zoomLabel").textContent = `${Math.round(z.scale * 100)}%`;
}
function zoomBy(factor, cx, cy) {
  const vp = $("viewport").getBoundingClientRect();
  const z = state.zoom;
  const px = (cx ?? vp.width / 2 - z.tx) / z.scale;
  const py = (cy ?? vp.height / 2 - z.ty) / z.scale;
  const next = Math.min(Math.max(z.scale * factor, 0.05), 8);
  const nx = (cx ?? vp.width / 2) - px * next;
  const ny = (cy ?? vp.height / 2) - py * next;
  state.zoom = { scale: next, tx: nx, ty: ny, autoFit: false };
  applyZoom();
}
function wireViewport() {
  const vp = $("viewport");
  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let dragging = null;
  vp.addEventListener("pointerdown", (e) => {
    dragging = { x: e.clientX, y: e.clientY, tx: state.zoom.tx, ty: state.zoom.ty };
    vp.classList.add("dragging");
    vp.setPointerCapture(e.pointerId);
  });
  vp.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    state.zoom.tx = dragging.tx + (e.clientX - dragging.x);
    state.zoom.ty = dragging.ty + (e.clientY - dragging.y);
    state.zoom.autoFit = false;
    applyZoom();
  });
  const end = (e) => { dragging = null; vp.classList.remove("dragging"); try { vp.releasePointerCapture(e.pointerId); } catch {} };
  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);
  vp.addEventListener("dblclick", fitStage);
  $("zoomIn").onclick = () => zoomBy(1.25);
  $("zoomOut").onclick = () => zoomBy(1 / 1.25);
  $("zoomFit").onclick = fitStage;
  $("zoomReset").onclick = () => { state.zoom = { scale: 1, tx: 0, ty: 0, autoFit: false }; applyZoom(); };
  new ResizeObserver(() => { if (state.zoom.autoFit) fitStage(); }).observe(vp);
}

/* --------------------------------------------------------- download/save */
function download(bytes, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function saveBytes(bytes, filename, { dialog = true } = {}) {
  if (IS_TAURI) {
    try {
      if (dialog && settings.saveMode === "dialog") {
        const path = await window.__TAURI__.core.invoke("plugin:dialog|save", {
          options: { defaultPath: filename, filters: [{ name: filename.split(".").pop().toUpperCase(), extensions: [filename.split(".").pop()] }] },
        });
        if (!path) return false;
        await window.__TAURI__.core.invoke("save_file", { path, b64: b64encode(bytes) });
      } else {
        await window.__TAURI__.core.invoke("save_to_downloads", { filename, b64: b64encode(bytes) });
      }
      return true;
    } catch (e) {
      toast("error", String(e));
      return false;
    }
  }
  download(bytes, filename);
  return true;
}
function uniqueName(filename) {
  if (!state.usedNames.has(filename)) { state.usedNames.add(filename); return filename; }
  const dot = filename.lastIndexOf(".");
  const base = filename.slice(0, dot), ext = filename.slice(dot);
  let i = 2;
  while (state.usedNames.has(`${base}-${i}${ext}`)) i++;
  const name = `${base}-${i}${ext}`;
  state.usedNames.add(name);
  return name;
}

async function exportCurrent() {
  if (!state.lastRender) { toast("error", t("toast.renderFirst")); return; }
  const name = uniqueName(state.lastRenderName);
  if (await saveBytes(state.lastRender, name, { dialog: true }))
    toast("ok", t("toast.exported", { name }));
}

async function exportBatch() {
  const photos = state.photos.slice();
  const tpl = effectiveTemplateJson();
  const ojson = renderOverridesJson();
  $("progressWrap").classList.remove("hidden");
  state.usedNames.clear();
  let ok = 0;
  for (let i = 0; i < photos.length; i++) {
    try {
      const out = state.engine.render_with_overrides(photos[i].bytes, tpl, "jpeg", false, ojson, exportMaxEdge(), settings.keepGps);
      const name = uniqueName(`${stem(photos[i].name)}-${state.templateId}.jpg`);
      if (await saveBytes(out, name, { dialog: false })) ok++;
    } catch (e) {
      toast("error", `${photos[i].name}: ${localizeEngineError(e)}`);
    }
    $("progressBar").style.width = `${Math.round(((i + 1) / photos.length) * 100)}%`;
    setStatus("busy", `${i + 1}/${photos.length}`);
    await sleep(180);
  }
  setStatus("ready", t("status.ready"));
  toast("ok", t("toast.batchDone", { n: ok }));
  setTimeout(() => { $("progressWrap").classList.add("hidden"); $("progressBar").style.width = "0%"; }, 1000);
}

/* ----------------------------------------------------- save/import .fgt */
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "template"; }

function buildSavedTemplate(name) {
  const base = structuredClone(currentTemplateObject());
  const o = loadOverrides(state.templateId);
  const family = o.fontFamily || settings.fontFamily;
  for (const layer of base.layers ?? []) {
    if (layer.type === "text") {
      layer.font.family = family ? [family] : layer.font.family;
      layer.font.size = Math.min(0.5, layer.font.size * (o.fontSizeScale ?? 1));
      if (o.useColor && o.textColor) layer.font.color = o.textColor;
    }
  }
  if (base.canvas?.padding) {
    const s = o.paddingScale ?? 1;
    for (const k of ["top", "right", "bottom", "left"]) {
      if (typeof base.canvas.padding[k] === "number") base.canvas.padding[k] = Math.min(1, base.canvas.padding[k] * s);
    }
  }
  const edits = getLayerEdits(state.templateId);
  for (const layer of base.layers ?? []) {
    if (layer.type === "text" && edits[layer.id]) layer.content = edits[layer.id];
  }
  const id = `user-${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
  base.meta = { ...base.meta, id, name, author: base.meta.author ?? "user", license: "CC0-1.0", version: "0.1.0", minEngineVersion: "0.1.0" };
  return { id, obj: base };
}

async function saveAsTemplate() {
  const name = ($("saveName").value || "").trim();
  if (!name) { $("saveName").focus(); return; }
  const { id, obj } = buildSavedTemplate(name);
  const json = JSON.stringify(obj, null, 2);
  try {
    state.engine.validate_template(json);
  } catch (e) {
    toast("error", `${t("exifEdit.importFail", { e: localizeEngineError(e) })}`);
    return;
  }
  // local list
  state.userTemplates.push({ id, name, category: "user", json: obj });
  localStorage.setItem(LS.userTpl, JSON.stringify(state.userTemplates));
  // .fgt package
  const zip = makeStoreZip({
    "manifest.json": JSON.stringify({ formatVersion: 1, kind: "framegeist-template", templateId: id, name }, null, 2),
    "template.json": json,
  });
  await saveBytes(zip, `${id}.fgt`, { dialog: true });
  toast("ok", t("exifEdit.saved", { name }));
  $("saveRow").classList.add("hidden");
  $("saveName").value = "";
  buildTemplatePicker();
}

/* store-only zip (no compression) + CRC32 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeStoreZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); dv.setUint16(12, 0x2100, true); // time 1980-01-01
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    parts.push(local);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x2100, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length;
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end]);
}
function readStoreZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer);
  const files = {};
  let i = 0;
  while (i + 30 <= bytes.length) {
    if (dv.getUint32(i, true) !== 0x04034b50) break;
    const method = dv.getUint16(i + 8, true);
    const size = dv.getUint32(i + 18, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    if (method !== 0) throw new Error("compressed entries unsupported; re-export the .fgt");
    const data = bytes.subarray(i + 30 + nameLen + extraLen, i + 30 + nameLen + extraLen + size);
    files[name] = new TextDecoder().decode(data);
    i += 30 + nameLen + extraLen + size;
  }
  return files;
}

async function importTemplateFile(file) {
  try {
    const buf = await file.arrayBuffer();
    let json;
    try {
      const files = readStoreZip(buf);
      json = files["template.json"];
      if (!json) throw new Error("template.json missing");
    } catch (zipErr) {
      // fallback: raw JSON template
      json = new TextDecoder().decode(new Uint8Array(buf));
      JSON.parse(json);
    }
    state.engine.validate_template(json);
    const obj = JSON.parse(json);
    const id = obj.meta.id;
    state.userTemplates = state.userTemplates.filter((u) => u.id !== id);
    state.userTemplates.push({ id, name: obj.meta.name, category: obj.meta.category ?? "user", json: obj });
    localStorage.setItem(LS.userTpl, JSON.stringify(state.userTemplates));
    if (state.templateCache) state.templateCache.delete(id);
    toast("ok", t("exifEdit.imported", { name: obj.meta.name }));
    activeCat = "mine";
    buildTemplatePicker();
  } catch (e) {
    toast("error", t("exifEdit.importFail", { e: e.message || e }));
  }
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  initI18n();
  applyTheme();
  setStatus("busy", t("status.boot"));

  try {
    await init({ module_or_path: "./pkg/framegeist_wasm_bg.wasm" });
  } catch (e) {
    setStatus("error", `${t("err.wasm")}: ${e.message || e}`);
    return;
  }
  state.engine = new Engine([], []);

  // boot fonts: JetBrains Mono (template default) + Inter (small UI-facing)
  try {
    state.fonts = (await (await fetch(BASE + "fonts/engine/fonts.json")).json()).fonts ?? [];
    for (const family of ["JetBrains Mono", "Inter"]) await ensureFont(family);
  } catch { /* templates fall back gracefully */ }

  // user assets from IndexedDB
  try {
    const logo = await idbGet("assets", "logo");
    const bg = await idbGet("assets", "background");
    if (logo) { state.customAssets["@user/logo"] = new Uint8Array(logo); state.engine.register_asset("@user/logo", state.customAssets["@user/logo"]); }
    if (bg) { state.customAssets["@user/background"] = new Uint8Array(bg); state.engine.register_asset("@user/background", state.customAssets["@user/background"]); }
    state.userFonts = (await idbGet("fonts")) ?? [];
    for (const f of state.userFonts) state.engine.add_font(f.family, new Uint8Array(f.bytes));
    state.userFonts.forEach((f) => state.loadedFonts.add(f.family));
  } catch { /* ignore */ }

  state.templates = await (await fetch(BASE + "templates.json")).json();
  state.layouts = await (await fetch(BASE + "layouts.json")).json();
  try { state.userTemplates = JSON.parse(localStorage.getItem(LS.userTpl) ?? "[]"); } catch { state.userTemplates = []; }
  try { brandList = [...(await (await fetch(BASE + "brand/index.json")).json()), "__custom"]; } catch { brandList = ["__custom"]; }
  state.templateId = state.templates[0]?.id ?? null;
  state.layoutId = state.layouts[0]?.id ?? null;
  await fetchTemplateJson(state.templateId);
  await ensureFont(state.templates.length ? settings.fontFamily : "");

  buildTemplatePicker();
  buildLayoutPicker();
  buildBrandGrid();
  updateTweakUI();
  buildLineEditor();
  showExif();
  updateBrandDetected();
  syncCanvasUI();
  showWall();
  setStatus("ready", t("status.ready"));
  window.__bootMs = Math.round(performance.now());
}

function syncCanvasUI() {
  $("aspectSelect").value = settings.aspect;
  $("bgSelect").value = settings.background;
  $("bgColor").value = settings.bgColor;
  $("flipH").classList.toggle("on", settings.flipH);
  $("flipV").classList.toggle("on", settings.flipV);
  $("brandShow").checked = settings.showLogo;
  $("exportSize").value = settings.exportSize;
  $("exportCustom").classList.toggle("hidden", settings.exportSize !== "custom");
  $("exportCustom").value = settings.exportCustom;
  $("pickerCompact").classList.toggle("on", pickerMode === "compact");
  $("pickerLarge").classList.toggle("on", pickerMode === "large");
}

/* ------------------------------------------------------------------ status */
function setStatus(kind, text) {
  $("statusPill").className = `pill ${kind}`;
  $("statusText").textContent = text;
}
function toast(kind, text) {
  const box = document.createElement("div");
  box.className = `toast ${kind}`;
  box.textContent = text;
  $("toasts").appendChild(box);
  setTimeout(() => box.remove(), kind === "error" ? 7000 : 3500);
}

/* ------------------------------------------------------------- mode switch */
function switchMode(mode) {
  state.mode = mode;
  withViewTransition(() => {
    $("modeFrame").classList.toggle("on", mode === "frame");
    $("modeCollage").classList.toggle("on", mode === "collage");
    $("templateCard").classList.toggle("hidden", mode !== "frame");
    $("canvasCard").classList.toggle("hidden", mode !== "frame");
    $("tweakCard").classList.toggle("hidden", mode !== "frame");
    $("brandCard").classList.toggle("hidden", mode !== "frame");
    $("exifEditCard").classList.toggle("hidden", mode !== "frame");
    $("layoutCard").classList.toggle("hidden", mode !== "collage");
  });
  renderNow();
}

/* ------------------------------------------------------------------ wire */
function wire() {
  $("modeFrame").onclick = () => switchMode("frame");
  $("modeCollage").onclick = () => switchMode("collage");
  $("renderBtn").onclick = renderNow;
  $("exportBtn").onclick = exportCurrent;
  $("exportBatchBtn").onclick = exportBatch;
  $("updateBtn").onclick = checkUpdates;
  $("themeBtn").onclick = cycleTheme;
  $("langBtn").onclick = () => setLang(currentLang() === "zh" ? "en" : "zh");
  $("preview").onchange = renderNow;

  $("tplSearch").oninput = (e) => { templateQuery = e.target.value.trim().toLowerCase(); buildTemplatePicker(); };
  $("wallSearch").oninput = (e) => { templateQuery = e.target.value.trim().toLowerCase(); buildWall(); buildTemplatePicker(); };
  $("wallImport").onclick = () => $("fileInput").click();
  $("backToWall").onclick = showWall;
  $("layoutSearch").oninput = (e) => { layoutQuery = e.target.value.trim().toLowerCase(); buildLayoutPicker(); };
  $("pickerCompact").onclick = () => { pickerMode = "compact"; localStorage.setItem(LS.picker, pickerMode); syncCanvasUI(); buildTemplatePicker(); };
  $("pickerLarge").onclick = () => { pickerMode = "large"; localStorage.setItem(LS.picker, pickerMode); syncCanvasUI(); buildTemplatePicker(); };

  $("sizeRange").oninput = (e) => pushOverride({ fontSizeScale: Number(e.target.value) });
  $("padRange").oninput = (e) => pushOverride({ paddingScale: Number(e.target.value) });
  $("useColor").onchange = (e) => pushOverride({ useColor: e.target.checked });
  $("colorPick").oninput = (e) => pushOverride({ textColor: e.target.value });
  $("fontSelect").onchange = (e) => { pushOverride({ fontFamily: e.target.value }); settings.fontFamily = e.target.value; saveSettings(); ensureFont(e.target.value); renderNow(); };
  $("uploadFont").onclick = () => $("fontFile").click();
  $("fontFile").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const family = f.name.replace(/\.[^.]+$/, "");
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      state.engine.add_font(family, bytes);
      state.loadedFonts.add(family);
      state.userFonts = [...(state.userFonts ?? []).filter((x) => x.family !== family), { family, bytes }];
      await idbPut("fonts", family, { family, bytes });
      state.fonts.push({ family, file: null });
      updateTweakUI();
      $("fontSelect").value = family;
      pushOverride({ fontFamily: family });
      toast("ok", family);
      renderNow();
    } catch (err) {
      toast("error", `${t("err.font")}: ${err.message || err}`);
    }
  };
  $("resetTweaks").onclick = () => { if (state.templateId) saveOverrides(state.templateId, undefined); renderNow(); };

  $("aspectSelect").onchange = (e) => { settings.aspect = e.target.value; saveSettings(); renderNow(); };
  $("bgSelect").onchange = (e) => { settings.background = e.target.value; saveSettings(); renderNow(); };
  $("bgColor").oninput = (e) => { settings.bgColor = e.target.value; saveSettings(); if (settings.background === "default" || settings.background === "solid") renderNow(); };
  $("uploadBg").onclick = () => $("bgFile").click();
  $("bgFile").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    state.customAssets["@user/background"] = bytes;
    state.engine.register_asset("@user/background", bytes);
    await idbPut("assets", "background", bytes.buffer);
    settings.background = "image";
    saveSettings(); syncCanvasUI(); renderNow();
  };
  $("flipH").onclick = () => { settings.flipH = !settings.flipH; saveSettings(); syncCanvasUI(); renderNow(); };
  $("flipV").onclick = () => { settings.flipV = !settings.flipV; saveSettings(); syncCanvasUI(); renderNow(); };
  $("resetCanvas").onclick = () => {
    settings.aspect = "original"; settings.background = "default"; settings.flipH = false; settings.flipV = false;
    saveSettings(); syncCanvasUI(); renderNow();
  };

  $("brandShow").onchange = (e) => { settings.showLogo = e.target.checked; saveSettings(); renderNow(); };
  $("brandAuto").onclick = () => { state.brandOverride = "auto"; buildBrandGrid(); renderNow(); };
  $("brandNone").onclick = () => { state.brandOverride = "none"; buildBrandGrid(); renderNow(); };
  $("uploadLogo").onclick = () => $("logoFile").click();
  $("logoFile").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    state.customAssets["@user/logo"] = bytes;
    state.engine.register_asset("@user/logo", bytes);
    await idbPut("assets", "logo", bytes.buffer);
    state.brandOverride = "custom";
    buildBrandGrid(); renderNow();
  };
  $("clearLogo").onclick = async () => {
    delete state.customAssets["@user/logo"];
    await idbDelete("assets", "logo");
    if (state.brandOverride === "custom") state.brandOverride = "auto";
    buildBrandGrid(); renderNow();
  };

  $("exportSize").onchange = (e) => { settings.exportSize = e.target.value; saveSettings(); syncCanvasUI(); };
  $("exportCustom").oninput = (e) => { settings.exportCustom = Number(e.target.value) || 3000; saveSettings(); };

  $("saveTemplate").onclick = () => { $("saveRow").classList.toggle("hidden"); $("saveName").focus(); };
  $("confirmSave").onclick = saveAsTemplate;
  $("cancelSave").onclick = () => $("saveRow").classList.add("hidden");
  $("resetLines").onclick = () => { setLayerEdits(state.templateId, null); buildLineEditor(); renderNow(); };
  $("importTemplate").onclick = () => $("fgtFile").click();
  $("fgtFile").onchange = (e) => { const f = e.target.files?.[0]; if (f) importTemplateFile(f); e.target.value = ""; };

  const dz = $("dropzone");
  ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) acceptFiles(e.dataTransfer.files); });
  $("fileInput").onchange = async (e) => {
    if (e.target.files?.length) { await acceptFiles(e.target.files); showEditor(); }
    e.target.value = "";
  };

  wireViewport();

  document.getElementById("settingsBtn").onclick = openSettings;
  document.getElementById("settingsClose").onclick = closeSettings;
  document.getElementById("settingsBackdrop").onclick = closeSettings;
  document.getElementById("setTheme").onchange = (e) => { localStorage.setItem(LS.theme, e.target.value); applyTheme(); };
  document.getElementById("setLang").onchange = (e) => setLang(e.target.value);
  document.getElementById("setExportSize").onchange = (e) => { settings.exportSize = e.target.value; saveSettings(); syncCanvasUI(); };
  document.getElementById("setDefaultFont").onchange = (e) => { settings.fontFamily = e.target.value; saveSettings(); ensureFont(e.target.value); updateTweakUI(); };
  document.getElementById("setDefaultSize").oninput = (e) => {
    settings.defaultFontSize = Number(e.target.value);
    document.getElementById("setSizeVal").textContent = Math.round(settings.defaultFontSize * 100) + "%";
    saveSettings();
  };
  document.getElementById("setDefaultColorOn").onchange = (e) => {
    settings.defaultUseColor = e.target.checked;
    document.getElementById("setDefaultColor").disabled = !e.target.checked;
    saveSettings();
  };
  document.getElementById("setDefaultColor").oninput = (e) => { settings.defaultTextColor = e.target.value; saveSettings(); };
  document.getElementById("setDefaultLogo").onchange = (e) => { settings.showLogo = e.target.checked; saveSettings(); syncCanvasUI(); };
  document.getElementById("setKeepGps").onchange = (e) => { settings.keepGps = e.target.checked; saveSettings(); };
  document.getElementById("setSaveMode").onchange = (e) => { settings.saveMode = e.target.value; saveSettings(); };
  document.getElementById("setChannel").onchange = (e) => { settings.channel = e.target.value; saveSettings(); };
  document.getElementById("aboutCheck").onclick = checkUpdates;
  document.getElementById("clearTweaks").onclick = () => clearScope("tweaks");
  document.getElementById("clearMyTemplates").onclick = () => clearScope("mine");
  document.getElementById("clearAssets").onclick = () => clearScope("assets");
  document.getElementById("clearCache").onclick = () => clearScope("cache");
  document.getElementById("resetAll").onclick = () => clearScope("all");

  document.getElementById("lbClose").onclick = closeLightbox;
  document.getElementById("lbBackdrop").onclick = closeLightbox;
  document.getElementById("lbPrev").onclick = () => navLightbox(-1);
  document.getElementById("lbNext").onclick = () => navLightbox(1);
  document.getElementById("lbApply").onclick = () => { if (lbId) { useTemplate(lbId); closeLightbox(); } };

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") { e.preventDefault(); openSettings(); return; }
    if (e.key === "Escape") { closeLightbox(); closeSettings(); return; }
    if (!document.getElementById("lightbox").classList.contains("hidden")) {
      if (e.key === "ArrowLeft") navLightbox(-1);
      if (e.key === "ArrowRight") navLightbox(1);
    }
  });

  window.addEventListener("fg-lang-changed", () => {
    applyTheme();
    $("langBtn").textContent = t("lang.toggle");
    applyI18n();
    buildTemplatePicker();
    buildLayoutPicker();
    buildWall();
    updateTweakUI();
    buildLineEditor();
    showExif();
    updateBrandDetected();
    syncCanvasUI();
    if (!state.photos.length && state.view === "editor") showTemplatePreview();
  });
}

async function checkUpdates() {
  $("updateBox").classList.remove("hidden");
  $("updateBox").textContent = t("update.checking");
  try {
    const rel = await (await fetch(`https://api.github.com/repos/${CC_REPO}/releases/latest`)).json();
    $("updateBox").innerHTML = `${t("update.latest", { v: rel.tag_name })} · <a href="${rel.html_url}" target="_blank" rel="noreferrer">${t("update.view")}</a>`;
  } catch {
    $("updateBox").textContent = t("update.fail");
  }
}

wire();
boot().catch((e) => setStatus("error", String(e.message || e)));


/* --------------------------------------------------------------- lightbox */
let lbId = null;
function lbList() { return filteredTemplates(); }
function openLightbox(id) {
  lbId = id;
  const list = lbList();
  const tpl = list.find((x) => x.id === id) || { id, name: id, category: "" };
  document.getElementById("lbName").textContent = tplName(tpl);
  document.getElementById("lbCat").textContent = t(`cat.${tpl.category}`) !== `cat.${tpl.category}` ? t(`cat.${tpl.category}`) : (tpl.category ?? "");
  const notice = tpl.notice;
  const noticeEl = document.getElementById("lbNotice");
  noticeEl.textContent = notice ?? "";
  noticeEl.classList.toggle("hidden", !notice);
  const img = document.getElementById("lbImg");
  img.removeAttribute("src");
  (async () => {
    try {
      const res = await fetch(BASE + "previews/" + id + ".jpg");
      if (!res.ok) throw new Error("no preview");
      img.src = URL.createObjectURL(await res.blob());
    } catch {
      if (state.photos.length && state.engine) {
        try {
          const tplJson = await fetchTemplateJson(id);
          const out = state.engine.render_with_overrides(
            state.photos[0].bytes, JSON.stringify(tplJson), "jpeg", false, "", 640, settings.keepGps);
          img.src = URL.createObjectURL(new Blob([out], { type: "image/jpeg" }));
        } catch { /* leave blank */ }
      }
    }
  })();
  withViewTransition(() => document.getElementById("lightbox").classList.remove("hidden"));
}
function closeLightbox() {
  document.getElementById("lightbox").classList.add("hidden");
  lbId = null;
}
function navLightbox(dir) {
  const list = lbList();
  if (!list.length || !lbId) return;
  let i = list.findIndex((x) => x.id === lbId);
  if (i < 0) i = 0;
  openLightbox(list[(i + dir + list.length) % list.length].id);
}

/* --------------------------------------------------------------- settings */
async function storageUsed() {
  try {
    const est = await navigator.storage.estimate();
    return ((est.usage || 0) / 1048576).toFixed(1) + " MB";
  } catch { return "?"; }
}
function openSettings() {
  document.getElementById("setTheme").value = currentTheme();
  document.getElementById("setLang").value = currentLang();
  document.getElementById("setExportSize").value = settings.exportSize;
  const sel = document.getElementById("setDefaultFont");
  sel.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = t("tweak.fontDefault");
  sel.appendChild(def);
  for (const f of state.fonts) {
    const o = document.createElement("option");
    o.value = f.family;
    o.textContent = f.family;
    sel.appendChild(o);
  }
  sel.value = settings.fontFamily ?? "";
  document.getElementById("setDefaultSize").value = settings.defaultFontSize ?? 1;
  document.getElementById("setSizeVal").textContent = Math.round((settings.defaultFontSize ?? 1) * 100) + "%";
  document.getElementById("setDefaultColorOn").checked = !!settings.defaultUseColor;
  document.getElementById("setDefaultColor").value = settings.defaultTextColor ?? "#111111";
  document.getElementById("setDefaultColor").disabled = !settings.defaultUseColor;
  document.getElementById("setDefaultLogo").checked = !!settings.showLogo;
  document.getElementById("setKeepGps").checked = !!settings.keepGps;
  document.getElementById("setSaveMode").value = settings.saveMode ?? "dialog";
  document.getElementById("setChannel").value = settings.channel ?? "stable";
  document.getElementById("desktopSection").classList.toggle("hidden", !IS_TAURI);
  document.getElementById("aboutVersion").textContent = t("settings.version", { v: APP_VERSION });
  storageUsed().then((v) => {
    document.getElementById("storageInfo").textContent = t("settings.storage", { v });
  });
  withViewTransition(() => document.getElementById("settings").classList.remove("hidden"));
}
function closeSettings() { document.getElementById("settings").classList.add("hidden"); }

async function clearScope(name) {
  if (!confirm(t("settings.confirmClear"))) return false;
  try {
    if (name === "tweaks") localStorage.removeItem(LS.overrides);
    if (name === "mine") {
      localStorage.removeItem(LS.userTpl);
      state.userTemplates = [];
      state.templateCache.clear();
      buildTemplatePicker();
    }
    if (name === "assets") {
      await idbDelete("assets", "logo");
      await idbDelete("assets", "background");
      const db = await idb();
      await new Promise((res) => { const tx = db.transaction("fonts", "readwrite"); tx.objectStore("fonts").clear(); tx.oncomplete = res; });
      delete state.customAssets["@user/logo"];
      delete state.customAssets["@user/background"];
      state.userFonts = [];
      updateTweakUI();
    }
    if (name === "cache") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if (name === "all") {
      localStorage.clear();
      const dbs = await indexedDB.databases();
      for (const d of dbs || []) indexedDB.deleteDatabase(d.name);
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      location.reload();
      return true;
    }
    toast("ok", t("settings.cleared", { name }));
    updateTweakUI();
    renderNow();
  } catch (e) {
    toast("error", String(e.message || e));
  }
  return true;
}

// Debug hook for perf/automation.
window.__fg = { state, renderNow, fitStage, showWall, showEditor, useTemplate, buildWall, get engine() { return state.engine; } };

import init, { Engine } from "./pkg/framegeist_wasm.js";
import { initI18n, setLang, t, currentLang, localizeEngineError, applyI18n } from "./i18n.js";
import "./editor.js";

const $ = (id) => document.getElementById(id);
const BASE = new URL(".", document.baseURI).href;
const CC_REPO = "meihuaanying/framegeist";
const IS_TAURI = !!window.__TAURI__;
const APP_VERSION = "0.7.0";

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
  freeCollage: false,
  freeSpec: null,
  templateId: null,
  layoutId: null,
  lastRender: null,
  lastRenderName: null,
  sourceUrl: null,
  brandOverride: "auto",   // auto | none | brand:<slug> | custom
  zoom: { scale: 1, tx: 0, ty: 0, autoFit: true },
  customAssets: {},        // "@user/logo" / "@user/background" -> Uint8Array
  usedNames: new Set(),
  wmSpacing: 0,            // watermark panel letter-spacing delta (editor edit model)
};

const LS = {
  theme: "fg-theme", lang: "fg-lang", overrides: "fg-overrides-v1",
  settings: "fg-settings-v1", lineEdits: "fg-line-edits-v1",
  picker: "fg-picker-mode", userTpl: "fg-user-templates-v1",
  recent: "fg-recent-v1",
};

  const settings = loadJson(LS.settings, {
  aspect: "original", background: "default", bgColor: "#FFFFFF",
  flipH: false, flipV: false, showLogo: true, exportSize: "0",
  // v0.6.0 Q10: export container (jpeg | png | avif | webp).
  exportFormat: "jpeg",
  exportCustom: 3000, fontFamily: "",
  defaultFontSize: 1, defaultUseColor: false, defaultTextColor: "#111111",
  saveMode: "dialog", keepGps: false, channel: "stable", keepMetadata: true,
  margin: 0,
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
  if (settings.margin && settings.margin > 0) out.margin = settings.margin;
  if (settings.flipH) out.flipHorizontal = true;
  if (settings.flipV) out.flipVertical = true;
  out.showLogo = settings.showLogo && state.brandOverride !== "none";
  // v0.7.0 Q6: badge style / position / size / contrast / opacity.
  out.brandStyle = o.brandStyle ?? "official";
  if (o.brandPosition && o.brandPosition !== "anchor") out.brandPosition = o.brandPosition;
  if (o.brandScale && o.brandScale !== 1) out.brandScale = o.brandScale;
  if (o.brandContrast && o.brandContrast !== "auto") out.brandContrast = o.brandContrast;
  if (o.brandOpacity && o.brandOpacity < 1) out.brandOpacity = o.brandOpacity;
  if (settings.keepMetadata === false) out.metadata = false;
  // v0.6.0: localize `date('LOCAL', ...)` captions to the UI language.
  out.dateLocale = currentLang();
  // v0.5.0: crop + editor extras.
  const extra = window.__fgEditor?.editorOverrides?.() ?? {};
  if (extra.crop) out.crop = extra.crop;
  if (extra.card) out.card = extra.card;
  if (extra.exif) out.exif = extra.exif;
  return Object.keys(out).length ? JSON.stringify(out) : "";
}
function exportMaxEdge() {
  const v = settings.exportSize;
  if (v === "custom") return Number(settings.exportCustom) || 0;
  return Number(v) || 0;
}

/* v0.6.0 Q10: export container formats (engine `parse_format` strings).
   The fast-preview path is `render_raw`, which only encodes JPEG by design:
   AVIF/WebP encodes are much slower and previews must stay snappy. So the
   on-screen fast preview stays JPEG, while the final export render (preview
   checkbox off) passes the selected format to `render_with_overrides`. */
const EXPORT_FORMATS = {
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  avif: { ext: "avif", mime: "image/avif" },
  webp: { ext: "webp", mime: "image/webp" },
};
function exportFormat() {
  return EXPORT_FORMATS[settings.exportFormat] ? settings.exportFormat : "jpeg";
}

/* --------------------------------------- background swatches + eyedropper */
// Retro/neutral preset board (v0.5.0 M6) + the app palette's neutrals.
const BG_SWATCHES = [
  "#F5F0E8", "#E8DCC8", "#D9C7A7", "#B8A88A", "#6E6357", "#2E2A26",
  "#FFFFFF", "#F6F6F4", "#F0F0EE", "#E4E4E1", "#17171A",
];
function syncBgSwatches() {
  const box = $("bgSwatches");
  if (!box) return;
  for (const b of box.querySelectorAll(".swatch")) {
    b.classList.toggle("on", (b.dataset.color ?? "").toLowerCase() === (settings.bgColor ?? "").toLowerCase()
      && settings.background === "solid");
  }
}
function buildBgSwatches() {
  const box = $("bgSwatches");
  if (!box) return;
  box.innerHTML = "";
  for (const color of BG_SWATCHES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.dataset.color = color;
    b.style.background = color;
    b.title = t("canvas.swatchTitle");
    b.setAttribute("aria-label", `${t("canvas.swatchTitle")} ${color}`);
    b.onclick = () => {
      settings.bgColor = color;
      settings.background = "solid";
      saveSettings();
      syncCanvasUI();
      renderNow();
    };
    box.appendChild(b);
  }
  syncBgSwatches();
}

// Eyedropper: sample a pixel from the rendered stage image -> solid bg color.
let eyedropperOn = false;
function setEyedropper(on) {
  eyedropperOn = !!on;
  $("bgEyedropper")?.classList.toggle("on", eyedropperOn);
  $("viewport")?.classList.toggle("eyedropper", eyedropperOn);
  const hint = $("eyedropperHint");
  if (hint) {
    hint.textContent = t(eyedropperOn ? "canvas.eyedropperOn" : "canvas.eyedropperHint");
    hint.classList.toggle("hidden", !eyedropperOn);
  }
}
function sampleStagePixel(clientX, clientY) {
  const img = $("canvasWrap")?.querySelector("img");
  if (!img || !img.complete || !img.naturalWidth) return null;
  const r = img.getBoundingClientRect();
  if (!r.width || !r.height || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
  const x = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * img.naturalWidth)));
  const y = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor(((clientY - r.top) / r.height) * img.naturalHeight)));
  try {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    return null;
  }
}
function applyEyedropper(clientX, clientY) {
  const rgb = sampleStagePixel(clientX, clientY);
  if (!rgb) return false;
  const hex = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  settings.background = "solid";
  settings.bgColor = hex;
  saveSettings();
  setEyedropper(false);
  syncCanvasUI();
  renderNow();
  return true;
}

/* ------------------------------------------------------ free collage (v0.5) */
/// Deterministic starter layout: photos placed in a loose 2-column grid with
/// small rotations so the collage reads as hand-placed.
function freeSpecDefault(aspect) {
  const ratio = { "4:3": 4 / 3, "3:2": 3 / 2, "1:1": 1, "16:9": 16 / 9, "9:16": 9 / 16 }[aspect ?? $("freeAspect")?.value ?? "4:3"] ?? 4 / 3;
  const width = ratio >= 1 ? 1600 : Math.round(1600 * ratio);
  const height = ratio >= 1 ? Math.round(1600 / ratio) : 1600;
  const photos = state.photos.length || 1;
  const items = [];
  for (let i = 0; i < photos; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const rows = Math.max(1, Math.ceil(photos / 2));
    const stepY = 1 / rows;
    items.push({
      photo: i,
      x: col === 0 ? 0.3 : 0.7,
      y: (row + 0.5) * stepY,
      w: 0.42,
      rotation: (i % 2 === 0 ? -3 : 3) + (i % 3) * 1.5,
      z: i,
    });
  }
  return { width, height, background: $("freeBg")?.value ?? "#FFFFFF", items };
}
function updateFreeSpec(fn) {
  if (!state.freeSpec) state.freeSpec = freeSpecDefault();
  fn(state.freeSpec);
  renderNow();
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
  // v0.5.0: apply canvas-editor template edits (layers/canvas/frame) first.
  window.__fgEditor?.applyEdits?.(state.templateId, clone);
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
  // v0.7.0 Q2: "original" style switches official marks to typographic lockups.
  const brandStyle = loadOverrides(state.templateId).brandStyle ?? "official";
  if (brandStyle === "original" && state.brandOverride !== "custom") {
    for (const layer of clone.layers ?? []) {
      if (layer.type === "image" && layer.asset.includes("@builtin/brand/")) {
        layer.asset = layer.asset.replace("@builtin/brand/", "@builtin/lockup/");
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

/* ------------------------------------------------------- recent templates */
// v0.5.0: ring buffer of the last applied template ids (most recent first).
const RECENT_MAX = 12;
function recentIds() {
  try { return JSON.parse(localStorage.getItem(LS.recent) ?? "[]").filter((x) => typeof x === "string"); }
  catch { return []; }
}
function recordRecent(id) {
  if (!id) return;
  const next = [id, ...recentIds().filter((x) => x !== id)].slice(0, RECENT_MAX);
  localStorage.setItem(LS.recent, JSON.stringify(next));
}

function filteredTemplates() {
  let all;
  if (activeCat === "mine") {
    all = state.userTemplates.map((u) => ({ id: u.id, name: u.name, category: "user" }));
  } else if (activeCat === "recent") {
    // Recency order is the order of the ring buffer, not the library order.
    const byId = new Map([...state.templates, ...state.userTemplates].map((x) => [x.id, x]));
    all = recentIds().map((id) => byId.get(id)).filter(Boolean);
  } else {
    all = state.templates;
  }
  return all.filter(
    (x) => (activeCat === "all" || activeCat === "mine" || activeCat === "recent" || x.category === activeCat) &&
      (!templateQuery || x.name.toLowerCase().includes(templateQuery) || x.id.includes(templateQuery))
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  if (recentIds().length) mk("recent", t("chip.recent"));
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
    cell.title = `${t(`cat.${tpl.category}`) !== `cat.${tpl.category}` ? t(`cat.${tpl.category}`) : tpl.category} · ${tplName(tpl)}`;
    const src = thumbSrc(tpl);
    const isUser = !src;
    cell.innerHTML = (src
      ? `<img loading="lazy" src="${src}" alt="${escapeHtml(tplName(tpl))}">`
      : `<div style="display:grid;place-items:center;height:100%;background:linear-gradient(135deg,color-mix(in srgb,var(--accent-a) 22%,var(--bg-soft)),color-mix(in srgb,var(--accent-b) 22%,var(--bg-soft)));font-family:var(--font-display)">${escapeHtml(tplName(tpl).slice(0, 14))}</div>`) +
      (isUser ? `<span class="badge">${t("chip.mine")}</span>` : "") +
      `<span class="tname">${escapeHtml(tplName(tpl))}</span>` +
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
  const cat = tpl?.category ?? "";
  $("pinnedCat").textContent = tpl
    ? (t(`cat.${cat}`) !== `cat.${cat}` ? t(`cat.${cat}`) : cat || "user")
    : "";
}
async function selectTemplate(id) {
  state.templateId = id;
  state.wmSpacing = 0;
  recordRecent(id);
  await fetchTemplateJson(id);
  window.__fgEditor?.onTemplateChanged?.();
  buildTemplatePicker();
  updateTweakUI();
  updateWatermarkUI();
  buildLineEditor();
  updateBrandDetected();
  syncBrandUI();
  renderNow();
}

/* ---------------------------------------------------------- template wall */
function showWall() {
  state.view = "wall";
  if (eyedropperOn) setEyedropper(false);
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
  img.onerror = () => {
    wrap.innerHTML = "";
    const meta = state.templates.find((x) => x.id === state.templateId);
    $("stagePlaceholder").textContent = meta ? tplName(meta) : t("stage.placeholder");
    $("stagePlaceholder").classList.remove("hidden");
  };
  wrap.appendChild(img);
  $("stagePlaceholder").classList.add("hidden");
  const meta = state.templates.find((x) => x.id === state.templateId);
  if (meta) $("stageLabel").textContent = tplName(meta);
}
async function useTemplate(id) {
  state.templateId = id;
  state.wmSpacing = 0;
  recordRecent(id);
  await fetchTemplateJson(id);
  window.__fgEditor?.onTemplateChanged?.();
  showEditor();
  buildTemplatePicker();
  updatePinned();
  updateTweakUI();
  updateWatermarkUI();
  buildLineEditor();
  updateBrandDetected();
  syncBrandUI();
  if (state.photos.length) renderNow();
  else showTemplatePreview();
}
/* v0.7.0 Q1: brand elements on the UI display surfaces (wall + lightbox). */
const DEMO_BRAND_STRIP = ["sony", "canon", "nikon", "fujifilm", "leica", "hasselblad", "dji", "apple"];
function renderBrandStrip(el, slugs) {
  if (!el) return;
  el.innerHTML = "";
  for (const slug of (slugs ?? []).slice(0, 8)) {
    const img = document.createElement("img");
    img.src = `./brand/${slug}.png`;
    img.alt = slug;
    img.title = slug;
    img.loading = "lazy";
    el.appendChild(img);
  }
  el.classList.toggle("hidden", !slugs?.length);
}
function templateBrandSlugs(id) {
  const obj = state.templateCache.get(id);
  if (!obj) return DEMO_BRAND_STRIP;
  const slugs = new Set();
  for (const layer of obj.layers ?? []) {
    if (layer.type !== "image") continue;
    const m = /@builtin\/(?:brand|lockup)\/([a-z0-9-]+)/.exec(layer.asset ?? "");
    if (m) slugs.add(m[1]);
  }
  return slugs.size ? [...slugs] : DEMO_BRAND_STRIP;
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
  if (recentIds().length) mk("recent", t("chip.recent"));
  for (const c of CATS) mk(c, t("cat." + c));

  const list = filteredTemplates();
  $("wallCount").textContent = t("wall.count", { n: list.length });
  renderBrandStrip($("wallBrandStrip"), DEMO_BRAND_STRIP);

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
      ? `<img loading="lazy" src="${src}" alt="${escapeHtml(tplName(tpl))}">`
      : `<div style="display:grid;place-items:center;aspect-ratio:3/2;background:linear-gradient(135deg,color-mix(in srgb,var(--accent-a) 22%,var(--bg-soft)),color-mix(in srgb,var(--accent-b) 22%,var(--bg-soft)))">${escapeHtml(tplName(tpl).slice(0, 16))}</div>`) +
      `<div class="wall-name"><b>${escapeHtml(tplName(tpl))}</b><span class="wall-cat"></span></div>` +
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

const SAMPLE_PHOTOS = [
  { file: "sony-a7r3.jpg", key: "samples.sony" },
  { file: "nikon-z6ii.jpg", key: "samples.nikon" },
  { file: "canon-r7.jpg", key: "samples.canon" },
];
async function loadSamplePhoto(file) {
  try {
    const res = await fetch(`./examples/${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await acceptFiles([new File([blob], file, { type: blob.type || "image/jpeg" })]);
  } catch (e) {
    toast("error", `${file}: ${e.message || e}`);
  }
}
function buildSampleRow() {
  const row = $("sampleRow");
  if (!row) return;
  row.innerHTML = "";
  const label = document.createElement("span");
  label.className = "muted";
  label.textContent = t("samples.label");
  row.appendChild(label);
  for (const s of SAMPLE_PHOTOS) {
    const btn = document.createElement("button");
    btn.className = "btn small ghost sample-chip";
    btn.textContent = t(s.key);
    btn.onclick = () => loadSamplePhoto(s.file);
    row.appendChild(btn);
  }
}

/* --------------------------------------------------------------- photos */
/* v0.6.0 (contract Q10): HEIC/HEIF is decoded fully in-browser by a lazily
   imported libheif-js wasm bundle (vendored under web/vendor/libheif/, LGPL-3.0,
   see docs/licenses/ and docs/CREDITS.md). The module is an EXTERNAL file loaded
   via dynamic import() on first HEIC drop: on a first offline visit the import
   fails and we degrade to the err.heicOffline toast. Photos never leave the
   machine (PRD G1). HEIC EXIF is out of scope: probe_exif on the original bytes
   may return null and the converted JPEG carries none. */
const HEIC_RE = /\.(heic|heif)$/i;
const HEIC_MAX_BYTES = 64 * 1024 * 1024;
const HEIC_MAX_PIXELS = 40e6;
let heifModulePromise = null;
async function loadHeifModule() {
  if (!heifModulePromise) {
    heifModulePromise = import("./vendor/libheif/libheif-bundle.mjs")
      .then((mod) => {
        const factory = mod?.default ?? mod;
        const out = typeof factory === "function" ? factory() : factory;
        return out?.then ? out : Promise.resolve(out);
      })
      .then((libheif) => {
        if (!libheif?.HeifDecoder) throw new Error("libheif API missing");
        return libheif;
      })
      .catch((e) => { heifModulePromise = null; throw e; });
  }
  return heifModulePromise;
}
/* Cheap container sniff so junk `.heic` files never load the 2MB module nor
   make the libheif wasm print parse diagnostics to the console. */
function looksLikeHeif(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return false;
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(4) !== "ftyp") return false;
  return /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1|avif|avis|miaf)$/.test(tag(8));
}
async function rgbaToJpeg(imageData, width, height) {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").putImageData(new ImageData(imageData.data, width, height), 0, 0);
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(imageData.data, width, height), 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}
/// Decode one HEIC/HEIF File to a JPEG File. Returns { file, probeBytes } or
/// null (a localized toast has already been shown).
async function heicToJpeg(file) {
  if (file.size > HEIC_MAX_BYTES) { toast("error", t("err.heicTooLarge")); return null; }
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { toast("error", t("err.heic")); return null; }
  if (!looksLikeHeif(bytes)) { toast("error", t("err.heic")); return null; }
  let libheif;
  try {
    libheif = await loadHeifModule();
  } catch {
    toast("error", t("err.heicOffline"));
    return null;
  }
  let image = null;
  try {
    image = new libheif.HeifDecoder().decode(bytes)?.[0] ?? null;
    if (!image) throw new Error("no image");
    const width = image.get_width();
    const height = image.get_height();
    if (width <= 0 || height <= 0) throw new Error("bad dimensions");
    if (width * height >= HEIC_MAX_PIXELS) { toast("error", t("err.heicTooLarge")); return null; }
    const imageData = { data: new Uint8ClampedArray(width * height * 4), width, height };
    await new Promise((resolve, reject) => {
      image.display(imageData, (out) => (out ? resolve() : reject(new Error("display failed"))));
    });
    const blob = await rgbaToJpeg(imageData, width, height);
    if (!blob) throw new Error("encode failed");
    return {
      file: new File([blob], file.name.replace(HEIC_RE, "") + ".jpg", { type: "image/jpeg" }),
      probeBytes: bytes,
    };
  } catch {
    toast("error", t("err.heic"));
    return null;
  } finally {
    try { image?.free?.(); } catch { /* best effort */ }
  }
}
async function acceptFiles(fileList) {
  const files = [...fileList].filter((f) => /image\//.test(f.type) || /\.(jpe?g|png|webp|tiff?|heic|heif)$/i.test(f.name));
  if (!files.length) { toast("error", t("err.decode")); return; }
  const prepared = [];
  for (const f of files) {
    if (HEIC_RE.test(f.name)) {
      const decoded = await heicToJpeg(f);
      if (decoded) prepared.push({ file: decoded.file, name: f.name, probeBytes: decoded.probeBytes });
    } else {
      prepared.push({ file: f, name: f.name });
    }
  }
  if (!prepared.length) return;
  state.photos = [];
  for (const item of prepared) {
    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      let exif = null;
      const probeSrc = item.probeBytes ?? bytes;
      try { exif = JSON.parse(state.engine.probe_exif(probeSrc)); } catch { /* no exif */ }
      if (!exif && item.probeBytes) {
        try { exif = JSON.parse(state.engine.probe_exif(bytes)); } catch { /* no exif */ }
      }
      const photo = { bytes, name: item.name, exif };
      // Free-collage overlay needs the oriented aspect ratio the engine uses.
      try {
        const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
        photo.ar = bmp.height / bmp.width;
        bmp.close?.();
      } catch { /* overlay falls back to a default box height */ }
      state.photos.push(photo);
    } catch (e) {
      toast("error", `${item.name}: ${e.message || e}`);
    }
  }
  if (!state.photos.length) return;
  if (state.freeCollage) state.freeSpec = freeSpecDefault();
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
  window.__fgEditor?.onStage?.(img);
  $("stagePlaceholder").classList.add("hidden");
  if (label) $("stageLabel").textContent = label;
}

/* -------------------------------------------------------------- exif panel */
/* Fuji recipe keys exposed by the engine `exif.get()` (v0.5.0 M2). Rows are
   only emitted for values that are actually present — never fabricated. */
const FUJI_KEYS = [
  ["film_mode", "exif.fuji.film_mode"],
  ["wb_mode", "exif.fuji.wb_mode"],
  ["wb_shift", "exif.fuji.wb_shift"],
  ["dynamic_range", "exif.fuji.dynamic_range"],
  ["highlight_tone", "exif.fuji.highlight_tone"],
  ["shadow_tone", "exif.fuji.shadow_tone"],
  ["color_chrome", "exif.fuji.color_chrome"],
  ["chrome_fx_blue", "exif.fuji.chrome_fx_blue"],
  ["grain", "exif.fuji.grain"],
  ["fuji_sharpness", "exif.fuji.sharpness"],
  ["fuji_saturation", "exif.fuji.saturation"],
  ["fuji_nr", "exif.fuji.nr"],
  ["fuji_clarity", "exif.fuji.clarity"],
  ["fuji_lut1", "exif.fuji.lut1"],
  ["fuji_lut2", "exif.fuji.lut2"],
];
function fujiRows(info) {
  if (!info) return [];
  const rows = [];
  for (const [key, label] of FUJI_KEYS) {
    if (key === "wb_shift") {
      const r = info.wb_shift_r, b = info.wb_shift_b;
      if (r == null && b == null) continue;
      rows.push([label, `${r ?? "0"} / ${b ?? "0"}`]);
      continue;
    }
    const v = info[key];
    if (v === null || v === undefined || v === "") continue;
    rows.push([label, String(v)]);
  }
  return rows;
}
function showExif() {
  const dl = $("exifList");
  dl.innerHTML = "";
  const info = state.photos[0]?.exif;
  if (!info) { $("exifEmpty").classList.remove("hidden"); dl.classList.add("hidden"); hideFujiGroup(); return; }
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
  showFujiGroup(info);
}
function hideFujiGroup() {
  const group = $("fujiGroup");
  if (!group) return;
  group.classList.add("hidden");
  const list = $("fujiList");
  if (list) list.innerHTML = "";
}
function showFujiGroup(info) {
  const group = $("fujiGroup");
  const list = $("fujiList");
  if (!group || !list) return;
  const rows = fujiRows(info);
  list.innerHTML = "";
  for (const [label, val] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = val;
    list.appendChild(dt); list.appendChild(dd);
  }
  group.classList.toggle("hidden", rows.length === 0);
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
  const seenFamilies = new Set();
  for (const f of state.fonts) {
    if (seenFamilies.has(f.family)) continue;
    seenFamilies.add(f.family);
    const opt = document.createElement("option");
    opt.value = f.family; opt.textContent = f.family;
    sel.appendChild(opt);
  }
  sel.value = o.fontFamily || (state.fonts.some((f) => f.family === settings.fontFamily) ? settings.fontFamily : "");
}

async function ensureFont(family) {
  if (!family || state.loadedFonts.has(family)) return;
  // v0.7.0: one family can ship several weight files; register every face so
  // the engine can pick by `font.weight`.
  const metas = state.fonts.filter((f) => f.family === family);
  const user = state.userFonts?.find((f) => f.family === family);
  if (!metas.length && !user) return;
  try {
    for (const meta of metas.length ? metas : [user]) {
      let bytes;
      if (meta.file) {
        const res = await fetch(`${BASE}fonts/engine/${meta.file}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        bytes = new Uint8Array(await res.arrayBuffer());
      } else {
        bytes = meta.bytes instanceof Uint8Array ? meta.bytes : new Uint8Array(meta.bytes);
      }
      state.engine.add_font(family, bytes);
    }
    state.loadedFonts.add(family);
  } catch (e) {
    toast("error", `${t("err.font")}: ${family} (${e.message || e})`);
  }
}

/// v0.7.0: make sure every font family referenced by the template JSON is
/// registered before rendering (CJK faces are lazy and not warmed at boot).
async function ensureTemplateFonts(jsonText) {
  const families = new Set();
  for (const m of String(jsonText).matchAll(/"(?:family|fontFamily)"\s*:\s*\[([^\]]*)\]/g)) {
    for (const q of m[1].matchAll(/"([^"]+)"/g)) families.add(q[1]);
  }
  for (const family of families) await ensureFont(family);
}

/* ------------------------------------------------------ font warmup (v0.6.0) */
/* Contract Q10 「引擎字体离线预缓存」 after boot (first paint done) fetch the
   engine fonts that are not loaded yet, ONE AT A TIME, so the Service Worker
   fetch handler caches every successful GET for offline use. Deliberately NOT
   part of the SW install-time PRECACHE (~15MB would slow first paint). The
   page also writes into CacheStorage directly so fonts warm up even when the
   SW is bypassed/absent (Tauri, first visit, automation). Exposed as
   window.__fg.warmFonts / warmFontsStatus for the E2E gate. */
const FONT_CACHE_PREFIX = "framegeist-";
const fontWarm = {
  status: "idle", engineFonts: 0, loaded: 0, total: 0, done: 0,
  cached: 0, maxInflight: 0, cache: null, startedAt: 0, finishedAt: 0,
};
function warmFontsStatus() { return { ...fontWarm }; }
let fontWarmPromise = null;
function warmEngineFonts() {
  if (fontWarmPromise) return fontWarmPromise;
  fontWarmPromise = (async () => {
    fontWarm.status = "running";
    fontWarm.startedAt = Date.now();
    fontWarm.engineFonts = new Set(state.fonts.filter((f) => !f.lazy).map((f) => f.family)).size;
    fontWarm.loaded = state.loadedFonts.size;
    const candidates = [...new Set(state.fonts.filter((f) => !f.lazy).map((f) => f.family))]
      .filter((family) => !state.loadedFonts.has(family));
    fontWarm.total = candidates.length;
    let cache = null;
    try {
      const keys = await caches.keys();
      const key = keys.find((k) => k.startsWith(FONT_CACHE_PREFIX)) ?? `${FONT_CACHE_PREFIX}0.6.0`;
      cache = await caches.open(key);
      fontWarm.cache = key;
    } catch { /* CacheStorage unavailable: still warm the HTTP cache */ }
    for (const family of candidates) {
      fontWarm.maxInflight = Math.max(fontWarm.maxInflight, 1);
      for (const f of state.fonts.filter((x) => x.family === family && x.file)) {
        try {
          const url = new URL(`fonts/engine/${f.file}`, document.baseURI).href;
          const res = await fetch(url);
          if (res?.ok && cache) {
            await cache.put(new Request(url), res.clone());
            fontWarm.cached++;
          }
        } catch { /* offline: retried on a later visit */ }
      }
      fontWarm.done++;
      await sleep(60); // idle gap: keeps exactly one request in flight
    }
    fontWarm.status = "done";
    fontWarm.finishedAt = Date.now();
  })().catch(() => { fontWarm.status = "done"; });
  return fontWarmPromise;
}
function requestFontWarmup() {
  const run = () => { warmEngineFonts(); };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
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
    let fmt = "jpeg";
    if (state.mode === "frame") {
      await ensureFont(loadOverrides(state.templateId).fontFamily || settings.fontFamily);
      const tpl = effectiveTemplateJson();
      await ensureTemplateFonts(tpl);
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
        // Final render path: honor the selected export container (Q10).
        fmt = exportFormat();
        out = state.engine.render_with_overrides(state.photos[0].bytes, tpl, fmt, false, ojson, exportMaxEdge(), settings.keepGps);
      }
    } else if (state.freeCollage) {
      if (!state.freeSpec) state.freeSpec = freeSpecDefault();
      out = state.engine.render_free_collage(
        state.photos.map((p) => p.bytes),
        JSON.stringify(state.freeSpec),
        "jpeg",
        $("preview").checked,
      );
    } else {
      const lay = await (await fetch(BASE + `layouts/${state.layoutId}.json`)).text();
      out = state.engine.render_collage(state.photos.map((p) => p.bytes), lay, "jpeg", $("preview").checked);
    }
    if (token !== renderToken) return;
    const ms = (performance.now() - t0).toFixed(0);
    state.lastRender = out;
    const ext = EXPORT_FORMATS[fmt].ext;
    state.lastRenderName = state.mode === "frame"
      ? `${stem(state.photos[0].name)}-${state.templateId}.${ext}`
      : state.freeCollage
        ? `framegeist-free-collage.${ext}`
        : `framegeist-collage-${state.layoutId}.${ext}`;
    const url = URL.createObjectURL(new Blob([out], { type: EXPORT_FORMATS[fmt].mime }));
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
    try { vp.setPointerCapture(e.pointerId); } catch { /* synthetic/stale pointer */ }
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
  // v0.5.0: double-click on the photo enters crop; elsewhere it keeps fit.
  vp.addEventListener("dblclick", (e) => {
    if (window.__fgEditor?.onStageDblClick?.(e)) return;
    fitStage();
  });
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
  // v0.6.0: metadata transparency before the file hits the disk.
  toast("info", settings.keepMetadata === false
    ? t("export.metaStripped")
    : settings.keepGps ? t("export.metaGps") : t("export.metaKept"));
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
      const fmt = exportFormat();
      const out = state.engine.render_with_overrides(photos[i].bytes, tpl, fmt, false, ojson, exportMaxEdge(), settings.keepGps);
      const name = uniqueName(`${stem(photos[i].name)}-${state.templateId}.${EXPORT_FORMATS[fmt].ext}`);
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
  buildBgSwatches();
  buildSampleRow();
  updateTweakUI();
  buildLineEditor();
  showExif();
  updateBrandDetected();
  syncCanvasUI();
  showWall();
  setStatus("ready", t("status.ready"));
  window.__bootMs = Math.round(performance.now());
  requestFontWarmup();
}

function syncCanvasUI() {
  $("aspectSelect").value = settings.aspect;
  $("bgSelect").value = settings.background;
  $("bgColor").value = settings.bgColor;
  const margin = Number(settings.margin) || 0;
  $("marginRange").value = margin;
  $("marginVal").textContent = `${Math.round(margin * 100)}%`;
  syncBgSwatches();
  $("flipH").classList.toggle("on", settings.flipH);
  $("flipV").classList.toggle("on", settings.flipV);
  $("brandShow").checked = settings.showLogo;
  syncBrandUI();
  $("exportSize").value = settings.exportSize;
  $("exportFormat").value = exportFormat();
  $("exportBtn").textContent = `${t("btn.export")} ${exportFormat().toUpperCase()}`;
  $("exportBatchBtn").textContent = t("btn.exportBatch", { n: state.photos.length });
  $("exportCustom").classList.toggle("hidden", settings.exportSize !== "custom");
  $("exportCustom").value = settings.exportCustom;
  $("pickerCompact").classList.toggle("on", pickerMode === "compact");
  $("pickerLarge").classList.toggle("on", pickerMode === "large");
}

/// v0.7.0 Q6: sync the enhanced brand panel from per-template overrides.
function syncBrandUI() {
  const o = state.mode === "frame" && state.templateId ? loadOverrides(state.templateId) : {};
  $("brandStyle").value = o.brandStyle ?? "official";
  $("brandPos").value = o.brandPosition ?? "anchor";
  $("brandSize").value = String(o.brandScale ?? 1);
  $("brandContrast").value = o.brandContrast ?? "auto";
  $("brandOpacity").value = String(o.brandOpacity ?? 1);
  $("brandOpacityVal").textContent = `${Math.round((o.brandOpacity ?? 1) * 100)}%`;
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

/* ------------------------------------------------------ watermark panel */
function templateCategory() {
  return currentTemplateObject()?.meta?.category ?? "";
}
function syncCardVisibility() {
  const frame = state.mode === "frame";
  const freeCollage = state.mode === "collage" && state.freeCollage;
  for (const id of ["layersCard", "insertCard", "propsCard", "frameCard", "cardFxCard"]) {
    $(id)?.classList.toggle("hidden", !frame);
  }
  // Crop works in frame mode and on a selected free-collage item (v0.5.0).
  $("cropCard")?.classList.toggle("hidden", !(frame || freeCollage));
  $("watermarkCard")?.classList.toggle("hidden", !frame || templateCategory() !== "classic-watermark");
}
function updateWatermarkUI() {
  const card = $("watermarkCard");
  if (!card) return;
  const o = state.templateId ? loadOverrides(state.templateId) : {};
  $("wmSize").value = o.fontSizeScale ?? 1;
  $("wmSizeVal").textContent = `${Math.round((o.fontSizeScale ?? 1) * 100)}%`;
  $("wmPad").value = o.paddingScale ?? 1;
  $("wmPadVal").textContent = `${Math.round((o.paddingScale ?? 1) * 100)}%`;
  $("wmSpacing").value = state.wmSpacing ?? 0;
  $("wmSpacingVal").textContent = Number(state.wmSpacing ?? 0).toFixed(2);
  syncCardVisibility();
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
    syncCardVisibility();
  });
  window.__fgEditor?.onModeChanged?.(mode);
  renderNow();
}

/* ------------------------------------------------------------------ wire */
function wire() {
  $("modeFrame").onclick = () => switchMode("frame");
  $("modeCollage").onclick = () => switchMode("collage");
  $("freeMode").onchange = (e) => {
    state.freeCollage = e.target.checked;
    $("freePanel").classList.toggle("hidden", !state.freeCollage);
    $("layoutPicker").classList.toggle("hidden", state.freeCollage);
    if (state.freeCollage && !state.freeSpec) state.freeSpec = freeSpecDefault();
    syncCardVisibility();
    window.__fgEditor?.onModeChanged?.("collage");
    renderNow();
  };
  $("freeAspect").onchange = () => { state.freeSpec = freeSpecDefault(); window.__fgEditor?.onModeChanged?.("collage"); renderNow(); };
  $("freeBg").oninput = (e) => {
    if (!state.freeSpec) state.freeSpec = freeSpecDefault();
    state.freeSpec.background = e.target.value;
    renderNow();
  };
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

  // v0.5.0 watermark adjust panel (classic-watermark templates).
  $("wmSize").oninput = (e) => { pushOverride({ fontSizeScale: Number(e.target.value) }); updateWatermarkUI(); };
  $("wmSize").onchange = () => renderNow();
  $("wmPad").oninput = (e) => { pushOverride({ paddingScale: Number(e.target.value) }); updateWatermarkUI(); };
  $("wmPad").onchange = () => renderNow();
  $("wmSpacing").oninput = (e) => {
    state.wmSpacing = Number(e.target.value) || 0;
    $("wmSpacingVal").textContent = Number(state.wmSpacing).toFixed(2);
    window.__fgEditor?.applyWatermarkSpacing?.(state.wmSpacing);
  };
  $("wmSelectFirst").onclick = () => window.__fgEditor?.selectFirstText?.();

  $("aspectSelect").onchange = (e) => { settings.aspect = e.target.value; saveSettings(); renderNow(); };
  $("bgSelect").onchange = (e) => { settings.background = e.target.value; saveSettings(); syncBgSwatches(); renderNow(); };
  $("bgColor").oninput = (e) => { settings.bgColor = e.target.value; saveSettings(); syncBgSwatches(); if (settings.background === "default" || settings.background === "solid") renderNow(); };
  $("marginRange").oninput = (e) => {
    settings.margin = Number(e.target.value) || 0;
    $("marginVal").textContent = `${Math.round(settings.margin * 100)}%`;
    saveSettings();
  };
  $("marginRange").onchange = () => renderNow();
  $("bgEyedropper").onclick = () => setEyedropper(!eyedropperOn);
  $("viewport").addEventListener("pointerdown", (e) => {
    if (!eyedropperOn) return;
    e.stopImmediatePropagation();
  }, true);
  $("viewport").addEventListener("click", (e) => {
    if (!eyedropperOn) return;
    e.preventDefault();
    e.stopPropagation();
    applyEyedropper(e.clientX, e.clientY);
  });
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
    settings.margin = 0;
    saveSettings(); syncCanvasUI(); renderNow();
  };

  $("brandShow").onchange = (e) => { settings.showLogo = e.target.checked; saveSettings(); renderNow(); };
  $("brandAuto").onclick = () => { state.brandOverride = "auto"; buildBrandGrid(); renderNow(); };
  $("brandNone").onclick = () => { state.brandOverride = "none"; buildBrandGrid(); renderNow(); };
  const brandPatch = (patch) => { pushOverride(patch); syncBrandUI(); renderNow(); };
  $("brandStyle").onchange = (e) => brandPatch({ brandStyle: e.target.value });
  $("brandPos").onchange = (e) => brandPatch({ brandPosition: e.target.value });
  $("brandSize").onchange = (e) => brandPatch({ brandScale: Number(e.target.value) });
  $("brandContrast").onchange = (e) => brandPatch({ brandContrast: e.target.value });
  $("brandOpacity").oninput = (e) => {
    pushOverride({ brandOpacity: Number(e.target.value) });
    $("brandOpacityVal").textContent = `${Math.round(Number(e.target.value) * 100)}%`;
    renderNow();
  };
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
  // Q10: re-render so the next export uses the selected container.
  $("exportFormat").onchange = (e) => { settings.exportFormat = e.target.value; saveSettings(); syncCanvasUI(); renderNow(); };
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
  document.getElementById("setExportFormat").onchange = (e) => { settings.exportFormat = e.target.value; saveSettings(); syncCanvasUI(); renderNow(); };
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
  document.getElementById("setKeepMetadata").onchange = (e) => { settings.keepMetadata = e.target.checked; saveSettings(); renderNow(); };
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
    if (e.key === "Escape") {
      if (eyedropperOn) { setEyedropper(false); return; }
      closeLightbox(); closeSettings(); return;
    }
    if (!document.getElementById("lightbox").classList.contains("hidden")) {
      if (e.key === "ArrowLeft") navLightbox(-1);
      if (e.key === "ArrowRight") navLightbox(1);
    }
  });

  window.addEventListener("fg-lang-changed", () => {
    applyTheme();
    $("langBtn").textContent = t("lang.toggle");
    applyI18n();
    buildBgSwatches();
    buildSampleRow();
    buildTemplatePicker();
    buildLayoutPicker();
    buildWall();
    updateTweakUI();
    updateWatermarkUI();
    buildLineEditor();
    showExif();
    updateBrandDetected();
    syncCanvasUI();
    if (!state.photos.length && state.view === "editor") showTemplatePreview();
    else if (state.photos.length && state.view === "editor") renderNow();
  });
}

async function checkUpdates() {
  $("updateBox").classList.remove("hidden");
  $("updateBox").textContent = t("update.checking");
  try {
    const rel = await (await fetch(`https://api.github.com/repos/${CC_REPO}/releases/latest`)).json();
    $("updateBox").innerHTML = `${t("update.latest", { v: escapeHtml(rel.tag_name) })} · <a href="${escapeHtml(rel.html_url)}" target="_blank" rel="noreferrer">${t("update.view")}</a>`;
  } catch {
    $("updateBox").textContent = t("update.fail");
  }
}

wire();
boot().catch((e) => setStatus("error", String(e.message || e)));

/* PWA offline shell (PRD G4): register only on the real web origin,
   never inside the Tauri shell (it self-destructs there anyway). */
if ("serviceWorker" in navigator
  && /^https?:$/.test(location.protocol)
  && !location.hostname.endsWith("tauri.localhost")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}


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
  renderBrandStrip(document.getElementById("lbBrand"), templateBrandSlugs(id));
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
  document.getElementById("setExportFormat").value = exportFormat();
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
  document.getElementById("setKeepMetadata").checked = settings.keepMetadata !== false;
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
window.__fg = {
  state, renderNow, fitStage, showWall, showEditor, useTemplate, buildWall, toast, t,
  currentTemplateObject, effectiveTemplateJson, buildOverridesJson,
  loadOverrides, pushOverride, syncBrandUI, syncCanvasUI,
  openLightbox, closeLightbox,
  freeActive: () => state.freeCollage,
  freeSpec: () => state.freeSpec,
  updateFreeSpec,
  freeSpecDefault,
  recentIds,
  fujiRows,
  templateCategory,
  get engine() { return state.engine; },
  // v0.6.0: HEIC lazy decoder + engine font offline warmup probes.
  loadHeifModule,
  warmFonts: warmEngineFonts,
  warmFontsStatus,
};

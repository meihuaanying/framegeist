// v0.5.0 editor module: layer selection, direct manipulation with snapping,
// layers panel, undo/redo, text style presets, crop and frame tools.
// Loaded as a side-effect module by app.js; exposes window.__fgEditor and
// reaches the app through window.__fg (assigned by app.js before boot).
const LS_TPLEDITS = "fg-tpl-edits-v1";
const LS_UI = "fg-tpl-ui-v1";
const MAX_HISTORY = 60;
const COALESCE_MS = 700;

const S = {
  img: null,
  boxes: [],
  boxFrame: null,  // v0.9.4: canvas frame the boxes are in ({w,h})
  selected: new Set(),
  cropMode: false,
  cropAspect: "free",
  cropTarget: "frame",   // frame (overrides.crop) | free (item.crop)
  cropContainer: null,   // local crop coordinate box (px) while cropping
  drag: null,
  freeSel: null,
  freeSelB: null,        // shift-click second free item (swap)
  freeDrag: null,
  history: {},   // id -> { stack: [json], index }
  ui: {},        // id -> { hidden: [], locked: [], crop, frame }
};

const fg = () => window.__fg;
const t = (k, v) => (fg()?.t ? fg().t(k, v) : k);
/** Diagnostics ring buffer: only records with `?debug` in the URL (E2E/troubleshooting). */
const TRACE_ON = /[?&]debug\b/.test(location.search);
const TRACE = [];
function trace(...args) {
  if (!TRACE_ON) return;
  TRACE.push(args.join(" "));
  if (TRACE.length > 200) TRACE.shift();
}

/** Render via the app, swallowing errors so one bad state cannot hang the UI. */
function safeRender() {
  try {
    const p = fg()?.renderNow?.();
    if (p && typeof p.catch === "function") p.catch((e) => console.error("render:", e));
  } catch (e) {
    console.error("render:", e);
  }
}

function loadStore() {
  try { S.ui = JSON.parse(localStorage.getItem(LS_UI) ?? "{}"); } catch { S.ui = {}; }
}
function saveUi() { localStorage.setItem(LS_UI, JSON.stringify(S.ui)); }
function uiOf(id) {
  if (!S.ui[id]) S.ui[id] = { hidden: [], locked: [], crop: null, frame: null, card: null, labels: {}, exifPreview: null };
  const u = S.ui[id];
  u.hidden ??= []; u.locked ??= []; u.labels ??= {};
  if (u.card === undefined) u.card = null;
  if (u.exifPreview === undefined) u.exifPreview = null;
  return u;
}
function loadEdits() {
  try { return JSON.parse(localStorage.getItem(LS_TPLEDITS) ?? "{}"); } catch { return {}; }
}
function saveEdits(store) { localStorage.setItem(LS_TPLEDITS, JSON.stringify(store)); }

/** Base template JSON for the current template: local edits or original. */
function baseTemplate() {
  const id = fg()?.state?.templateId;
  if (!id) return null;
  const edits = loadEdits();
  if (edits[id]) { try { return JSON.parse(edits[id]); } catch { /* fall */ } }
  const orig = fg().currentTemplateObject();
  return orig ? structuredClone(orig) : null;
}

/** Mutate template: live update + optional history + re-render. */
function edit(mutator, { history = true, silent = false } = {}) {
  const id = fg()?.state?.templateId;
  const tpl = baseTemplate();
  if (!id || !tpl) return;
  const before = JSON.stringify(tpl);
  mutator(tpl);
  const json = JSON.stringify(tpl);
  const store = loadEdits();
  store[id] = json;
  saveEdits(store);
  if (!S.history[id]) S.history[id] = { stack: [before], index: 0 };
  if (history) pushHistory(id, json, true);
  if (!silent) {
    buildLayersPanel();
    buildPropsPanel();
    safeRender();
  }
}

function pushHistory(id, json, coalesce = false) {
  trace("push", id, "coalesce=" + coalesce);
  let h = S.history[id];
  if (!h) h = S.history[id] = { stack: [json], index: 0 };
  if (coalesce && h.stack[h.index] && Date.now() - (h.lastAt ?? 0) < COALESCE_MS && h.index > 0) {
    h.stack[h.index] = json;
    h.lastAt = Date.now();
    updateUndoButtons();
    return;
  }
  h.stack = h.stack.slice(0, h.index + 1);
  h.stack.push(json);
  if (h.stack.length > MAX_HISTORY) h.stack.shift();
  h.index = h.stack.length - 1;
  h.lastAt = Date.now();
  updateUndoButtons();
}

function undo() {
  trace("undo", fg()?.state?.templateId);
  const id = fg()?.state?.templateId;
  const h = S.history[id];
  if (!h || h.index <= 0) return;
  h.index -= 1;
  applyHistoryJson(id, h.stack[h.index]);
}
function redo() {
  const id = fg()?.state?.templateId;
  const h = S.history[id];
  if (!h || h.index >= h.stack.length - 1) return;
  h.index += 1;
  applyHistoryJson(id, h.stack[h.index]);
}
function applyHistoryJson(id, json) {
  const store = loadEdits();
  store[id] = json;
  saveEdits(store);
  updateUndoButtons();
  buildLayersPanel();
  buildPropsPanel();
  safeRender();
}
function updateUndoButtons() {
  const id = fg()?.state?.templateId;
  const h = S.history[id];
  const u = document.getElementById("editUndo");
  const r = document.getElementById("editRedo");
  if (u) u.disabled = !h || h.index <= 0;
  if (r) r.disabled = !h || h.index >= h.stack.length - 1;
}

/* ------------------------------------------------------------------ hooks */

/** Called by app.js inside effectiveTemplateJson(). */
function applyEdits(id, clone) {
  const edits = loadEdits();
  if (edits[id]) {
    try {
      const edited = JSON.parse(edits[id]);
      if (edited.layers) clone.layers = edited.layers;
      if (edited.canvas) clone.canvas = edited.canvas;
    } catch { /* ignore */ }
  }
  const u = uiOf(id);
  if (u.hidden.length) filterHidden(clone.layers ?? [], new Set(u.hidden));
  return clone;
}
function filterHidden(layers, hidden) {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (hidden.has(layers[i].id)) layers.splice(i, 1);
    else if (layers[i].type === "group") filterHidden(layers[i].children ?? [], hidden);
  }
}

const CARD_DEFAULTS = { radius: 0.06, blur: 0.12, opacity: 0.35, offsetX: 0.01, offsetY: 0.02, borderWidth: 0, borderColor: "#FFFFFF", innerBlur: 0.1, innerOpacity: 0.3 };

/** Overrides extras (crop + card) merged by app.js. */
function editorOverrides() {
  const id = fg()?.state?.templateId;
  const out = {};
  const u = id ? uiOf(id) : null;
  if (u?.crop) out.crop = u.crop;
  if (u?.exifPreview) out.exif = u.exifPreview;
  const card = u?.card;
  // Card is only sent while enabled (engine defaults otherwise keep template
  // canvas radius/shadow untouched).
  if (card?.on) {
    const o = { enabled: true };
    o.radius = card.radius ?? CARD_DEFAULTS.radius;
    if (card.shadowOn !== false) {
      o.shadow = {
        enabled: true,
        blur: card.blur ?? CARD_DEFAULTS.blur,
        opacity: card.opacity ?? CARD_DEFAULTS.opacity,
        offsetX: card.offsetX ?? CARD_DEFAULTS.offsetX,
        offsetY: card.offsetY ?? CARD_DEFAULTS.offsetY,
      };
    }
    const width = card.borderWidth ?? 0;
    if (width > 0) o.border = { width, color: card.borderColor || "#FFFFFF" };
    if (card.innerOn) {
      o.innerShadow = {
        enabled: true,
        blur: card.innerBlur ?? CARD_DEFAULTS.innerBlur,
        opacity: card.innerOpacity ?? CARD_DEFAULTS.innerOpacity,
      };
    }
    out.card = o;
  }
  return out;
}

/* --------------------------------------------------------------- layers UI */
function layerLabel(layer) {
  // Display-name override lives in the per-template UI store so the engine
  // template structure (and the layer id) stays untouched.
  const tid = fg()?.state?.templateId;
  if (tid && uiOf(tid).labels[layer.id]) return uiOf(tid).labels[layer.id];
  if (layer.type === "image" && BADGE_ASSET_RE.test(layer.asset ?? "")) {
    const m = /@(?:builtin\/(?:brand|lockup|series|game)|user)\/([a-z0-9-]+)/.exec(layer.asset ?? "");
    if (m && !m[1].startsWith("{")) {
      const label = fg()?.brandLabel?.(m[1]) ?? m[1];
      return `${t("layer.role.badge")} · ${label}`;
    }
    return t("layer.role.badge");
  }
  return layerRoleName(layer) ?? layer.id;
}
/// v0.9.0: localized role-based display name (raw content stays in the title).
function layerRoleName(layer) {
  switch (layer.type) {
    case "group": return t("layer.role.group");
    case "shape": return layer.shape === "line" ? t("layer.role.divider") : t("layer.role.shape");
    case "palette": return t("layer.role.palette");
    case "calendar": return t("layer.role.calendar");
    case "image": return t("layer.role.image");
    case "text": return textRoleName(layer);
    default: return null;
  }
}
function textRoleName(layer) {
  const text = (layer.content ?? []).map((i) => `${i.expr ?? ""} ${i.fallback ?? ""}`).join(" ");
  if (/exif\.fuji/.test(text)) return t("layer.role.fuji");
  if (/\bexif\.(model|model_pretty)\b/.test(text)) return t("layer.role.model");
  if (/\bexif\.lens\b/.test(text)) return t("layer.role.lens");
  if (/date\(|\bexif\.datetime\b/.test(text)) return t("layer.role.date");
  if (/\bexif\.(focal|aperture|shutter|iso)\b|fmt\(/.test(text)) return t("layer.role.params");
  if (/\bexif\.(gps|weekday)/.test(text)) return t("layer.role.info");
  return t("layer.role.text");
}
function allLayers(layers, out = [], depth = 0) {
  for (const l of layers) {
    out.push({ layer: l, depth });
    if (l.type === "group") allLayers(l.children ?? [], out, depth + 1);
  }
  return out;
}
/* ------------------------------------------------ badge library hooks (v0.8) */
const BADGE_ASSET_RE = /@(?:builtin\/(?:brand|lockup|series|game)|user)\//;
function isBadgeLayer(layer) {
  return layer?.type === "image" && BADGE_ASSET_RE.test(layer.asset ?? "");
}
/** Target layer for library replacement: selected badge layer, else the first
 *  badge layer of the template. Returns null when the template has none. */
function badgeTarget() {
  const tpl = baseTemplate();
  if (!tpl) return null;
  const all = allLayers(tpl.layers ?? []).map((x) => x.layer);
  const selected = all.find((l) => S.selected.has(l.id) && isBadgeLayer(l));
  const first = all.find(isBadgeLayer);
  const layer = selected ?? first;
  if (!layer) return null;
  const label = isBadgeLayer(layer) ? t("brandLib.targetBadge") : layerLabel(layer);
  return { id: layer.id, asset: layer.asset, label, selected: layer === selected };
}
/** Replace the target badge layer asset. `asset === "auto"` restores the
 *  original asset from the unedited template (expression form). */
function setBadgeAsset(asset) {
  const target = badgeTarget();
  if (!target) return false;
  let next = asset;
  if (asset === "auto") {
    const orig = fg()?.currentTemplateObject?.();
    const origLayer = orig ? allLayers(orig.layers ?? []).map((x) => x.layer).find((l) => l.id === target.id) : null;
    next = origLayer?.asset ?? target.asset;
  }
  edit((tpl) => {
    const hit = allLayers(tpl.layers ?? []).map((x) => x.layer).find((l) => l.id === target.id);
    if (hit) hit.asset = next;
  });
  return true;
}
/** Rewrite concrete badge assets between brand and lockup when the global
 *  style switches (expressions are rewritten at render time by app.js). */
function swapBadgeStyle(style) {
  const tpl = baseTemplate();
  if (!tpl) return false;
  let changed = false;
  for (const { layer } of allLayers(tpl.layers ?? [])) {
    if (layer.type !== "image" || !layer.asset) continue;
    if (style === "original" && layer.asset.startsWith("@builtin/brand/")) {
      layer.asset = layer.asset.replace("@builtin/brand/", "@builtin/lockup/");
      changed = true;
    } else if (style === "official" && layer.asset.startsWith("@builtin/lockup/")) {
      layer.asset = layer.asset.replace("@builtin/lockup/", "@builtin/brand/");
      changed = true;
    }
  }
  if (changed) {
    const json = JSON.stringify(tpl);
    const store = loadEdits();
    store[fg().state.templateId] = json;
    saveEdits(store);
    buildLayersPanel();
    buildPropsPanel();
    safeRender();
  }
  return changed;
}
function findLayer(id, layers = null, parent = null) {
  const list = layers ?? baseTemplate()?.layers ?? [];
  for (const l of list) {
    if (l.id === id) return { layer: l, list, parent };
    if (l.type === "group") {
      const hit = findLayer(id, l.children ?? [], l);
      if (hit) return hit;
    }
  }
  return null;
}
function buildLayersPanel() {
  const box = document.getElementById("layerList");
  if (!box) return;
  const tpl = baseTemplate();
  box.innerHTML = "";
  if (!tpl) { syncLayerButtons(); return; }
  const u = uiOf(fg().state.templateId);
  for (const { layer, depth } of allLayers(tpl.layers ?? [])) {
    const row = document.createElement("div");
    row.className = "layer-row" + (S.selected.has(layer.id) ? " on" : "") + (u.hidden.includes(layer.id) ? " hidden-layer" : "");
    row.dataset.id = layer.id;
    row.dataset.type = layer.type;
    const indent = depth ? `<span class="indent" style="margin-left:${depth * 10}px"></span>` : "";
    const typeLabel = t(`layer.type.${layer.type}`) !== `layer.type.${layer.type}` ? t(`layer.type.${layer.type}`) : layer.type;
    row.innerHTML = `${indent}<span class="lname">${escapeHtml(layerLabel(layer))}</span><span class="ltag">${escapeHtml(typeLabel)}</span>
      <button data-act="eye" title="${escapeHtml(t("layer.toggleVisible"))}">${u.hidden.includes(layer.id) ? "◌" : "◉"}</button>
      <button data-act="lock" title="${escapeHtml(t("layer.lock"))}">${u.locked.includes(layer.id) ? "🔒" : "🔓"}</button>`;
    row.onclick = (e) => {
      trace("rowclick", layer.id, "target=" + (e.target?.tagName ?? "?"));
      const act = e.target?.dataset?.act;
      if (act === "eye") { toggleHidden(layer.id); e.stopPropagation(); return; }
      if (act === "lock") { toggleLocked(layer.id); e.stopPropagation(); return; }
      select(layer.id, e.shiftKey);
    };
    const nameEl = row.querySelector(".lname");
    nameEl.title = `${t("layers.rename")} · ${layer.id}`;
    nameEl.ondblclick = (e) => { e.stopPropagation(); beginRename(layer, nameEl); };
    box.appendChild(row);
  }
  syncLayerButtons();
}
/** v0.5.0: inline rename on double-click; override is stored in the UI store. */
function beginRename(layer, span) {
  if (span.dataset.editing) return;
  span.dataset.editing = "1";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "lname-input";
  input.value = span.textContent;
  input.maxLength = 40;
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    const u = uiOf(fg().state.templateId);
    const name = save ? input.value.trim() : "";
    if (name) u.labels[layer.id] = name;
    else delete u.labels[layer.id];
    saveUi();
    buildLayersPanel();
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    else if (e.key === "Escape") { e.preventDefault(); commit(false); }
  };
  input.onblur = () => commit(true);
  input.onclick = (e) => e.stopPropagation();
  input.ondblclick = (e) => e.stopPropagation();
  input.onpointerdown = (e) => e.stopPropagation();
}
/** Enable/disable the layer-level command buttons for the current selection. */
function syncLayerButtons() {
  const sel = selectedLayers();
  const groups = sel.filter(({ layer }) => layer.type === "group").length;
  const boxable = sel.filter(({ layer }) => layer.type !== "group").length;
  const ungroup = document.getElementById("layerUngroup");
  if (ungroup) ungroup.disabled = groups === 0;
  for (const id of ["alignLeft", "alignCenterH", "alignRight", "alignTop", "alignMiddleV", "alignBottom", "distributeH", "distributeV"]) {
    const b = document.getElementById(id);
    if (b) b.disabled = boxable < 2;
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toggleHidden(id) {
  const u = uiOf(fg().state.templateId);
  u.hidden = u.hidden.includes(id) ? u.hidden.filter((x) => x !== id) : [...u.hidden, id];
  saveUi();
  buildLayersPanel();
  safeRender();
}
function toggleLocked(id) {
  const u = uiOf(fg().state.templateId);
  u.locked = u.locked.includes(id) ? u.locked.filter((x) => x !== id) : [...u.locked, id];
  saveUi();
  buildLayersPanel();
}

/* ------------------------------------------------------------ selection UI */
function select(id, additive = false) {
  trace("select", id, "additive=" + additive);
  if (!additive) S.selected.clear();
  if (S.selected.has(id)) S.selected.delete(id);
  else S.selected.add(id);
  buildLayersPanel();
  buildPropsPanel();
  drawOverlay();
  // v0.9.4: no automatic panning on selection — the canvas must not jump.
  // The manual「定位到选中」button (locateSelected) is the explicit fallback.
}
function selectedLayers() {
  return [...S.selected].map((id) => findLayer(id)).filter(Boolean);
}

/* ------------------------------------------------------------ direct manip */
function boxesById() {
  const map = new Map();
  const walk = (list) => {
    for (const b of list) {
      map.set(b.id, b);
      if (b.children) walk(b.children);
    }
  };
  walk(S.boxes);
  return map;
}
async function refreshBoxes() {
  const st = fg()?.state;
  if (!st?.engine || !st.photos.length || st.mode !== "frame") { S.boxes = []; S.boxFrame = null; return; }
  try {
    // v0.9.4: boxes must be computed for the frame the editor is displaying
    // (preview cap or export max edge) — one call returns frame + boxes.
    const res = JSON.parse(st.engine.layer_boxes(
      st.photos[0].bytes,
      fg().effectiveTemplateJson(),
      fg().buildOverridesJson(),
      fg().displayMaxEdge(),
    ));
    S.boxes = Array.isArray(res?.boxes) ? res.boxes : [];
    S.boxFrame = Array.isArray(res?.frame) ? { w: res.frame[0], h: res.frame[1] } : null;
  } catch {
    S.boxes = [];
    S.boxFrame = null;
  }
}

function ensureOverlay() {
  const wrap = document.getElementById("canvasWrap");
  if (!wrap) return null;
  let ov = wrap.querySelector(".edit-overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.className = "edit-overlay";
    wrap.appendChild(ov);
    bindOverlayPointer(ov);
  }
  return ov;
}
/** Handles + crop-rect drags. v0.9.4: the overlay is created once and survives
 *  re-renders (setStage no longer clears canvasWrap), so this binds once. */
function bindOverlayPointer(overlay) {
  overlay.addEventListener("pointerdown", (e) => {
    const h = e.target.closest(".handle");
    if (h) {
      if (h.dataset.free != null) beginFreeDrag(h.dataset.kind === "rot" ? "rot" : "scale", Number(h.dataset.free), e);
      else beginDrag(h.dataset.kind === "rot" ? "rot" : "scale", h.dataset.id, e);
      return;
    }
    const crop = e.target.closest(".crop-rect");
    if (crop) beginCropDrag(e, crop);
  });
}
/* v0.9.4: the stage <img> is reused across renders (double-buffered setStage),
   so ask the DOM for the live element instead of trusting a cached reference.
   During a frame swap `naturalWidth` is briefly 0 while the old image stays
   painted; the layout box (offsetWidth/Height) is the geometry actually shown,
   and S.boxFrame still describes the painted frame until refreshBoxes runs. */
function stageImg() {
  return document.querySelector("#canvasWrap img") ?? S.img;
}
function imgRect() {
  const img = stageImg();
  if (!img || !img.isConnected) return null;
  const w = img.offsetWidth, h = img.offsetHeight;
  if (!w || !h) return null;
  const f = S.boxFrame;
  const nw = f?.w ?? img.naturalWidth, nh = f?.h ?? img.naturalHeight;
  if (!nw || !nh) return null;
  return { left: img.offsetLeft, top: img.offsetTop, width: w, height: h, nw, nh };
}
/// v0.9.4: right after photos are injected the stage briefly shows the
/// unrendered source photo (`showSource()`) while S.boxes still describe the
/// rendered frame. Overlay, hit tests and locate are only meaningful when the
/// displayed image IS the frame the boxes were computed for.
function stageMatchesFrame() {
  const img = stageImg();
  if (!img || !img.isConnected || !img.naturalWidth) return false;
  // v0.9.4: in free-collage mode the canvas is the free spec, not the template
  // frame (`layer_boxes` does not apply → S.boxFrame stays null there). The raw
  // flag can stay set after switching back to a frame template, so gate it on
  // the active mode (same semantics as the render path's freeCollage check).
  const st = fg()?.state;
  if (st?.mode === "collage" && st.freeCollage) {
    const spec = fg()?.freeSpec?.();
    return !!(spec && img.naturalWidth === spec.width && img.naturalHeight === spec.height);
  }
  const f = S.boxFrame;
  return !!(f && img.naturalWidth === f.w && img.naturalHeight === f.h);
}
/// v0.9.3: engine canvas frame (w,h). The stage image may still show the
/// unrendered source photo (different pixel size), so ask the engine first.
/// v0.9.4: prefer the frame that came back with the boxes (same decode).
function canvasFrame() {
  if (S.boxFrame) return { ...S.boxFrame };
  const st = fg()?.state;
  try {
    if (st?.engine && st.photos?.length) {
      const [w, h] = JSON.parse(st.engine.canvas_size(st.photos[0].bytes, fg().effectiveTemplateJson(), fg().buildOverridesJson(), fg().displayMaxEdge()));
      if (w > 0 && h > 0) return { w, h };
    }
  } catch { /* fall back to the stage image */ }
  const r = imgRect();
  return { w: r?.nw ?? 1600, h: r?.nh ?? 1200 };
}
function canvasToLocal(b, r) {
  return {
    x: r.left + (b.x / r.nw) * r.width,
    y: r.top + (b.y / r.nh) * r.height,
    w: (b.w / r.nw) * r.width,
    h: (b.h / r.nh) * r.height,
  };
}
function drawOverlay() {
  const ov = ensureOverlay();
  if (!ov) return;
  ov.innerHTML = "";
  const st = fg()?.state;
  // v0.9.4: the manual locate button is enabled only when there is a selection.
  const locate = document.getElementById("locateSel");
  if (locate) locate.disabled = !(st?.view === "editor" && st?.mode === "frame" && S.selected.size > 0);
  if (st?.view !== "editor") return;
  if (!stageMatchesFrame()) { ov.innerHTML = ""; return; }
  const r = imgRect();
  if (!r) return;
  if (st.mode === "collage" && freeActive()) {
    ov.style.left = `${r.left}px`;
    ov.style.top = `${r.top}px`;
    ov.style.width = `${r.width}px`;
    ov.style.height = `${r.height}px`;
    drawFreeOverlay(ov, r);
    return;
  }
  if (st.mode !== "frame" || !S.img) return;
  ov.style.left = `${r.left}px`;
  ov.style.top = `${r.top}px`;
  ov.style.width = `${r.width}px`;
  ov.style.height = `${r.height}px`;
  ov.classList.toggle("editing", S.selected.size > 0 && !S.cropMode);
  for (const b of S.boxes) {
    if (b.type === "group") continue;
    const hit = S.selected.has(b.id);
    if (!hit && S.selected.size > 0 && !S.cropMode) continue;
    const c = canvasToLocal(b, r);
    if (hit) {
      const box = document.createElement("div");
      box.className = "box";
      box.style.left = `${c.x}px`; box.style.top = `${c.y}px`;
      box.style.width = `${c.w}px`; box.style.height = `${c.h}px`;
      if (b.rotation) box.style.transform = `rotate(${b.rotation}deg)`;
      ov.appendChild(box);
      addHandles(ov, b, c);
      if (S.selected.size === 1) drawSelToolbar(ov, c);
    } else if (!S.cropMode) {
      const dim = document.createElement("div");
      dim.className = "box dim";
      dim.style.left = `${c.x}px`; dim.style.top = `${c.y}px`;
      dim.style.width = `${c.w}px`; dim.style.height = `${c.h}px`;
      ov.appendChild(dim);
    }
  }
  if (S.cropMode) drawCropRect(ov, 0, 0, r.width, r.height);
}
function addHandles(ov, box, c) {
  const hit = findLayer(box.id);
  const rotatable = hit && (hit.layer.type === "text" || hit.layer.type === "shape");
  const mk = (hx, hy, kind, corner) => {
    const h = document.createElement("div");
    h.className = "handle" + (kind === "rot" ? " rot" : "") + (corner ? ` h-${corner}` : "");
    h.style.left = `${hx}px`; h.style.top = `${hy}px`;
    h.dataset.id = box.id; h.dataset.kind = kind;
    if (corner) h.dataset.corner = corner;
    h.title = kind === "rot" ? t("layers.rotate") : t("layers.scale");
    ov.appendChild(h);
    return h;
  };
  // v0.9.0: four corner scale handles (proportional) + a rotation handle.
  mk(c.x, c.y, "scale", "nw");
  mk(c.x + c.w, c.y, "scale", "ne");
  mk(c.x, c.y + c.h, "scale", "sw");
  mk(c.x + c.w, c.y + c.h, "scale", "se");
  if (rotatable) mk(c.x + c.w / 2, c.y - 26, "rot", "n");
}
/// v0.9.0: floating selection toolbar (delete/duplicate/lock/z-order).
function drawSelToolbar(ov, c) {
  const tb = document.createElement("div");
  tb.className = "sel-toolbar";
  const top = `${Math.max(4, c.y - 40)}px`;
  const below = c.y - 40 < 4;
  tb.style.left = `${c.x + c.w / 2}px`;
  tb.style.top = below ? `${c.y + c.h + 40}px` : top;
  const btn = (act, key, glyph) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.act = act;
    b.title = t(key);
    b.setAttribute("aria-label", t(key));
    b.textContent = glyph;
    return b;
  };
  tb.appendChild(btn("delete", "layers.delete", "✕"));
  tb.appendChild(btn("dup", "layers.duplicate", "⧉"));
  tb.appendChild(btn("top", "layers.top", "⤒"));
  tb.appendChild(btn("bottom", "layers.bottom", "⤓"));
  const locked = uiOf(fg().state.templateId).locked;
  const id = [...S.selected][0];
  tb.appendChild(btn("lock", "layers.lock", locked.includes(id) ? "🔒" : "🔓"));
  tb.addEventListener("pointerdown", (e) => e.stopPropagation());
  tb.addEventListener("click", (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    e.stopPropagation();
    if (act === "delete") {
      edit((tpl) => { for (const sid of S.selected) removeLayer(tpl.layers, sid); });
      S.selected.clear();
    } else if (act === "dup") {
      duplicateSelected();
    } else if (act === "top") {
      reorder(-1, true);
    } else if (act === "bottom") {
      reorder(1, true);
    } else if (act === "lock") {
      toggleLocked(id);
    }
    buildLayersPanel(); buildPropsPanel(); drawOverlay();
  });
  ov.appendChild(tb);
}
function drawCropRect(ov, x0, y0, w0, h0) {
  const c = S.crop ?? { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
  S.cropContainer = { x: x0, y: y0, w: Math.max(1, w0), h: Math.max(1, h0) };
  const el = document.createElement("div");
  el.className = "crop-rect";
  el.style.left = `${x0 + c.x * w0}px`; el.style.top = `${y0 + c.y * h0}px`;
  el.style.width = `${c.w * w0}px`; el.style.height = `${c.h * h0}px`;
  el.dataset.crop = "1";
  ov.appendChild(el);
}
function guidesClear(ov) {
  for (const g of ov.querySelectorAll(".guide")) g.remove();
}
function showGuide(ov, kind, localPos, r) {
  const g = document.createElement("div");
  g.className = `guide ${kind === "v" ? "v" : "h"}`;
  if (kind === "v") g.style.left = `${localPos}px`;
  else g.style.top = `${localPos}px`;
  ov.appendChild(g);
}

function beginDrag(kind, id, ev) {
  const b = boxesById().get(id);
  const r = imgRect();
  if (!b || !r) return;
  const hit = findLayer(id);
  if (!hit || hit.layer.locked) return;
  const u = uiOf(fg().state.templateId);
  if (u.locked.includes(id)) return;
  const visible = (stageImg() ?? S.img).getBoundingClientRect();
  const d = {
    kind, id, startX: ev.clientX, startY: ev.clientY,
    visibleW: visible.width || r.width,
    visibleH: visible.height || r.height,
    startOffsetX: hit.layer.offset?.x ?? 0,
    startOffsetY: hit.layer.offset?.y ?? 0,
    startSize: { ...(hit.layer.size ?? {}), font: hit.layer.font?.size, height: hit.layer.size?.height },
    startW: b.w, startH: b.h,
    startRotation: hit.layer.rotation ?? 0,
    box: b, parent: hit.parent,
    scaleX: 1, scaleY: 1,
  };
  d.scaleX = d.visibleW / r.nw;
  d.scaleY = d.visibleH / r.nh;
  // v0.9.0: proportional corner scaling measures the pointer distance from the
  // box centre in screen space, so all four corners behave the same way.
  const cx = visible.left + ((b.x + b.w / 2) / r.nw) * visible.width;
  const cy = visible.top + ((b.y + b.h / 2) / r.nh) * visible.height;
  d.centerClient = { x: cx, y: cy };
  d.startDist = Math.max(8, Math.hypot(ev.clientX - cx, ev.clientY - cy));
  S.drag = d;
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", endDrag, { once: true });
  ev.preventDefault();
  ev.stopPropagation();
}
function onDragMove(ev) {
  const d = S.drag;
  if (!d) return;
  const r = imgRect();
  if (!r) return;
  const dvx = (ev.clientX - d.startX) / d.scaleX; // image px
  const dvy = (ev.clientY - d.startY) / d.scaleY;
  const refW = r.nw, refH = r.nh;
  if (d.kind === "move") {
    let offX = d.startOffsetX + dvx / refW;
    let offY = d.startOffsetY + dvy / refH;
    const snapped = snapOffset(d, offX, offY, dvx, dvy, r);
    offX = snapped.x; offY = snapped.y;
    edit((tpl) => {
      const hit = findLayer(d.id, tpl.layers);
      if (hit) { hit.layer.offset = { x: clamp(offX, -1, 1), y: clamp(offY, -1, 1) }; }
    }, { history: false });
    return;
  }
  if (d.kind === "scale") {
    const dist = Math.hypot(ev.clientX - d.centerClient.x, ev.clientY - d.centerClient.y);
    const factor = Math.max(0.05, dist / d.startDist);
    const s = d.startSize;
    edit((tpl) => {
      const hit = findLayer(d.id, tpl.layers);
      if (!hit) return;
      const l = hit.layer;
      if (l.type === "text") l.font.size = clamp((s.font ?? l.font.size) * factor, 0.002, 0.5);
      else if (l.type === "calendar") l.size = clamp((s.size ?? l.size) * factor, 0.05, 0.6);
      else if (l.type === "shape" || l.type === "image" || l.type === "palette") {
        l.size ??= {};
        const w = s.width ?? (d.startW / r.nw);
        const h = s.height ?? (d.startH / r.nh);
        l.size.width = clamp(w * factor, 0.001, 1);
        l.size.height = clamp(h * factor, 0.0005, 1);
      }
    }, { history: false });
  }
  if (d.kind === "rot") {
    const b = d.box;
    const cx = r.left + ((b.x + b.w / 2) / r.nw) * r.width;
    const cy = r.top + ((b.y + b.h / 2) / r.nh) * r.height;
    const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
    const snapped = Math.abs(((ang % 90) + 90) % 90) < 4 ? Math.round(ang / 90) * 90 : ang;
    edit((tpl) => {
      const hit = findLayer(d.id, tpl.layers);
      if (hit && (hit.layer.type === "text" || hit.layer.type === "shape")) {
        hit.layer.rotation = Math.round(snapped * 10) / 10;
      }
    }, { history: false });
  }
}
function snapOffset(d, offX, offY, dvx, dvy, r) {
  const ov = ensureOverlay();
  guidesClear(ov);
  const hit = findLayer(d.id);
  if (!hit) return { x: offX, y: offY };
  const b = d.box;
  const nx = b.x + dvx, ny = b.y + dvy;
  const candX = [0, r.nw / 2, r.nw, nx, nx + b.w / 2, nx + b.w];
  const candY = [0, r.nh / 2, r.nh, ny, ny + b.h / 2, ny + b.h];
  const tol = 8;
  let bestX = null, bestY = null;
  const others = S.boxes.filter((x) => x.id !== d.id && x.type !== "group");
  const linesX = [0, r.nw / 2, r.nw];
  const linesY = [0, r.nh / 2, r.nh];
  for (const o of others) {
    linesX.push(o.x, o.x + o.w / 2, o.x + o.w);
    linesY.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  for (const src of [nx, nx + b.w / 2, nx + b.w]) {
    for (const line of linesX) {
      if (Math.abs(src - line) < tol) { bestX = { delta: line - src, line }; break; }
    }
    if (bestX) break;
  }
  for (const src of [ny, ny + b.h / 2, ny + b.h]) {
    for (const line of linesY) {
      if (Math.abs(src - line) < tol) { bestY = { delta: line - src, line }; break; }
    }
    if (bestY) break;
  }
  if (bestX && ov) showGuide(ov, "v", (bestX.line / r.nw) * r.width, r);
  if (bestY && ov) showGuide(ov, "h", (bestY.line / r.nh) * r.height, r);
  return {
    x: offX + (bestX ? bestX.delta / r.nw : 0),
    y: offY + (bestY ? bestY.delta / r.nh : 0),
  };
}
function endDrag() {
  window.removeEventListener("pointermove", onDragMove);
  const ov = ensureOverlay();
  if (ov) guidesClear(ov);
  const drag = S.drag;
  S.drag = null;
  if (drag?.kind) {
    commitNow();
    // v0.9.4: dragging never re-pans the stage (no zoom/pan side effects).
  }
}

/* ---------------------------------------------------------- property panel */
/// v0.9.4: manual fallback for reaching a selection after the user zoomed or
/// panned away — centers the selected box and then clamps only as far as the
/// selection itself staying inside the viewport (24px margin). Never runs
/// automatically, never pushes the selection back off-screen.
function locateSelected() {
  const st = fg()?.state;
  const img = stageImg();
  if (!st || !img || !img.offsetWidth || !S.selected.size) return false;
  if (!stageMatchesFrame()) return false;
  const boxes = [...S.selected].map((id) => boxesById().get(id)).filter(Boolean);
  if (!boxes.length) return false;
  const F = canvasFrame();
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const vp = document.getElementById("viewport").getBoundingClientRect();
  const z = st.zoom;
  const s = z.scale;
  const w = img.offsetWidth, h = img.offsetHeight;
  const ox = img.offsetLeft * s, oy = img.offsetTop * s;
  const lx0 = (x0 / F.w) * w, lx1 = (x1 / F.w) * w;
  const ly0 = (y0 / F.h) * h, ly1 = (y1 / F.h) * h;
  const M = 24;
  let tx = vp.width / 2 - (ox + ((lx0 + lx1) / 2) * s);
  let ty = vp.height / 2 - (oy + ((ly0 + ly1) / 2) * s);
  const loX = M - ox - lx0 * s, hiX = vp.width - M - ox - lx1 * s;
  if (loX <= hiX) tx = clamp(tx, loX, hiX);
  const loY = M - oy - ly0 * s, hiY = vp.height - M - oy - ly1 * s;
  if (loY <= hiY) ty = clamp(ty, loY, hiY);
  st.zoom = { scale: s, tx, ty, autoFit: false };
  fg().applyZoom?.();
  return true;
}
function buildPropsPanel() {
  const body = document.getElementById("propsBody");
  if (!body) return;
  body.innerHTML = "";
  const sel = selectedLayers();
  if (!sel.length) {
    body.innerHTML = `<div class="muted">${escapeHtml(t("props.none"))}</div>`;
    return;
  }
  const grid = document.createElement("div");
  grid.className = "props-grid";
  body.appendChild(grid);
  if (sel.length > 1) {
    addDual(grid, "props.offsetX", sel[0].layer.offset?.x ?? 0, -1, 1, 0.005, (v) => {
      edit((tpl) => sel.forEach(({ layer }) => {
        const hit = findLayer(layer.id, tpl.layers);
        if (hit) hit.layer.offset = { ...(hit.layer.offset ?? {}), x: v };
      }));
    });
    return;
  }
  const { layer } = sel[0];
  const cur = () => {
    const hit = findLayer(layer.id);
    return hit?.layer ?? layer;
  };
  const mutate = (fn) => edit((tpl) => {
    const hit = findLayer(layer.id, tpl.layers);
    if (hit) fn(hit.layer);
  });
    addDual(grid, "props.offsetX", layer.offset?.x ?? 0, -1, 1, 0.005, (v) => mutate((l) => { l.offset = { ...(l.offset ?? {}), x: v }; }));
  addDual(grid, "props.offsetY", layer.offset?.y ?? 0, -1, 1, 0.005, (v) => mutate((l) => { l.offset = { ...(l.offset ?? {}), y: v }; }));
  addDual(grid, "props.z", layer.z ?? 0, -20, 20, 1, (v) => mutate((l) => { l.z = Math.round(v); }), true);
  if (layer.type === "text" || layer.type === "shape") {
    addDual(grid, "props.rotation", layer.rotation ?? 0, -180, 180, 0.5, (v) => mutate((l) => { l.rotation = v; }));
  }
  if (!(layer.type === "image" && isBadgeLayer(layer))) {
    addDual(grid, "props.opacity", layer.opacity ?? 1, 0, 1, 0.01, (v) => mutate((l) => { l.opacity = v; }));
  }
  if (layer.type === "text") buildTextProps(grid, layer, mutate, cur);
  if (layer.type === "shape") buildShapeProps(grid, layer, mutate);
  if (layer.type === "calendar") buildCalendarProps(grid, layer, mutate);
  if (layer.type === "image") {
    if (isBadgeLayer(layer)) buildBadgeProps(grid, layer, mutate);
    else buildImageProps(grid, layer, mutate);
  }
  if (layer.type === "palette") buildPaletteProps(grid, layer, mutate);
}

function propRow(grid, label) {
  const row = document.createElement("div");
  row.className = "field";
  const lab = document.createElement("label");
  lab.innerHTML = `<span>${escapeHtml(t(label))}</span>`;
  const holder = document.createElement("div");
  holder.className = "dual";
  row.appendChild(lab);
  row.appendChild(holder);
  grid.appendChild(row);
  return holder;
}
function addDual(grid, label, value, min, max, step, onChange, integer = false) {
  const holder = propRow(grid, label);
  const range = document.createElement("input");
  range.type = "range"; range.min = min; range.max = max; range.step = step; range.value = value;
  const num = document.createElement("input");
  num.type = "number"; num.min = min; num.max = max; num.step = step; num.value = Number(value).toFixed(integer ? 0 : 3);
  const fire = (v) => { onChange(clamp(Number(v), min, max)); };
  range.oninput = () => { num.value = range.value; fire(range.value); };
  range.onchange = () => { commitNow(); };
  num.oninput = () => { range.value = num.value; fire(num.value); };
  num.onchange = () => { commitNow(); };
  holder.appendChild(range); holder.appendChild(num);
  return holder;
}
function commitNow() {
  const id = fg()?.state?.templateId;
  const tpl = baseTemplate();
  if (!id || !tpl) return;
  pushHistory(id, JSON.stringify(tpl), true);
}
function addSelect(grid, label, value, options, onChange) {
  const holder = propRow(grid, label);
  const sel = document.createElement("select");
  sel.style.flex = "1";
  for (const [v, text] of options) {
    const o = document.createElement("option");
    o.value = v; o.textContent = text;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => onChange(sel.value);
  holder.appendChild(sel);
  return sel;
}
function addColor(grid, label, value, onChange) {
  const holder = propRow(grid, label);
  const inp = document.createElement("input");
  inp.type = "color";
  inp.value = /^#[0-9a-f]{6}/i.test(value ?? "") ? value.slice(0, 7) : "#111111";
  inp.oninput = () => onChange(inp.value);
  inp.onchange = () => commitNow();
  holder.appendChild(inp);
  return inp;
}
function addCheck(grid, label, checked, onChange) {
  const row = document.createElement("label");
  row.className = "row";
  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.checked = checked;
  inp.onchange = () => { onChange(inp.checked); };
  const span = document.createElement("span");
  span.textContent = t(label);
  row.appendChild(inp); row.appendChild(span);
  grid.appendChild(row);
  return inp;
}

const PRESETS = {
  copperplate: {
    stroke: { width: 0.012, color: "#3B3B3B" },
    relief: { mode: "engrave", depth: 0.05, highlight: "#FFFFFF", shadow: "#202020", opacity: 0.8 },
    case: "upper",
  },
  gilt: {
    fill: { mode: "foil", colors: ["#F7E7A9", "#C9A227", "#FFF3C4", "#8A6A12"], angle: 100, intensity: 1 },
    shadow: { offsetX: 0.015, offsetY: 0.015, blur: 0.05, color: "#000000", opacity: 0.55 },
  },
  letterpress: {
    relief: { mode: "letterpress", depth: 0.06, highlight: "#FFFFFF", shadow: "#8C8577", opacity: 0.9 },
  },
  woodtype: {
    stroke: { width: 0.02, color: "#2A2118" },
    relief: { mode: "engrave", depth: 0.07, highlight: "#E8D9BC", shadow: "#3A2E1E", opacity: 0.85 },
    case: "upper",
  },
  ukiyoe: {
    stroke: { width: 0.014, color: "#C8102E" },
    relief: { mode: "emboss", depth: 0.045, highlight: "#FFF6E8", shadow: "#5A4634", opacity: 0.75 },
  },
  deco: {
    stroke: { width: 0.008, color: "#B08D2E", double: true, gap: 0.05 },
    case: "upper",
  },
  republican: {
    stroke: { width: 0.01, color: "#8C2F2F" },
    relief: { mode: "letterpress", depth: 0.04, highlight: "#FFFDF6", shadow: "#7A6A55", opacity: 0.7 },
  },
  seal: {
    stroke: { width: 0.03, color: "#FFFFFF" },
    relief: { mode: "emboss", depth: 0.07, highlight: "#FFE9E9", shadow: "#7A0F1E", opacity: 0.9 },
  },
};
const EXIF_CHIPS = [
  ["model", "exif.model"],
  ["lens", "exif.lens"],
  ["focal", "exif.focal"],
  ["aperture", "exif.aperture"],
  ["shutter", "exif.shutter"],
  ["iso", "exif.iso"],
  ["datetime", "exif.datetime"],
  ["weekday", "exif.weekday"],
  ["weekday_cn", "exif.weekday_cn"],
  ["film_mode", "exif.fuji.film_mode"],
  ["wb_mode", "exif.fuji.wb_mode"],
  ["grain", "exif.fuji.grain"],
  ["dynamic_range", "exif.fuji.dynamic_range"],
];
const EXIF_PARAMS_EXPR = "fmt('{focal}mm · f/{aperture} · {shutter} · ISO{iso}', exif)";
function appendExifItem(layerId, expr) {
  if (!layerId) return;
  S.selected = new Set([layerId]);
  edit((tpl) => {
    const hit = findLayer(layerId, tpl.layers);
    if (!hit) return;
    hit.layer.content ??= [];
    hit.layer.content.push({ expr, fallback: "" });
  });
  safeRender();
}
function buildExifFieldChips(grid, layer) {
  const row = document.createElement("div");
  row.className = "field";
  const lab = document.createElement("label");
  lab.innerHTML = `<span>${escapeHtml(t("exif.fieldTitle"))}</span>`;
  row.appendChild(lab);
  const chips = document.createElement("div");
  chips.className = "field-chips";
  chips.id = "exifFieldChips";
  for (const [key, labelKey] of EXIF_CHIPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "exif-chip";
    b.dataset.exif = key;
    b.textContent = t(labelKey);
    b.onclick = () => appendExifItem(layer.id, `exif.${key}`);
    chips.appendChild(b);
  }
  const params = document.createElement("button");
  params.type = "button";
  params.className = "exif-chip primary";
  params.id = "exifInsertParams";
  params.dataset.exif = "params";
  params.textContent = t("exif.insertParams");
  params.onclick = () => appendExifItem(layer.id, EXIF_PARAMS_EXPR);
  chips.appendChild(params);
  row.appendChild(chips);
  grid.appendChild(row);
}

function buildTextProps(grid, layer, mutate, cur) {
  addDual(grid, "props.fontSize", layer.font?.size ?? 0.02, 0.002, 0.5, 0.001, (v) => mutate((l) => { l.font.size = v; }));
  addDual(grid, "props.letterSpacing", layer.letterSpacing ?? 0, -0.05, 0.5, 0.005, (v) => mutate((l) => { l.letterSpacing = v; }));
  addDual(grid, "props.lineHeight", layer.lineHeight ?? 1.3, 0.5, 4, 0.05, (v) => mutate((l) => { l.lineHeight = v; }));
  addSelect(grid, "props.align", layer.align ?? "left", [["left", t("opt.left")], ["center", t("opt.center")], ["right", t("opt.right")]], (v) => mutate((l) => { l.align = v; }));
  addColor(grid, "props.fontColor", layer.font?.color, (v) => mutate((l) => { l.font.color = v; }));
  addSelect(grid, "props.case", layer.effects?.case ?? "", [["", t("opt.default")], ["upper", t("opt.upper")], ["lower", t("opt.lower")], ["title", t("opt.titleCase")]], (v) => mutate((l) => {
    l.effects ??= {};
    if (v) l.effects.case = v; else delete l.effects.case;
  }));
  // Preset picker inside panel too.
  addSelect(grid, "props.preset", "", [["", t("opt.presetNone")], ...Object.keys(PRESETS).map((k) => [k, t("insert.preset" + k[0].toUpperCase() + k.slice(1))])], (v) => {
    if (v && PRESETS[v]) applyPreset(v);
  });
  addCheck(grid, "props.stroke", !!layer.effects?.stroke, (on) => mutate((l) => {
    l.effects ??= {};
    if (on) l.effects.stroke = { width: 0.02, color: "#FFFFFF" };
    else delete l.effects.stroke;
  }));
  if (layer.effects?.stroke) {
    addDual(grid, "props.strokeWidth", layer.effects.stroke.width, 0.005, 0.3, 0.001, (v) => mutate((l) => { l.effects.stroke.width = v; }));
    addColor(grid, "props.strokeColor", layer.effects.stroke.color, (v) => mutate((l) => { l.effects.stroke.color = v; }));
    addCheck(grid, "props.double", !!layer.effects.stroke.double, (on) => mutate((l) => {
      if (on) l.effects.stroke.double = true; else delete l.effects.stroke.double;
    }));
  }
  addSelect(grid, "props.fill", layer.effects?.fill?.mode ?? "", [["", t("opt.fillSolid")], ["gradient", t("opt.fillGradient")], ["foil", t("opt.fillFoil")], ["texture", t("opt.fillTexture")]], (v) => mutate((l) => {
    l.effects ??= {};
    if (v) {
      const colors = v === "foil" ? ["#F7E7A9", "#C9A227", "#FFF3C4"] : ["#FFFFFF", "#B8B8B8"];
      l.effects.fill = { mode: v, colors, angle: 90, intensity: 1 };
    } else delete l.effects.fill;
  }));
  if (layer.effects?.fill?.mode && (layer.effects.fill.colors?.length ?? 0) >= 2) {
    const stops = layer.effects.fill.colors;
    addColor(grid, "props.fillFrom", stops[0], (v) => mutate((l) => {
      if (l.effects?.fill?.colors?.length) l.effects.fill.colors[0] = v;
    }));
    addColor(grid, "props.fillTo", stops[stops.length - 1], (v) => mutate((l) => {
      const arr = l.effects?.fill?.colors;
      if (arr?.length) arr[arr.length - 1] = v;
    }));
  }
  addSelect(grid, "props.relief", layer.effects?.relief?.mode ?? "", [["", t("opt.reliefNone")], ["emboss", t("opt.reliefEmboss")], ["engrave", t("opt.reliefEngrave")], ["letterpress", t("opt.reliefLetterpress")], ["inner-shadow", t("opt.reliefInner")]], (v) => mutate((l) => {
    l.effects ??= {};
    if (v) l.effects.relief = { mode: v, depth: 0.06, highlight: "#FFFFFF", shadow: "#000000", opacity: 0.8 };
    else delete l.effects.relief;
  }));
  addCheck(grid, "props.shadow", !!layer.effects?.shadow, (on) => mutate((l) => {
    l.effects ??= {};
    if (on) l.effects.shadow = { offsetX: 0.02, offsetY: 0.02, blur: 0.06, color: "#000000", opacity: 0.6 };
    else delete l.effects.shadow;
  }));
  buildExifFieldChips(grid, layer);
}
function buildShapeProps(grid, layer, mutate) {
  addColor(grid, "props.color", layer.color, (v) => mutate((l) => { l.color = v; }));
  addDual(grid, "props.sizeWidth", layer.size?.width ?? 0.2, 0.001, 1, 0.005, (v) => mutate((l) => { l.size = { ...(l.size ?? {}), width: v }; }));
  addDual(grid, "props.sizeHeight", layer.size?.height ?? 0.002, 0.0005, 1, 0.001, (v) => mutate((l) => { l.size = { ...(l.size ?? {}), height: v }; }));
  addCheck(grid, "props.double", !!layer.double, (on) => mutate((l) => { if (on) l.double = true; else delete l.double; }));
  addCheck(grid, "props.autoHide", !!layer.auto_hide, (on) => mutate((l) => { if (on) l.autoHide = true; else delete l.autoHide; }));
  addSelect(grid, "props.frame", layer.frame ?? "", [["", t("opt.frameNone")], ["outer", t("opt.frameOuter")], ["opposite-h", t("opt.frameOppH")], ["opposite-v", t("opt.frameOppV")]], (v) => mutate((l) => {
    if (v) { l.frame = v; l.margin ??= 0.04; l.strokeWidth ??= 0.002; } else delete l.frame;
  }));
}
const CAL_PRESETS = [
  ["month", "calendar.viewMonth"],
  ["day", "calendar.viewDay"],
  ["strip", "calendar.viewStrip"],
  ["week", "calendar.viewWeek"],
];
const CAL_ACCENTS = ["#E10600", "#C8102E", "#B08D2E", "#1772F6", "#2E7D32", "#1A1A1A"];
function buildCalendarProps(grid, layer, mutate) {
  addDual(grid, "props.size", layer.size ?? 0.3, 0.05, 0.6, 0.005, (v) => mutate((l) => { l.size = v; }));
  addSelect(grid, "props.view", layer.view ?? "month", [["month", t("calendar.viewMonth")], ["day", t("calendar.viewDay")], ["strip", t("calendar.viewStrip")], ["week", t("calendar.viewWeek")]], (v) => mutate((l) => { l.view = v; }));
  // Quick layout presets (v0.5.0 M6).
  const presets = document.createElement("div");
  presets.className = "btn-row cal-presets";
  for (const [view, key] of CAL_PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small cal-preset" + ((layer.view ?? "month") === view ? " primary" : "");
    b.dataset.view = view;
    b.textContent = t(key);
    b.onclick = () => mutate((l) => { l.view = view; });
    presets.appendChild(b);
  }
  grid.appendChild(presets);
  addCheck(grid, "props.lunar", layer.showLunar !== false, (on) => mutate((l) => { l.showLunar = on; }));
  addCheck(grid, "props.weekdays", layer.showWeekdays !== false, (on) => mutate((l) => { l.showWeekdays = on; }));
  addColor(grid, "props.color", layer.color ?? "#1A1A1A", (v) => mutate((l) => { l.color = v; }));
  const accents = document.createElement("div");
  accents.className = "swatches cal-accents";
  for (const color of CAL_ACCENTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + ((layer.accent ?? "").toLowerCase() === color.toLowerCase() ? " on" : "");
    b.style.background = color;
    b.dataset.color = color;
    b.title = t("calendar.accent");
    b.onclick = () => mutate((l) => { l.accent = color; });
    accents.appendChild(b);
  }
  grid.appendChild(accents);
  addColor(grid, "props.accent", layer.accent ?? "#E10600", (v) => mutate((l) => { l.accent = v; }));
}
function buildImageProps(grid, layer, mutate) {
  addDual(grid, "props.sizeHeight", layer.size?.height ?? 0.03, 0.005, 0.5, 0.001, (v) => mutate((l) => { l.size = { ...(l.size ?? {}), height: v }; }));
}
/// v0.9.0: badge controls. Template-level by default (shared overrides); with
/// "override this layer only" they write the layer fields, backed up in the UI
/// store and restored when the override is switched off.
function buildBadgeProps(grid, layer, mutate) {
  const tid = fg()?.state?.templateId;
  const u = tid ? uiOf(tid) : { hidden: [], locked: [], labels: {} };
  const override = !!(u.badgeOverride ?? {})[layer.id];
  const ov = tid ? (fg()?.loadOverrides?.(tid) ?? {}) : {};
  addCheck(grid, "props.badgeShow", fg()?.getShowLogo?.() ?? true, (on) => {
    fg()?.setShowLogo?.(on);
    buildPropsPanel();
  });
  addCheck(grid, "props.override", override, (on) => {
    if (!tid) return;
    u.badgeOverride ??= {};
    u.badgeBackup ??= {};
    if (on) {
      u.badgeBackup[layer.id] = {
        size: layer.size?.height ?? null,
        corner: layer.corner ?? null,
        margin: layer.margin ?? null,
        contrast: layer.contrast ?? null,
        opacity: layer.opacity ?? null,
      };
      u.badgeOverride[layer.id] = true;
    } else {
      const b = u.badgeBackup[layer.id];
      if (b) {
        mutate((l) => {
          if (l.size && b.size == null) delete l.size.height;
          else if (b.size != null) l.size = { ...(l.size ?? {}), height: b.size };
          if (b.corner == null) delete l.corner; else l.corner = b.corner;
          if (b.margin == null) delete l.margin; else l.margin = b.margin;
          if (b.contrast == null) delete l.contrast; else l.contrast = b.contrast;
          l.opacity = b.opacity ?? 1;
        });
      }
      delete u.badgeBackup[layer.id];
      delete u.badgeOverride[layer.id];
    }
    saveUi();
    buildPropsPanel();
    fg()?.renderNow?.();
  });
  const contrastOpts = [
    ["auto", t("opt.contrastAuto")],
    ["color", t("opt.contrastColor")],
    ["light", t("opt.contrastLight")],
    ["dark", t("opt.contrastDark")],
    ["stroke", t("opt.contrastStroke")],
    ["plate", t("opt.contrastPlate")],
  ];
  const posOpts = [
    ["anchor", t("opt.posAnchor")],
    ["top-left", t("opt.posTopLeft")],
    ["top-right", t("opt.posTopRight")],
    ["bottom-left", t("opt.posBottomLeft")],
    ["bottom-right", t("opt.posBottomRight")],
  ];
  if (override) {
    addSelect(grid, "props.badgePos", layer.corner ?? "anchor", posOpts, (v) => {
      mutate((l) => {
        if (v === "anchor") l.corner = "anchor";
        else { l.corner = v; l.margin ??= 0.04; }
      });
      fg()?.renderNow?.();
    });
    addDual(grid, "props.badgeSize", layer.size?.height ?? 0.065, 0.02, 0.3, 0.005, (v) => {
      mutate((l) => { l.size = { ...(l.size ?? {}), height: v }; });
      fg()?.renderNow?.();
    });
    addSelect(grid, "props.badgeContrast", layer.contrast ?? "auto", contrastOpts, (v) => {
      mutate((l) => { l.contrast = v; delete l.tint; });
      fg()?.renderNow?.();
    });
    addDual(grid, "props.badgeOpacity", layer.opacity ?? 1, 0.7, 1, 0.05, (v) => {
      mutate((l) => { l.opacity = v; });
      fg()?.renderNow?.();
    });
  } else {
    addSelect(grid, "props.badgePos", ov.brandPosition ?? "anchor", posOpts, (v) => {
      fg()?.pushOverride?.({ brandPosition: v });
      fg()?.renderNow?.();
    });
    addDual(grid, "props.badgeSize", ov.brandScale ?? 1, 0.5, 2, 0.05, (v) => {
      fg()?.pushOverride?.({ brandScale: v });
      fg()?.renderNow?.();
    });
    addSelect(grid, "props.badgeContrast", ov.brandContrast ?? "auto", contrastOpts, (v) => {
      fg()?.pushOverride?.({ brandContrast: v });
      fg()?.renderNow?.();
    });
    addDual(grid, "props.badgeOpacity", ov.brandOpacity ?? 1, 0.7, 1, 0.05, (v) => {
      fg()?.pushOverride?.({ brandOpacity: v });
      fg()?.renderNow?.();
    });
  }
}
function buildPaletteProps(grid, layer, mutate) {
  addDual(grid, "props.count", layer.count ?? 5, 2, 8, 1, (v) => mutate((l) => { l.count = Math.round(v); }), true);
  addSelect(grid, "props.shape", layer.shape ?? "circle", [["circle", t("opt.shapeCircle")], ["square", t("opt.shapeSquare")], ["diamond", t("opt.shapeDiamond")], ["hexagon", t("opt.shapeHexagon")], ["strip", t("opt.shapeStrip")]], (v) => mutate((l) => { l.shape = v; }));
  addDual(grid, "props.size", layer.size ?? 0.035, 0.005, 0.3, 0.001, (v) => mutate((l) => { l.size = v; }));
}
function applyPreset(key) {
  const sel = selectedLayers();
  if (!sel.length || sel[0].layer.type !== "text") { fg()?.toast?.("error", t("tweak.needTextLayer")); return; }
  const preset = PRESETS[key];
  if (!preset) return;
  edit((tpl) => {
    const hit = findLayer(sel[0].layer.id, tpl.layers);
    if (!hit) return;
    hit.layer.effects = { ...(hit.layer.effects ?? {}), ...structuredClone(preset) };
  });
  fg()?.toast?.("ok", "已应用样式预设");
}

/* -------------------------------------------------------------- insert */
function newId(prefix, tpl) {
  let i = 1;
  const ids = new Set(allLayers(tpl.layers ?? []).map((x) => x.layer.id));
  while (ids.has(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}
function insertLayer(factory, selectNew = true) {
  let newId_ = null;
  edit((tpl) => {
    tpl.layers ??= [];
    const layer = factory(tpl);
    newId_ = layer.id;
    tpl.layers.push(layer);
  });
  if (selectNew && newId_) { S.selected = new Set([newId_]); buildLayersPanel(); buildPropsPanel(); drawOverlay(); }
}
function insertText() {
  insertLayer((tpl) => {
    const id = newId("text", tpl);
    return {
      type: "text", id, anchor: "middle-center", offset: { x: 0, y: 0 },
      font: { family: ["Inter"], size: 0.04, color: "#111111" },
      lineHeight: 1.3, content: [{ expr: "'NEW TEXT'" }],
    };
  });
}
function insertCalendar() {
  insertLayer((tpl) => {
    const id = newId("calendar", tpl);
    return {
      type: "calendar", id, anchor: "middle-center", offset: { x: 0, y: 0.2 },
      size: 0.34, dateSource: "exif", showLunar: true, showWeekdays: true, view: "month",
      color: "#111111", accent: "#E10600", fontFamily: ["Inter"],
    };
  });
}
/* v0.9.0: badge insertion + library panel (integrated into the insert card). */
function firstBadgeLayer() {
  let hit = null;
  const walk = (ls) => {
    for (const l of ls ?? []) {
      if (!hit && isBadgeLayer(l)) hit = l;
      if (l.type === "group") walk(l.children);
    }
  };
  walk(baseTemplate()?.layers ?? []);
  return hit;
}
function insertBadge() {
  const panel = document.getElementById("badgeLibPanel");
  const existing = firstBadgeLayer();
  if (!existing) {
    const slug = fg()?.state?.photos?.[0]?.exif?.brand_slug;
    const asset = slug ? `@builtin/brand/${slug}` : "@builtin/brand/{exif.brand_slug}";
    insertLayer((tpl) => ({
      type: "image",
      id: newId("badge", tpl),
      anchor: "bottom-right",
      offset: { x: -0.03, y: -0.03 },
      asset,
      size: { height: 0.065 },
    }));
  } else {
    S.selected = new Set([existing.id]);
    buildLayersPanel();
    buildPropsPanel();
    drawOverlay();
  }
  panel?.classList.remove("hidden");
  window.__fg?.renderBrandLibrary?.();
}
function insertDivider() {
  insertLayer((tpl) => {
    const id = newId("rule", tpl);
    return {
      type: "shape", id, anchor: "middle-center", offset: { x: 0, y: 0 },
      shape: "line", size: { width: 0.5, height: 0.0015 }, color: "#E4E6EA", autoHide: true,
    };
  });
}
function insertShape() {
  insertLayer((tpl) => {
    const id = newId("frame", tpl);
    return {
      type: "shape", id, anchor: "middle-center", offset: { x: 0, y: 0 },
      shape: "rect", size: { width: 0.5, height: 0.5 }, color: "#111111",
      strokeWidth: 0.002,
    };
  });
}
function insertPalette() {
  insertLayer((tpl) => {
    const id = newId("chips", tpl);
    return {
      type: "palette", id, anchor: "bottom-left", offset: { x: 0.06, y: -0.08 },
      count: 5, shape: "circle", size: 0.03, showHex: false,
    };
  });
}
/** v0.5.0: register an uploaded image as a @user asset + append an image layer
 *  (centered, width ≈ 30% of the canvas — engine size.width is relative to the
 *  photo height, so convert through the actual photo aspect ratio). */
async function insertImageFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const engine = fg()?.state?.engine;
  if (!engine) return;
  const key = `@user/insert-${Date.now().toString(36)}`;
  engine.register_asset(key, bytes);
  let imgAr = 0.75; // height / width fallback
  try {
    const bmp = await createImageBitmap(new Blob([bytes]));
    imgAr = bmp.height / Math.max(1, bmp.width);
    bmp.close?.();
  } catch { /* keep fallback aspect */ }
  const r = imgRect();
  const photoAr = r && r.nw ? r.nh / r.nw : 0.75; // height / width
  // Engine image `size.height` is relative to the photo height; target a width
  // of ≈ 30% of the canvas width: h_px = 0.3 * photo_w * (img_h / img_w).
  const height = clamp((0.3 * imgAr) / Math.max(0.01, photoAr), 0.01, 0.8);
  insertLayer((tpl) => {
    const id = newId("image", tpl);
    return {
      type: "image", id, anchor: "middle-center", offset: { x: 0, y: 0 },
      asset: key, size: { height }, opacity: 1,
    };
  });
}

/* ---------------------------------------------------------------- crop */
function toggleCrop() {
  if (freeActive()) {
    if (S.freeSel == null) { fg()?.toast?.("error", t("free.needSelect")); return; }
    S.cropTarget = "free";
    S.cropMode = !S.cropMode;
    const item = freeItems()[S.freeSel];
    if (S.cropMode) S.crop = item?.crop ? { ...item.crop } : { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
    else S.crop = null;
    const btn = document.getElementById("cropToggle");
    if (btn) btn.classList.toggle("primary", S.cropMode);
    drawOverlay();
    updateCropInfo();
    return;
  }
  S.cropTarget = "frame";
  S.cropMode = !S.cropMode;
  if (S.cropMode && !uiOf(fg().state.templateId).crop) {
    S.crop = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
  } else {
    S.crop = uiOf(fg().state.templateId).crop ? { ...uiOf(fg().state.templateId).crop } : null;
  }
  const btn = document.getElementById("cropToggle");
  if (btn) btn.classList.toggle("primary", S.cropMode);
  drawOverlay();
  updateCropInfo();
}
function applyCrop() {
  if (S.cropTarget === "free") {
    const idx = S.freeSel;
    if (idx != null) mutateFree((s) => {
      const it = s.items[idx];
      if (!it) return;
      if (S.crop) it.crop = { x: S.crop.x, y: S.crop.y, w: S.crop.w, h: S.crop.h };
      else delete it.crop;
    });
    updateCropInfo();
    return;
  }
  const u = uiOf(fg().state.templateId);
  u.crop = S.crop ? { ...S.crop } : null;
  saveUi();
  updateCropInfo();
  safeRender();
}
function resetCrop() {
  if (freeActive() && S.freeSel != null) {
    S.cropTarget = "free";
    mutateFree((s) => { const it = s.items[S.freeSel]; if (it) delete it.crop; });
    S.crop = S.cropMode ? { x: 0.08, y: 0.08, w: 0.84, h: 0.84 } : null;
    updateCropInfo();
    drawOverlay();
    return;
  }
  const u = uiOf(fg().state.templateId);
  u.crop = null;
  S.crop = S.cropMode ? { x: 0.08, y: 0.08, w: 0.84, h: 0.84 } : null;
  saveUi();
  updateCropInfo();
  drawOverlay();
  safeRender();
}
/** v0.5.0: full-width/full-height centered crop rect (photo natural aspect). */
function cropFill(axis) {
  const st = fg()?.state;
  const idx = freeActive() ? S.freeSel : null;
  const item = idx != null ? freeItems()[idx] : null;
  const photo = st?.photos?.[item?.photo ?? 0] ?? st?.photos?.[0];
  if (!photo) return;
  const photoAr = photo.ar ? 1 / photo.ar : 1; // oriented width / height
  const lock = cropAspectRatio();
  const stageAr = S.img?.naturalWidth ? S.img.naturalWidth / S.img.naturalHeight : photoAr;
  const ar = lock || stageAr || photoAr;
  let w, h;
  if (axis === "w") {
    w = 1;
    h = clamp(photoAr / ar, 0.02, 1);
  } else {
    h = 1;
    w = clamp(ar / photoAr, 0.02, 1);
  }
  S.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  applyCrop();
  drawOverlay();
}
/** v0.5.0: double-click on the stage enters crop — free mode targets the
 *  selected collage item (returns false to fall back to fit). */
function onStageDblClick(e) {
  const st = fg()?.state;
  if (!st || st.view !== "editor" || S.cropMode) return false;
  if (!st.photos?.length || !stageImg()) return false;
  const r = stageImg().getBoundingClientRect();
  if (!(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)) return false;
  if (freeActive()) {
    if (S.freeSel == null) return false;
    const spec = fg().freeSpec();
    const item = spec?.items?.[S.freeSel];
    const rect = imgRect();
    if (!item || !rect) return false;
    const b = freeItemBox(item, { nw: spec.width, nh: spec.height });
    const wrap = document.getElementById("canvasWrap");
    const wrapRect = wrap.getBoundingClientRect();
    const scale = wrap.offsetWidth ? wrapRect.width / wrap.offsetWidth : 1;
    const lx = (e.clientX - wrapRect.left) / scale;
    const ly = (e.clientY - wrapRect.top) / scale;
    const bx = rect.left + b.x * (rect.width / spec.width);
    const by = rect.top + b.y * (rect.height / spec.height);
    const bw = b.w * (rect.width / spec.width);
    const bh = b.h * (rect.height / spec.height);
    if (!(lx >= bx && lx <= bx + bw && ly >= by && ly <= by + bh)) return false;
    toggleCrop();
    return true;
  }
  if (st.mode !== "frame") return false;
  toggleCrop();
  return true;
}
function updateCropInfo() {
  const info = document.getElementById("cropInfo");
  if (!info) return;
  let c = null;
  if (freeActive()) {
    c = S.freeSel != null ? freeItems()[S.freeSel]?.crop ?? null : null;
  } else {
    const u = fg()?.state?.templateId ? uiOf(fg().state.templateId) : null;
    c = u?.crop;
  }
  info.textContent = c
    ? t("crop.info", { x: Math.round(c.x * 100), y: Math.round(c.y * 100), w: Math.round(c.w * 100), h: Math.round(c.h * 100) })
    : t("crop.none");
}
function cropCommitBox() {
  const ov = ensureOverlay();
  return S.cropContainer ?? { x: 0, y: 0, w: ov?.clientWidth ?? 1, h: ov?.clientHeight ?? 1 };
}
function commitCrop() {
  const ov = ensureOverlay();
  if (!ov) return;
  const el = ov.querySelector(".crop-rect");
  if (!el) return;
  const box = cropCommitBox();
  const x = (el.offsetLeft - box.x) / box.w;
  const y = (el.offsetTop - box.y) / box.h;
  const w = el.offsetWidth / box.w;
  const h = el.offsetHeight / box.h;
  S.crop = { x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, 0.02, 1), h: clamp(h, 0.02, 1) };
  applyCrop();
}

/* --------------------------------------------------------------- frame */
// Built-in frame library shipped in web/frame/ (15 slugs, each with a
// `-light` variant). Resolved through `@builtin/frame/<slug>` and registered
// on demand by app.js `ensureBuiltinAssets`.
const FRAME_SLUGS = [
  "barcode", "camera-body", "film-edge", "film-strip", "film-strip-v",
  "icon-boat", "icon-camera", "icon-drone", "icon-film", "icon-lantern",
  "icon-mountain", "icon-pin", "phone-frame", "seal-red", "stamp-card",
];
function frameState() { return fg()?.state?.templateId ? uiOf(fg().state.templateId).frame : null; }
function frameDefaults() {
  return { on: true, asset: "@user/frame", autoDetect: true, scale: 1, inset: 0, offset: { x: 0, y: 0 }, rotation: 0 };
}
async function onFrameFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  fg().state.engine.register_asset("@user/frame", buf);
  const u = uiOf(fg().state.templateId);
  u.frame = { ...frameDefaults(), on: true, asset: "@user/frame" };
  saveUi();
  syncFrameControls();
  applyFrame();
}
function selectBuiltinFrame(slug) {
  const u = uiOf(fg().state.templateId);
  u.frame = { ...frameDefaults(), ...(u.frame ?? {}), on: true, asset: `@builtin/frame/${slug}` };
  saveUi();
  syncFrameControls();
  applyFrame();
}
function buildFrameGrid() {
  const grid = document.getElementById("frameGrid");
  if (!grid) return;
  const active = frameState()?.asset ?? "";
  grid.innerHTML = "";
  for (const slug of FRAME_SLUGS) {
    const cell = document.createElement("div");
    cell.className = `frame-cell${active === `@builtin/frame/${slug}` ? " on" : ""}`;
    cell.dataset.slug = slug;
    cell.title = slug;
    cell.innerHTML = `<img loading="lazy" src="frame/${slug}.png" alt="">`;
    cell.onclick = () => selectBuiltinFrame(slug);
    grid.appendChild(cell);
  }
}
function applyFrame() {
  const u = fg()?.state?.templateId ? uiOf(fg().state.templateId) : null;
  if (!u?.frame?.on) {
    edit((tpl) => { if (tpl.canvas) delete tpl.canvas.frame; }, { history: true });
    buildFrameGrid();
    return;
  }
  edit((tpl) => {
    tpl.canvas ??= { mode: "extend" };
    tpl.canvas.frame = {
      asset: u.frame.asset ?? "@user/frame",
      autoDetect: u.frame.autoDetect !== false,
      scale: u.frame.scale ?? 1,
      inset: u.frame.inset ?? 0,
      offset: { x: u.frame.offset?.x ?? 0, y: u.frame.offset?.y ?? 0 },
      rotation: u.frame.rotation ?? 0,
    };
  }, { history: true });
  buildFrameGrid();
}
function syncFrameControls() {
  const u = frameState();
  const on = document.getElementById("frameOn");
  if (on) on.checked = !!u?.frame?.on;
  const auto = document.getElementById("frameAuto");
  if (auto) auto.checked = u?.frame?.autoDetect !== false;
  const scale = document.getElementById("frameScale");
  if (scale) scale.value = u?.frame?.scale ?? 1;
  const sv = document.getElementById("frameScaleVal");
  if (sv) sv.textContent = `${Math.round((u?.frame?.scale ?? 1) * 100)}%`;
  const inset = document.getElementById("frameInset");
  if (inset) inset.value = u?.frame?.inset ?? 0;
  const iv = document.getElementById("frameInsetVal");
  if (iv) iv.textContent = `${Math.round((u?.frame?.inset ?? 0) * 100)}%`;
  const ox = document.getElementById("frameOffsetX");
  if (ox) ox.value = u?.frame?.offset?.x ?? 0;
  const oxv = document.getElementById("frameOffsetXVal");
  if (oxv) oxv.textContent = `${Math.round((u?.frame?.offset?.x ?? 0) * 100)}%`;
  const oy = document.getElementById("frameOffsetY");
  if (oy) oy.value = u?.frame?.offset?.y ?? 0;
  const oyv = document.getElementById("frameOffsetYVal");
  if (oyv) oyv.textContent = `${Math.round((u?.frame?.offset?.y ?? 0) * 100)}%`;
  const rot = document.getElementById("frameRotation");
  if (rot) rot.value = u?.frame?.rotation ?? 0;
  const rotv = document.getElementById("frameRotationVal");
  if (rotv) rotv.textContent = `${Math.round(u?.frame?.rotation ?? 0)}°`;
  buildFrameGrid();
}

/* ---------------------------------------------------------- card effects */
function ensureCard() {
  const u = uiOf(fg().state.templateId);
  u.card = { on: false, ...CARD_DEFAULTS, ...(u.card ?? {}) };
  return u.card;
}
function cardLabel(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function updateCardLabels(c) {
  cardLabel("cardRadiusVal", `${Math.round((c.radius ?? 0) * 100)}%`);
  cardLabel("cardBlurVal", `${Math.round((c.blur ?? 0) * 100)}%`);
  cardLabel("cardOpacityVal", `${Math.round((c.opacity ?? 0) * 100)}%`);
  cardLabel("cardDxVal", `${Math.round((c.offsetX ?? 0) * 100)}%`);
  cardLabel("cardDyVal", `${Math.round((c.offsetY ?? 0) * 100)}%`);
  cardLabel("cardBorderVal", `${Math.round((c.borderWidth ?? 0) * 1000) / 10}%`);
  cardLabel("cardInnerBlurVal", `${Math.round((c.innerBlur ?? 0) * 100)}%`);
  cardLabel("cardInnerOpacityVal", `${Math.round((c.innerOpacity ?? 0) * 100)}%`);
}
function buildCardControls() {
  if (!fg()?.state?.templateId) return;
  const c = ensureCard();
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  const chk = (id, value) => { const el = document.getElementById(id); if (el) el.checked = !!value; };
  chk("cardOn", c.on);
  chk("cardShadowOn", c.shadowOn !== false);
  chk("cardInnerOn", !!c.innerOn);
  set("cardRadius", c.radius ?? CARD_DEFAULTS.radius);
  set("cardBlur", c.blur ?? CARD_DEFAULTS.blur);
  set("cardOpacity", c.opacity ?? CARD_DEFAULTS.opacity);
  set("cardDx", c.offsetX ?? CARD_DEFAULTS.offsetX);
  set("cardDy", c.offsetY ?? CARD_DEFAULTS.offsetY);
  set("cardBorder", c.borderWidth ?? 0);
  set("cardBorderColor", /^#[0-9a-f]{6}/i.test(c.borderColor ?? "") ? c.borderColor.slice(0, 7) : "#FFFFFF");
  set("cardInnerBlur", c.innerBlur ?? CARD_DEFAULTS.innerBlur);
  set("cardInnerOpacity", c.innerOpacity ?? CARD_DEFAULTS.innerOpacity);
  updateCardLabels(c);
}

/* -------------------------------------------------------------- keyboard */
function onKey(ev) {
  const st = fg()?.state;
  if (!st || st.view !== "editor") return;
  const tag = document.activeElement?.tagName;
  const editing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === "z") {
    if (editing) return;
    ev.preventDefault();
    ev.shiftKey ? redo() : undo();
    return;
  }
  if (mod && ev.key.toLowerCase() === "y") { if (!editing) { ev.preventDefault(); redo(); } return; }
  if (editing) return;
  if (ev.key === "Escape") {
    if (S.cropMode) { toggleCrop(); return; }
    if (fg()?.state?.mode === "collage" && freeActive()) {
      S.freeSel = null;
      buildFreeList();
      drawOverlay();
      return;
    }
    S.selected.clear();
    buildLayersPanel(); buildPropsPanel(); drawOverlay();
    return;
  }
  if (fg()?.state?.mode === "collage" && freeActive() && freeKeyboard(ev)) return;
  const sel = selectedLayers();
  if (!sel.length) return;
  if (ev.key === "Delete" || ev.key === "Backspace") {
    ev.preventDefault();
    edit((tpl) => {
      for (const { layer } of sel) removeLayer(tpl.layers, layer.id);
    });
    S.selected.clear();
    buildLayersPanel(); buildPropsPanel(); drawOverlay();
    return;
  }
  const step = (ev.shiftKey ? 10 : 1);
  const dx = ev.key === "ArrowLeft" ? -step : ev.key === "ArrowRight" ? step : 0;
  const dy = ev.key === "ArrowUp" ? -step : ev.key === "ArrowDown" ? step : 0;
  if (dx || dy) {
    ev.preventDefault();
    const r = imgRect();
    for (const { layer } of sel) {
      edit((tpl) => {
        const hit = findLayer(layer.id, tpl.layers);
        if (hit) {
          hit.layer.offset = {
            x: clamp((hit.layer.offset?.x ?? 0) + dx / (r?.nw ?? 1600), -1, 1),
            y: clamp((hit.layer.offset?.y ?? 0) + dy / (r?.nh ?? 1200), -1, 1),
          };
        }
      }, { history: false });
    }
    commitNow();
  }
}
function removeLayer(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) { list.splice(i, 1); return true; }
    if (list[i].type === "group" && removeLayer(list[i].children ?? [], id)) return true;
  }
  return false;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));

/* --------------------------------------------------------------- init */
function init() {
  const f = fg();
  if (!f) { setTimeout(init, 60); return; }
  loadStore();
  ensureOverlay();

  // Stage pointer events for selection: clicking empty canvas deselects.
  // v0.9.4: listen on window (capture) and resolve the element ourselves.
  // A stale compositor hit test right after heavy updates can report the
  // document root as the event target, which used to swallow real clicks and
  // drags entirely; the app's own geometry decides what was pressed instead.
  window.addEventListener("pointerdown", (e) => {
    const vp = document.getElementById("viewport");
    if (!vp) return;
    const vpr = vp.getBoundingClientRect();
    if (!vpr.width || !vpr.height) return;
    if (e.clientX < vpr.left || e.clientX > vpr.right || e.clientY < vpr.top || e.clientY > vpr.bottom) return;
    const under = document.elementFromPoint(e.clientX, e.clientY) ?? e.target;
    if (under?.closest?.(".handle") || under?.closest?.(".crop-rect")) return;
    if (!stageMatchesFrame()) return;
    if (fg()?.state?.mode === "collage" && freeActive()) {
      if (S.cropMode) return;
      const spec = fg().freeSpec();
      const r = imgRect();
      if (!spec || !r) return;
      const rect = imgRect();
      const items = spec.items;
      for (let i = items.length - 1; i >= 0; i--) {
        const b = freeItemBox(items[i], { nw: spec.width, nh: spec.height });
        const wrap = document.getElementById("canvasWrap");
        const wrapRect = wrap.getBoundingClientRect();
        const scale = wrap.offsetWidth ? wrapRect.width / wrap.offsetWidth : 1;
        const lx = (e.clientX - wrapRect.left) / scale;
        const ly = (e.clientY - wrapRect.top) / scale;
        const bx = rect.left + b.x * (rect.width / spec.width);
        const by = rect.top + b.y * (rect.height / spec.height);
        const bw = b.w * (rect.width / spec.width);
        const bh = b.h * (rect.height / spec.height);
        if (lx >= bx && lx <= bx + bw && ly >= by && ly <= by + bh) {
          S.freeSel = i;
          S.freeSelB = null;
          buildFreeList();
          drawOverlay();
          beginFreeDrag("move", i, e);
          return;
        }
      }
      S.freeSel = null;
      S.freeSelB = null;
      buildFreeList();
      drawOverlay();
      return;
    }
    // v0.9.0: click selects the topmost hit and drags it. A press on the
    // current selection drags THAT layer; a click without movement cycles to
    // the next overlapping layer (overlap pass-through).
    const hits = S.boxes.filter((b) => b.type !== "group" && hitTest(b, e));
    const selectedHit = hits.find((b) => S.selected.has(b.id));
    const target = selectedHit ?? hits[0];
    if (target) {
      if (!S.selected.has(target.id)) select(target.id, e.shiftKey);
      beginDrag("move", target.id, e);
      if (selectedHit && hits.length > 1 && !e.shiftKey) {
        const startX = e.clientX, startY = e.clientY;
        const ids = hits.map((b) => b.id);
        const cycle = (up) => {
          window.removeEventListener("pointerup", cycle);
          if (Math.hypot(up.clientX - startX, up.clientY - startY) > 4) return;
          const next = ids[(ids.indexOf(target.id) + 1) % ids.length];
          select(next, false);
        };
        window.addEventListener("pointerup", cycle, { once: true });
      }
    } else if (!S.cropMode) { S.selected.clear(); buildLayersPanel(); buildPropsPanel(); drawOverlay(); }
  }, true);
  window.addEventListener("keydown", onKey);
  bindButtons();
  bindFreeButtons();
  updateUndoButtons();
  updateCropInfo();
  syncFrameControls();
  buildCardControls();
  if (fg()?.state?.mode === "collage" && freeActive()) buildFreeList();
}
function hitTest(b, e) {
  if (!stageMatchesFrame()) return false;
  const r = imgRect();
  if (!r) return false;
  const wrap = document.getElementById("canvasWrap");
  const wrapRect = wrap.getBoundingClientRect();
  const scale = wrap.offsetWidth ? wrapRect.width / wrap.offsetWidth : 1;
  const lx = (e.clientX - wrapRect.left) / scale;
  const ly = (e.clientY - wrapRect.top) / scale;
  const c = canvasToLocal(b, r);
  return lx >= c.x && lx <= c.x + c.w && ly >= c.y && ly <= c.y + c.h;
}
function beginCropDrag(ev, el) {
  const ov = ensureOverlay();
  const box = cropCommitBox();
  const startX = ev.clientX, startY = ev.clientY;
  const start = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  const resizing = ev.target === el && ev.offsetX > el.offsetWidth - 20 && ev.offsetY > el.offsetHeight - 20;
  const move = (e) => {
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (resizing) {
      let w = Math.max(24, Math.min(box.w, start.w + dx));
      let h = Math.max(24, Math.min(box.h, start.h + dy));
      const asp = cropAspectRatio();
      if (asp) h = Math.min(box.h, w / asp);
      el.style.width = `${w}px`; el.style.height = `${h}px`;
    } else {
      el.style.left = `${clamp(start.x + dx, box.x, box.x + box.w - el.offsetWidth)}px`;
      el.style.top = `${clamp(start.y + dy, box.y, box.y + box.h - el.offsetHeight)}px`;
    }
    commitCropLive(el);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    const ev2 = new Event("change");
    el.dispatchEvent(ev2);
    commitCrop();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
  ev.preventDefault();
  ev.stopPropagation();
}
function cropAspectRatio() {
  const [a, b] = (S.cropAspect ?? "free").split(":").map(Number);
  return a && b ? a / b : null;
}
function commitCropLive(el) {
  const ov = ensureOverlay();
  if (!ov || !el) return;
  const box = cropCommitBox();
  const x = (el.offsetLeft - box.x) / box.w;
  const y = (el.offsetTop - box.y) / box.h;
  const w = el.offsetWidth / box.w;
  const h = el.offsetHeight / ov.clientHeight;
  S.crop = { x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, 0.02, 1), h: clamp(h, 0.02, 1) };
}
function bindButtons() {
  document.getElementById("editUndo")?.addEventListener("click", undo);
  document.getElementById("exifFill")?.addEventListener("click", fillExifPreview);
  document.getElementById("exifClear")?.addEventListener("click", clearExifPreview);
  document.getElementById("editRedo")?.addEventListener("click", redo);
  document.getElementById("layerUp")?.addEventListener("click", () => reorder(-1, false));
  document.getElementById("layerDown")?.addEventListener("click", () => reorder(1, false));
  document.getElementById("layerTop")?.addEventListener("click", () => reorder(-1, true));
  document.getElementById("layerBottom")?.addEventListener("click", () => reorder(1, true));
  document.getElementById("layerDup")?.addEventListener("click", duplicateSelected);
  document.getElementById("layerDel")?.addEventListener("click", () => {
    if (!S.selected.size) return;
    edit((tpl) => { for (const id of S.selected) removeLayer(tpl.layers, id); });
    S.selected.clear();
    buildLayersPanel(); buildPropsPanel(); drawOverlay();
  });
  document.getElementById("layerGroup")?.addEventListener("click", groupSelected);
  document.getElementById("layerUngroup")?.addEventListener("click", ungroupSelected);
  for (const [id, kind] of [
    ["alignLeft", "left"], ["alignCenterH", "centerH"], ["alignRight", "right"],
    ["alignTop", "top"], ["alignMiddleV", "middleV"], ["alignBottom", "bottom"],
  ]) {
    document.getElementById(id)?.addEventListener("click", () => alignSelected(kind));
  }
  document.getElementById("distributeH")?.addEventListener("click", () => distributeSelected("h"));
  document.getElementById("distributeV")?.addEventListener("click", () => distributeSelected("v"));
  document.getElementById("addText")?.addEventListener("click", insertText);
  document.getElementById("addBadge")?.addEventListener("click", insertBadge);
  document.getElementById("addCalendar")?.addEventListener("click", insertCalendar);
  document.getElementById("addDivider")?.addEventListener("click", insertDivider);
  document.getElementById("addShape")?.addEventListener("click", insertShape);
  document.getElementById("addPalette")?.addEventListener("click", insertPalette);
  document.getElementById("addImage")?.addEventListener("click", () => document.getElementById("imgInsertFile")?.click());
  document.getElementById("imgInsertFile")?.addEventListener("change", (e) => {
    if (e.target.files?.[0]) insertImageFile(e.target.files[0]).catch((err) => console.error("insert image:", err));
  });
  document.getElementById("presetSelect")?.addEventListener("change", (e) => {
    if (e.target.value) applyPreset(e.target.value);
    e.target.value = "";
  });
  document.getElementById("cropToggle")?.addEventListener("click", toggleCrop);
  document.getElementById("cropReset")?.addEventListener("click", resetCrop);
  document.getElementById("cropFillW")?.addEventListener("click", () => cropFill("w"));
  document.getElementById("cropFillH")?.addEventListener("click", () => cropFill("h"));
  document.getElementById("cropAspect")?.addEventListener("change", (e) => { S.cropAspect = e.target.value; });
  document.getElementById("frameOn")?.addEventListener("change", (e) => {
    const u = uiOf(fg().state.templateId);
    u.frame = { ...(u.frame ?? {}), on: e.target.checked };
    saveUi(); applyFrame();
  });
  document.getElementById("frameAuto")?.addEventListener("change", (e) => {
    const u = uiOf(fg().state.templateId);
    u.frame = { ...(u.frame ?? {}), autoDetect: e.target.checked, on: true };
    saveUi(); syncFrameControls(); applyFrame();
  });
  document.getElementById("frameScale")?.addEventListener("input", (e) => {
    const u = uiOf(fg().state.templateId);
    u.frame = { ...(u.frame ?? {}), scale: Number(e.target.value), on: true };
    const sv = document.getElementById("frameScaleVal");
    if (sv) sv.textContent = `${Math.round(Number(e.target.value) * 100)}%`;
  });
  document.getElementById("frameScale")?.addEventListener("change", () => { saveUi(); applyFrame(); });
  document.getElementById("frameInset")?.addEventListener("input", (e) => {
    const u = uiOf(fg().state.templateId);
    u.frame = { ...(u.frame ?? {}), inset: Number(e.target.value), on: true };
    const iv = document.getElementById("frameInsetVal");
    if (iv) iv.textContent = `${Math.round(Number(e.target.value) * 100)}%`;
  });
  document.getElementById("frameInset")?.addEventListener("change", () => { saveUi(); applyFrame(); });
  const frameSlider = (id, labelId, key, format) => {
    document.getElementById(id)?.addEventListener("input", (e) => {
      const u = uiOf(fg().state.templateId);
      const value = Number(e.target.value);
      u.frame = { ...(u.frame ?? {}), on: true };
      if (key === "offsetX" || key === "offsetY") {
        const axis = key === "offsetX" ? "x" : "y";
        u.frame.offset = { ...(u.frame.offset ?? {}), [axis]: value };
      } else {
        u.frame[key] = value;
      }
      const el = document.getElementById(labelId);
      if (el) el.textContent = format(value);
    });
    document.getElementById(id)?.addEventListener("change", () => { saveUi(); applyFrame(); });
  };
  frameSlider("frameOffsetX", "frameOffsetXVal", "offsetX", (v) => `${Math.round(v * 100)}%`);
  frameSlider("frameOffsetY", "frameOffsetYVal", "offsetY", (v) => `${Math.round(v * 100)}%`);
  frameSlider("frameRotation", "frameRotationVal", "rotation", (v) => `${Math.round(v)}°`);
  document.getElementById("uploadFrame")?.addEventListener("click", () => document.getElementById("frameFile")?.click());
  document.getElementById("frameFile")?.addEventListener("change", (e) => {
    if (e.target.files?.[0]) onFrameFile(e.target.files[0]).catch((err) => console.error("frame:", err));
  });
  document.getElementById("clearFrame")?.addEventListener("click", () => {
    const u = uiOf(fg().state.templateId);
    u.frame = null;
    saveUi(); syncFrameControls(); applyFrame();
  });
  const cardChk = (id, key) => {
    document.getElementById(id)?.addEventListener("change", (e) => {
      const c = ensureCard();
      c[key] = e.target.checked;
      saveUi();
      buildCardControls();
      safeRender();
    });
  };
  const cardSlider = (id, labelId, key, format) => {
    document.getElementById(id)?.addEventListener("input", (e) => {
      const c = ensureCard();
      c[key] = Number(e.target.value);
      const el = document.getElementById(labelId);
      if (el) el.textContent = format(Number(e.target.value));
    });
    document.getElementById(id)?.addEventListener("change", () => { saveUi(); buildCardControls(); safeRender(); });
  };
  cardChk("cardOn", "on");
  cardChk("cardShadowOn", "shadowOn");
  cardChk("cardInnerOn", "innerOn");
  cardSlider("cardRadius", "cardRadiusVal", "radius", (v) => `${Math.round(v * 100)}%`);
  cardSlider("cardBlur", "cardBlurVal", "blur", (v) => `${Math.round(v * 100)}%`);
  cardSlider("cardOpacity", "cardOpacityVal", "opacity", (v) => `${Math.round(v * 100)}%`);
  cardSlider("cardDx", "cardDxVal", "offsetX", (v) => `${Math.round(v * 100)}%`);
  cardSlider("cardDy", "cardDyVal", "offsetY", (v) => `${Math.round(v * 100)}%`);
  cardSlider("cardBorder", "cardBorderVal", "borderWidth", (v) => `${Math.round(v * 1000) / 10}%`);
  cardSlider("cardInnerBlur", "cardInnerBlurVal", "innerBlur", (v) => `${Math.round(v * 100)}%`);
  cardSlider("cardInnerOpacity", "cardInnerOpacityVal", "innerOpacity", (v) => `${Math.round(v * 100)}%`);
  document.getElementById("cardBorderColor")?.addEventListener("input", (e) => {
    const c = ensureCard();
    c.borderColor = e.target.value;
  });
  document.getElementById("cardBorderColor")?.addEventListener("change", () => { saveUi(); safeRender(); });
}
function reorder(dir, extreme) {
  const sel = [...S.selected];
  if (!sel.length) return;
  edit((tpl) => {
    const list = tpl.layers;
    for (const id of sel) {
      const i = list.findIndex((l) => l.id === id);
      if (i < 0) continue;
      const [layer] = list.splice(i, 1);
      const target = extreme ? (dir < 0 ? list.length : 0) : clamp(i + dir, 0, list.length);
      list.splice(target, 0, layer);
    }
  });
}
function duplicateSelected() {
  const sel = selectedLayers();
  if (!sel.length) return;
  const fresh = [];
  edit((tpl) => {
    for (const { layer, parent } of sel) {
      if (parent) continue; // duplicates only at top level for now
      const copy = structuredClone(layer);
      copy.id = newId(`${layer.id}-copy`, tpl);
      if (copy.offset) copy.offset = { x: (copy.offset.x ?? 0) + 0.02, y: (copy.offset.y ?? 0) + 0.02 };
      tpl.layers.push(copy);
      fresh.push(copy.id);
    }
  });
  S.selected = new Set(fresh);
  buildLayersPanel(); buildPropsPanel(); drawOverlay();
}
function groupSelected() {
  const ids = [...S.selected];
  if (ids.length < 2) { fg()?.toast?.("error", t("layers.needTwo")); return; }
  let gid = null;
  edit((tpl) => {
    const moved = [];
    tpl.layers = tpl.layers.filter((l) => {
      if (ids.includes(l.id)) { moved.push(l); return false; }
      return true;
    });
    if (!moved.length) return;
    gid = newId("group", tpl);
    tpl.layers.push({ type: "group", id: gid, anchor: "top-left", offset: { x: 0, y: 0 }, opacity: 1, children: moved });
  });
  if (gid) { S.selected = new Set([gid]); buildLayersPanel(); buildPropsPanel(); drawOverlay(); }
}
/** v0.5.0: move group children back to top level, preserving absolute positions. */
async function ungroupSelected() {
  const groups = selectedLayers().filter(({ layer }) => layer.type === "group");
  if (!groups.length) { fg()?.toast?.("error", t("layers.ungroupHint")); return; }
  await refreshBoxes();
  const { w: fw, h: fh } = canvasFrame();
  const boxes = boxesById();
  edit((tpl) => {
    for (const { layer: g } of groups) {
      const idx = tpl.layers.findIndex((l) => l.id === g.id);
      if (idx < 0) continue;
      const box = boxes.get(g.id);
      const gw = box?.w ?? fw;
      const gh = box?.h ?? fh;
      const gx = box?.x ?? 0;
      const gy = box?.y ?? 0;
      const kids = g.children ?? [];
      for (const kid of kids) {
        // Convert group-relative offsets (anchored inside the group box) into
        // canvas-relative offsets so the layer does not visually move.
        const [row, col] = (kid.anchor ?? "top-left").split("-");
        const dx = col === "center" ? (fw - gw) / 2 : col === "right" ? fw - gw : 0;
        const dy = row === "middle" ? (fh - gh) / 2 : row === "bottom" ? fh - gh : 0;
        kid.offset = {
          x: clamp(((kid.offset?.x ?? 0) * gw + dx + gx) / fw, -1, 1),
          y: clamp(((kid.offset?.y ?? 0) * gh + dy + gy) / fh, -1, 1),
        };
      }
      tpl.layers.splice(idx, 1, ...kids);
    }
  });
  S.selected.clear();
  buildLayersPanel();
  buildPropsPanel();
  drawOverlay();
}
/** v0.5.0: align/distribute selected layer boxes (engine layer_boxes). */
function alignBoxes() {
  const ids = new Set(S.selected);
  return S.boxes.filter((b) => ids.has(b.id) && b.type !== "group");
}
async function applyBoxDeltas(moves) {
  if (!moves.length) return;
  const { w: fw, h: fh } = canvasFrame();
  edit((tpl) => {
    for (const m of moves) {
      if (!m.dx && !m.dy) continue;
      const hit = findLayer(m.id, tpl.layers);
      if (!hit) continue;
      hit.layer.offset = {
        x: clamp((hit.layer.offset?.x ?? 0) + m.dx / fw, -1, 1),
        y: clamp((hit.layer.offset?.y ?? 0) + m.dy / fh, -1, 1),
      };
    }
  });
}
async function alignSelected(kind) {
  await refreshBoxes();
  const boxes = alignBoxes();
  if (boxes.length < 2) return;
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const moves = boxes.map((b) => {
    let dx = 0, dy = 0;
    if (kind === "left") dx = minX - b.x;
    else if (kind === "centerH") dx = cx - (b.x + b.w / 2);
    else if (kind === "right") dx = maxX - (b.x + b.w);
    else if (kind === "top") dy = minY - b.y;
    else if (kind === "middleV") dy = cy - (b.y + b.h / 2);
    else if (kind === "bottom") dy = maxY - (b.y + b.h);
    return { id: b.id, dx, dy };
  });
  await applyBoxDeltas(moves);
}
/** Equal gaps between layer bounding boxes along one axis. */
async function distributeSelected(axis) {
  await refreshBoxes();
  const boxes = alignBoxes();
  if (boxes.length < 2) return;
  const horiz = axis === "h";
  const sorted = [...boxes].sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
  const pos = (b) => (horiz ? b.x : b.y);
  const size = (b) => (horiz ? b.w : b.h);
  const start = pos(sorted[0]);
  const end = pos(sorted[sorted.length - 1]) + size(sorted[sorted.length - 1]);
  const total = sorted.reduce((a, b) => a + size(b), 0);
  const gap = (end - start - total) / Math.max(1, sorted.length - 1);
  let cursor = start;
  const moves = sorted.map((b) => {
    const d = cursor - pos(b);
    cursor += size(b) + gap;
    return horiz ? { id: b.id, dx: d, dy: 0 } : { id: b.id, dx: 0, dy: d };
  });
  await applyBoxDeltas(moves);
}

/* ------------------------------------------------- free collage (v0.5 M5) */
function freeActive() {
  return fg()?.freeActive?.() === true;
}
function freeItems() {
  return fg()?.freeSpec?.()?.items ?? [];
}
function mutateFree(fn) {
  fg()?.updateFreeSpec?.(fn);
}
function freeItemBox(item, r) {
  const spec = fg().freeSpec();
  const nw = r.nw;
  const nh = r.nh;
  const w = item.w * nw;
  // Mirror the engine: explicit h is normalized to canvas height; otherwise the
  // box keeps the photo's oriented aspect ratio (ar = height / width).
  const ar = fg()?.state?.photos?.[item.photo]?.ar;
  const h = item.h != null
    ? item.h * spec.height
    : ar ? item.w * spec.width * ar
      : 0.75 * spec.height / spec.width * nw;
  const cx = item.x * nw;
  const cy = item.y * nh;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rotation: item.rotation ?? 0 };
}
function buildFreeList() {
  const box = document.getElementById("freeList");
  if (!box) return;
  box.innerHTML = "";
  const items = freeItems();
  items.forEach((item, idx) => {
    const row = document.createElement("div");
    const on = S.freeSel === idx || S.freeSelB === idx;
    row.className = "layer-row" + (on ? " on" : "");
    const name = fg().state.photos[item.photo]?.name ?? `#${item.photo}`;
    row.innerHTML = `<span class="lname">${escapeHtml(name)}</span><span class="ltag">z${item.z ?? idx}</span>`;
    row.title = t("free.multiHint");
    row.onclick = (e) => {
      if (e.shiftKey && S.freeSel != null && S.freeSel !== idx) {
        S.freeSelB = S.freeSelB === idx ? null : idx;
      } else {
        S.freeSel = idx;
        S.freeSelB = null;
      }
      buildFreeList();
      drawOverlay();
    };
    box.appendChild(row);
  });
  syncFreeItemControls();
}
/** Radius/stroke controls mirror the selected free item. */
function syncFreeItemControls() {
  const item = S.freeSel != null ? freeItems()[S.freeSel] : null;
  const radius = item?.radius ?? 0;
  const width = item?.border?.width ?? 0;
  const color = /^#[0-9a-f]{6}$/i.test(item?.border?.color ?? "") ? item.border.color : "#FFFFFF";
  const rEl = document.getElementById("freeRadius");
  if (rEl) rEl.value = radius;
  const rv = document.getElementById("freeRadiusVal");
  if (rv) rv.textContent = `${Math.round(radius * 100)}%`;
  const wEl = document.getElementById("freeStrokeW");
  if (wEl) wEl.value = width;
  const wv = document.getElementById("freeStrokeVal");
  if (wv) wv.textContent = `${Math.round(width)}px`;
  const cEl = document.getElementById("freeStrokeColor");
  if (cEl) cEl.value = color;
}
function applyFreeItemProps() {
  const idx = S.freeSel;
  if (idx == null) return;
  const radius = Number(document.getElementById("freeRadius")?.value ?? 0);
  const width = Number(document.getElementById("freeStrokeW")?.value ?? 0);
  const color = document.getElementById("freeStrokeColor")?.value ?? "#FFFFFF";
  mutateFree((s) => {
    const it = s.items[idx];
    if (!it) return;
    if (radius > 0) it.radius = radius; else delete it.radius;
    if (width > 0) it.border = { width, color }; else delete it.border;
  });
  syncFreeItemControls();
}
/** Swap x/y/size/rotation between two selected items (first + last when only
 *  one row is selected — see the button title). */
function swapFreeItems() {
  const items = freeItems();
  if (items.length < 2) { fg()?.toast?.("error", t("free.needSelect")); return; }
  let a = S.freeSel;
  let b = S.freeSelB != null && S.freeSelB !== a ? S.freeSelB : null;
  if (b == null) { a = 0; b = items.length - 1; }
  mutateFree((s) => {
    const A = s.items[a], B = s.items[b];
    if (!A || !B) return;
    const geom = [A.x, A.y, A.w, A.h, A.rotation];
    [A.x, A.y, A.w, A.h, A.rotation] = [B.x, B.y, B.w, B.h, B.rotation];
    [B.x, B.y, B.w, B.h, B.rotation] = geom;
  });
  buildFreeList();
}
/** Re-layout every photo into a grid using the chosen gap + margin (canvas
 *  normalized coordinates, photo order preserved). */
function relayoutFree() {
  const spec = fg()?.freeSpec?.();
  if (!spec || !spec.items.length) return;
  const gap = clamp(Number(document.getElementById("freeGap")?.value ?? 0.02), 0, 0.2);
  const margin = clamp(Number(document.getElementById("freeMargin")?.value ?? 0.02), 0, 0.2);
  const n = spec.items.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const W = spec.width, H = spec.height;
  const unit = Math.min(W, H);
  const mpx = margin * unit;
  const gpx = gap * unit;
  const cellW = (W - 2 * mpx - (cols - 1) * gpx) / cols;
  const cellH = (H - 2 * mpx - (rows - 1) * gpx) / rows;
  mutateFree((s) => {
    s.items.forEach((it, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const ar = fg()?.state?.photos?.[it.photo]?.ar ?? 0.75; // height / width
      const wPx = ar > 0 ? Math.min(cellW, cellH / ar) : cellW;
      it.x = (mpx + col * (cellW + gpx) + cellW / 2) / W;
      it.y = (mpx + row * (cellH + gpx) + cellH / 2) / H;
      it.w = Math.max(0.02, wPx / W);
      delete it.h;
    });
  });
  buildFreeList();
}
function drawFreeOverlay(ov, r) {
  const items = freeItems();
  const spec = fg().freeSpec();
  const scaleX = r.width / spec.width;
  const scaleY = r.height / spec.height;
  items.forEach((item, idx) => {
    const b = freeItemBox(item, { nw: spec.width, nh: spec.height });
    const x = r.left + b.x * scaleX;
    const y = r.top + b.y * scaleY;
    const w = b.w * scaleX;
    const h = b.h * scaleY;
    const el = document.createElement("div");
    const on = S.freeSel === idx || S.freeSelB === idx;
    el.className = "box" + (on ? "" : " dim");
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.width = `${w}px`; el.style.height = `${h}px`;
    if (b.rotation) el.style.transform = `rotate(${b.rotation}deg)`;
    ov.appendChild(el);
    if (S.freeSel === idx && !S.cropMode) {
      const mk = (hx, hy, kind) => {
        const hd = document.createElement("div");
        hd.className = "handle" + (kind === "rot" ? " rot" : "");
        hd.style.left = `${hx}px`; hd.style.top = `${hy}px`;
        hd.dataset.free = String(idx); hd.dataset.kind = kind;
        ov.appendChild(hd);
      };
      mk(x + w, y + h, "scale");
      mk(x + w / 2, y, "rot");
    }
    if (S.cropMode && S.freeSel === idx) drawCropRect(ov, x, y, w, h);
  });
  ov.classList.toggle("editing", S.freeSel != null || S.cropMode);
}
function beginFreeDrag(kind, idx, ev) {
  const r = imgRect();
  const spec = fg().freeSpec();
  if (!r || !spec) return;
  const item = spec.items[idx];
  const visible = (stageImg() ?? S.img).getBoundingClientRect();
  S.freeDrag = {
    kind, idx,
    startX: ev.clientX, startY: ev.clientY,
    item: { ...item },
    scaleX: (visible.width || r.width) / spec.width,
    scaleY: (visible.height || r.height) / spec.height,
  };
  window.addEventListener("pointermove", onFreeDragMove);
  window.addEventListener("pointerup", endFreeDrag, { once: true });
  ev.preventDefault();
  ev.stopPropagation();
}
function onFreeDragMove(ev) {
  const d = S.freeDrag;
  if (!d) return;
  const spec = fg().freeSpec();
  if (!spec) return;
  const dvx = (ev.clientX - d.startX) / d.scaleX;
  const dvy = (ev.clientY - d.startY) / d.scaleY;
  mutateFree((s) => {
    const it = s.items[d.idx];
    if (!it) return;
    if (d.kind === "move") {
      it.x = clamp(d.item.x + dvx / spec.width, -0.5, 1.5);
      it.y = clamp(d.item.y + dvy / spec.height, -0.5, 1.5);
    } else if (d.kind === "scale") {
      const base = freeItemBox(d.item, { nw: spec.width, nh: spec.height });
      const f = Math.max((base.w + dvx) / Math.max(1, base.w), (base.h + dvy) / Math.max(1, base.h));
      it.w = clamp(d.item.w * f, 0.05, 2);
      if (d.item.h != null) it.h = clamp(d.item.h * f, 0.05, 2);
    } else if (d.kind === "rot") {
      const r = imgRect();
      const cx = r.left + (it.x * spec.width / spec.width) * r.width;
      const cy = r.top + (it.y) * r.height;
      const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
      const snapped = Math.abs(((ang % 15) + 15) % 15) < 3 ? Math.round(ang / 15) * 15 : ang;
      it.rotation = Math.round(snapped * 10) / 10;
    }
  });
}
function endFreeDrag() {
  window.removeEventListener("pointermove", onFreeDragMove);
  S.freeDrag = null;
}
function freeKeyboard(ev) {
  const items = freeItems();
  if (S.freeSel == null || !items[S.freeSel]) return false;
  const spec = fg().freeSpec();
  if (ev.key === "Delete" || ev.key === "Backspace") {
    ev.preventDefault();
    mutateFree((s) => { s.items.splice(S.freeSel, 1); });
    S.freeSel = Math.min(S.freeSel, Math.max(0, items.length - 2));
    S.freeSelB = null;
    buildFreeList();
    return true;
  }
  const step = ev.shiftKey ? 10 : 1;
  const dx = ev.key === "ArrowLeft" ? -step : ev.key === "ArrowRight" ? step : 0;
  const dy = ev.key === "ArrowUp" ? -step : ev.key === "ArrowDown" ? step : 0;
  if (dx || dy) {
    ev.preventDefault();
    mutateFree((s) => {
      const it = s.items[S.freeSel];
      if (!it) return;
      it.x = clamp((it.x ?? 0) + dx / spec.width, -0.5, 1.5);
      it.y = clamp((it.y ?? 0) + dy / spec.height, -0.5, 1.5);
    });
    return true;
  }
  return false;
}
function bindFreeButtons() {
  document.getElementById("freeAdd")?.addEventListener("click", () => {
    const photos = fg().state.photos.length || 1;
    mutateFree((s) => {
      const idx = s.items.length % photos;
      s.items.push({ photo: idx, x: 0.5, y: 0.5, w: 0.4, rotation: 0, z: s.items.length });
    });
    S.freeSel = freeItems().length - 1;
    S.freeSelB = null;
    buildFreeList();
    drawOverlay();
  });
  document.getElementById("freeSwap")?.addEventListener("click", () => {
    swapFreeItems();
    drawOverlay();
  });
  document.getElementById("freeFront")?.addEventListener("click", () => {
    mutateFree((s) => { const it = s.items[S.freeSel]; if (it) it.z = Math.max(...s.items.map((x) => x.z ?? 0)) + 1; });
    buildFreeList();
  });
  document.getElementById("freeBack")?.addEventListener("click", () => {
    mutateFree((s) => { const it = s.items[S.freeSel]; if (it) it.z = Math.min(...s.items.map((x) => x.z ?? 0)) - 1; });
    buildFreeList();
  });
  document.getElementById("freeDel")?.addEventListener("click", () => {
    if (S.freeSel == null) return;
    mutateFree((s) => { s.items.splice(S.freeSel, 1); });
    S.freeSel = null;
    S.freeSelB = null;
    buildFreeList();
    drawOverlay();
  });
  const itemSlider = (id, labelId, fmt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const lv = document.getElementById(labelId);
      if (lv) lv.textContent = fmt(Number(el.value));
      applyFreeItemProps();
    });
  };
  itemSlider("freeRadius", "freeRadiusVal", (v) => `${Math.round(v * 100)}%`);
  itemSlider("freeStrokeW", "freeStrokeVal", (v) => `${Math.round(v)}px`);
  document.getElementById("freeStrokeColor")?.addEventListener("input", () => applyFreeItemProps());
  const gridSlider = (id, labelId) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const lv = document.getElementById(labelId);
      if (lv) lv.textContent = `${Math.round(Number(el.value) * 100)}%`;
    });
  };
  gridSlider("freeGap", "freeGapVal");
  gridSlider("freeMargin", "freeMarginVal");
  document.getElementById("freeRelayout")?.addEventListener("click", () => {
    relayoutFree();
    drawOverlay();
  });
}

/* ----------------------------------------------------- watermark hooks */
function allTextLayers(tpl) {
  return allLayers(tpl.layers ?? []).map((x) => x.layer).filter((l) => l.type === "text");
}
/** v0.5.0 watermark panel: uniform letterSpacing delta (em) applied on top of
 *  each text layer's template default, through the editor edit model. */
function applyWatermarkSpacing(delta) {
  if (fg()?.state?.mode !== "frame") return;
  const orig = fg()?.currentTemplateObject();
  if (!orig) return;
  const base = new Map(allTextLayers(orig).map((l) => [l.id, l.letterSpacing ?? 0]));
  const v = clamp(Number(delta) || 0, -0.05, 0.5);
  edit((tpl) => {
    for (const l of allTextLayers(tpl)) {
      l.letterSpacing = clamp((base.get(l.id) ?? 0) + v, -0.05, 0.5);
    }
  });
}
function selectFirstText() {
  if (fg()?.state?.mode !== "frame") { fg()?.toast?.("error", t("wm.frameOnly")); return false; }
  const first = allTextLayers(baseTemplate() ?? {})[0];
  if (!first) { fg()?.toast?.("error", t("wm.noText")); return false; }
  select(first.id);
  return true;
}

/* ------------------------------------------------------------ app hooks */
/* ------------------------------------------------ v0.6.0 EXIF preview fill */
let SAMPLE_PROFILES = null;
function photoHasExif() {
  const info = fg()?.state?.photos?.[0]?.exif;
  return !!(info && (info.model || info.datetime || info.lens));
}
async function loadSampleProfiles() {
  if (SAMPLE_PROFILES) return SAMPLE_PROFILES;
  try {
    SAMPLE_PROFILES = (await (await fetch("./examples/exif.json")).json()).profiles ?? {};
  } catch {
    SAMPLE_PROFILES = {};
  }
  return SAMPLE_PROFILES;
}
function updateExifHint() {
  const hint = document.getElementById("exifHint");
  if (!hint) return;
  const photo = fg()?.state?.photos?.[0];
  const id = fg()?.state?.templateId;
  const u = id ? uiOf(id) : null;
  const show = !!photo && !photoHasExif();
  hint.classList.toggle("hidden", !show);
  const clear = document.getElementById("exifClear");
  if (clear) clear.disabled = !u?.exifPreview;
}
async function fillExifPreview() {
  const id = fg()?.state?.templateId;
  if (!id) return;
  const profiles = await loadSampleProfiles();
  const portrait = (fg()?.state?.photos?.[0]?.ar ?? 0) > 1;
  const profile = profiles[portrait ? "sony-a7r3" : "nikon-z6ii"] ?? profiles["sony-a7r3"];
  if (!profile) return;
  uiOf(id).exifPreview = { ...profile };
  saveUi();
  updateExifHint();
  safeRender();
}
function clearExifPreview() {
  const id = fg()?.state?.templateId;
  if (!id) return;
  uiOf(id).exifPreview = null;
  saveUi();
  updateExifHint();
  safeRender();
}

window.__fgEditor = {
  applyEdits,
  editorOverrides,
  onStageDblClick,
  applyWatermarkSpacing,
  selectFirstText,
  // v0.9.4: geometry/selection probes + the manual locate fallback.
  boxes: () => S.boxes,
  boxFrame: () => (S.boxFrame ? { ...S.boxFrame } : null),
  stageMatchesFrame: () => stageMatchesFrame(),
  selection: () => [...S.selected],
  /// v0.9.4 E2E: boxes under a client point (same hitTest the stage uses).
  hitAt: (clientX, clientY) => S.boxes.filter((b) => b.type !== "group" && hitTest(b, { clientX, clientY })).map((b) => b.id),
  /// v0.9.4 E2E: a layer box in client (viewport) pixels for real input events.
  boxClientRect(id) {
    const b = boxesById().get(id);
    const r = imgRect();
    const img = stageImg();
    if (!b || !r || !img || !stageMatchesFrame()) return null;
    const c = canvasToLocal(b, r);
    const ir = img.getBoundingClientRect();
    const scale = ir.width / Math.max(1, r.width);
    return { x: ir.left + c.x * scale, y: ir.top + c.y * scale, w: c.w * scale, h: c.h * scale };
  },
  refreshBoxes,
  locateSelected,
  freeSelection: () => ({ a: S.freeSel, b: S.freeSelB }),
  onTemplateChanged() {
    trace("template-changed", fg()?.state?.templateId);
    S.selected.clear();
    S.crop = null;
    S.cropMode = false;
    S.cropTarget = "frame";
    S.freeSel = null;
    S.freeSelB = null;
    loadStore();
    const id = fg()?.state?.templateId;
    if (id) {
      const edits = loadEdits();
      const orig = fg().currentTemplateObject();
      const base = edits[id] ?? (orig ? JSON.stringify(orig) : null);
      if (base) S.history[id] = { stack: [base], index: 0 };
    }
    const u = id ? uiOf(id) : null;
    S.crop = u?.crop ? { ...u.crop } : null;
    buildLayersPanel();
    buildPropsPanel();
    updateUndoButtons();
    updateCropInfo();
    syncFrameControls();
    buildCardControls();
    updateExifHint();
    drawOverlay();
  },
  onModeChanged(mode) {
    S.selected.clear();
    S.cropMode = false;
    S.cropTarget = "frame";
    S.freeSelB = null;
    const overlay = document.querySelector(".edit-overlay");
    if (overlay) overlay.style.display = mode === "frame" || freeActive() ? "" : "none";
    buildLayersPanel();
    buildPropsPanel();
    if (freeActive()) buildFreeList();
    updateCropInfo();
    drawOverlay();
  },
  onStage(img) {
    S.img = img;
    updateExifHint();
  },
  // v0.9.4: boxes refresh once the new frame is actually painted (setStage
  // keeps the previous frame on screen until then, so refreshing earlier
  // would briefly describe a frame that is not displayed yet).
  onStageLoaded: async () => { await refreshBoxes(); drawOverlay(); },
  refresh: async () => { await refreshBoxes(); drawOverlay(); },
  freeState: () => ({
    free: !!fg()?.state?.freeCollage,
    sel: S.freeSel,
    selB: S.freeSelB,
    drag: S.freeDrag ? { kind: S.freeDrag.kind, idx: S.freeDrag.idx, startX: S.freeDrag.startX, startY: S.freeDrag.startY } : null,
    items: (fg()?.freeSpec()?.items ?? []).map((it) => [it.x, it.y, it.w]),
  }),
  debug: () => ({
    trace: TRACE.slice(-40),
    tplId: fg()?.state?.templateId ?? null,
    cached: !!fg()?.currentTemplateObject?.(),
    base: (() => { try { return !!baseTemplate(); } catch (e) { return "ERR " + (e && e.message); } })(),
    boxes: S.boxes.map((b) => b.id),
    stageReady: !!(S.img && S.img.isConnected && S.img === document.querySelector("#canvasWrap img")),
    stageMatches: stageMatchesFrame(),
    selected: [...S.selected],
    cropMode: S.cropMode,
    history: Object.fromEntries(Object.entries(S.history).map(([k, v]) => [k, { len: v.stack.length, index: v.index }])),
  }),
  // v0.8.0 badge library: layer-level asset replacement.
  badgeTarget,
  setBadgeAsset,
  swapBadgeStyle,
  isBadgeLayer,
};
init();

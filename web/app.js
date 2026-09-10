import init, { Engine } from "./pkg/framegeist_wasm.js";
import { initI18n, setLang, t, currentLang } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const BASE = new URL(".", document.baseURI).href;
const CC_REPO = "meihuaanying/framegeist";

const state = {
  engine: null,
  templates: [],
  layouts: [],
  photos: [], // { bytes: Uint8Array, name: string }
  mode: "frame",
  templateId: null,
  layoutId: null,
  lastRender: null,
  lastRenderName: null,
  sourceUrl: null,
};

const OPT_KEYS = { theme: "fg-theme", lang: "fg-lang", overrides: "fg-overrides-v1" };

/* ---------------- theme (auto / light / dark) ---------------- */
function currentTheme() { return localStorage.getItem(OPT_KEYS.theme) ?? "auto"; }
function applyTheme() {
  const mode = currentTheme();
  const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const btn = $("themeBtn");
  if (btn) {
    btn.textContent = mode === "auto" ? "◐" : mode === "light" ? "☀" : "☾";
    btn.title = t(`theme.${mode}`);
  }
}
function cycleTheme() {
  const order = ["auto", "light", "dark"];
  const next = order[(order.indexOf(currentTheme()) + 1) % 3];
  localStorage.setItem(OPT_KEYS.theme, next);
  applyTheme();
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentTheme() === "auto") applyTheme();
});

/* ---------------- overrides (per template) ---------------- */
function overridesStore() {
  try { return JSON.parse(localStorage.getItem(OPT_KEYS.overrides) ?? "{}"); } catch { return {}; }
}
function loadOverrides(id) { return overridesStore()[id] ?? { fontSizeScale: 1, paddingScale: 1, useColor: false, textColor: "#111111" }; }
function saveOverrides(id, o) {
  const store = overridesStore();
  const def = { fontSizeScale: 1, paddingScale: 1, useColor: false, textColor: "#111111" };
  if (JSON.stringify({ ...def, ...o }) === JSON.stringify(def)) delete store[id];
  else store[id] = o;
  localStorage.setItem(OPT_KEYS.overrides, JSON.stringify(store));
  updateTweakUI();
}
function overridesJson() {
  if (state.mode !== "frame" || !state.templateId) return "";
  const o = loadOverrides(state.templateId);
  const out = {};
  if (o.fontSizeScale && o.fontSizeScale !== 1) out.fontSizeScale = o.fontSizeScale;
  if (o.paddingScale && o.paddingScale !== 1) out.paddingScale = o.paddingScale;
  if (o.useColor && o.textColor) out.textColor = o.textColor;
  return Object.keys(out).length ? JSON.stringify(out) : "";
}
function updateTweakUI() {
  const o = state.templateId ? loadOverrides(state.templateId) : { fontSizeScale: 1, paddingScale: 1, useColor: false, textColor: "#111111" };
  $("sizeRange").value = o.fontSizeScale ?? 1;
  $("sizeVal").textContent = `${Math.round((o.fontSizeScale ?? 1) * 100)}%`;
  $("padRange").value = o.paddingScale ?? 1;
  $("padVal").textContent = `${Math.round((o.paddingScale ?? 1) * 100)}%`;
  $("useColor").checked = !!o.useColor;
  $("colorPick").value = o.textColor ?? "#111111";
  $("colorPick").disabled = !o.useColor;
}
function pushOverride(patch) {
  if (!state.templateId) return;
  const o = { fontSizeScale: 1, paddingScale: 1, useColor: false, textColor: "#111111", ...loadOverrides(state.templateId), ...patch };
  saveOverrides(state.templateId, o);
}

/* ---------------- status + toasts ---------------- */
function setStatus(kind, text) {
  const pill = $("statusPill");
  pill.className = `pill ${kind}`;
  $("statusText").textContent = text;
}
function toast(kind, text) {
  const box = document.createElement("div");
  box.className = `toast ${kind}`;
  box.textContent = text;
  $("toasts").appendChild(box);
  setTimeout(() => box.remove(), kind === "error" ? 7000 : 3500);
}

/* ---------------- boot ---------------- */
async function boot() {
  initI18n();
  applyTheme();
  setStatus("busy", t("status.boot"));

  let engine;
  try {
    await init({ module_or_path: "./pkg/framegeist_wasm_bg.wasm" });
  } catch (e) {
    setStatus("error", `${t("err.wasm")}: ${e.message || e}`);
    return;
  }
  try {
    const fontRes = await fetch(BASE + "templates/fonts/JetBrainsMono-Regular.ttf");
    if (!fontRes.ok) throw new Error("HTTP " + fontRes.status);
    engine = new Engine(["JetBrains Mono"], [new Uint8Array(await fontRes.arrayBuffer())]);
  } catch (e) {
    setStatus("error", `${t("err.font")}: ${e.message || e}`);
    return;
  }
  state.engine = engine;

  state.templates = await (await fetch(BASE + "templates.json")).json();
  state.layouts = await (await fetch(BASE + "layouts.json")).json();
  state.templateId = state.templates[0]?.id ?? null;
  state.layoutId = state.layouts[0]?.id ?? null;
  buildTemplatePicker();
  buildLayoutPicker();
  updateTweakUI();
  setStatus("ready", t("status.ready"));
  window.__bootMs = Math.round(performance.now());
}

/* ---------------- pickers ---------------- */
const CATS = ["classic-white", "film", "polaroid", "gallery", "technical", "magazine", "minimal", "frame-shell"];
let activeCat = "all";
let templateQuery = "";

function buildTemplatePicker() {
  const chips = $("catChips");
  chips.innerHTML = "";
  const mk = (id, label) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = activeCat === id ? "on" : "";
    b.onclick = () => { activeCat = id; buildTemplatePicker(); };
    chips.appendChild(b);
  };
  mk("all", t("template.all"));
  for (const c of CATS) mk(c, c);

  const grid = $("templateGrid");
  grid.innerHTML = "";
  const list = state.templates.filter(
    (x) => (activeCat === "all" || x.category === activeCat) &&
      (!templateQuery || x.name.toLowerCase().includes(templateQuery) || x.id.includes(templateQuery))
  );
  for (const tpl of list) {
    const cell = document.createElement("div");
    cell.className = `thumb${tpl.id === state.templateId ? " on" : ""}`;
    cell.title = `${tpl.category} · ${tpl.name}`;
    cell.innerHTML = `<img loading="lazy" src="./thumbs/${tpl.id}.jpg" alt=""><span class="tname">${tpl.name}</span>`;
    cell.onclick = () => {
      state.templateId = tpl.id;
      buildTemplatePicker();
      updateTweakUI();
      renderNow();
    };
    grid.appendChild(cell);
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
      `<div class="lname">${lay.slots} 格</div>`;
    cell.onclick = () => {
      state.layoutId = lay.id;
      buildLayoutPicker();
      renderNow();
    };
    grid.appendChild(cell);
  }
}

/* ---------------- photos ---------------- */
async function acceptFiles(fileList) {
  const files = [...fileList].filter((f) => /image\//.test(f.type) || /\.(jpe?g|png|webp|tiff?|heic|heif)$/i.test(f.name));
  if (!files.length) {
    toast("error", t("err.decode"));
    return;
  }
  state.photos = [];
  for (const f of files) {
    state.photos.push({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name });
  }
  showSource();
  showExif();
  updateFileMeta();
  await renderNow();
}

function updateFileMeta() {
  const meta = $("fileMeta");
  meta.innerHTML = "";
  if (!state.photos.length) return;
  if (state.photos.length === 1) {
    const s = document.createElement("span");
    s.className = "name";
    s.textContent = state.photos[0].name;
    meta.appendChild(s);
  } else {
    const s = document.createElement("span");
    s.className = "name";
    s.textContent = t("drop.multi", { n: state.photos.length });
    meta.appendChild(s);
  }
  const bytes = state.photos[0].bytes;
  const kb = bytes.length / 1024;
  const info = document.createElement("span");
  info.className = "muted";
  info.textContent = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
  meta.appendChild(info);
}

function showSource() {
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  if (!state.photos.length) return;
  const blob = new Blob([state.photos[0].bytes]);
  state.sourceUrl = URL.createObjectURL(blob);
  setStageImage(state.sourceUrl, t("stage.original"));
}

function setStageImage(url, label) {
  const stage = $("stage");
  stage.innerHTML = "";
  const img = new Image();
  img.src = url;
  stage.appendChild(img);
  $("stageLabel").textContent = label;
}

/* ---------------- exif panel ---------------- */
function showExif() {
  const dl = $("exifList");
  dl.innerHTML = "";
  if (!state.photos.length) return;
  let info;
  try {
    info = JSON.parse(state.engine.probe_exif(state.photos[0].bytes));
  } catch (e) {
    toast("error", String(e.message || e));
    return;
  }
  $("exifEmpty").classList.add("hidden");
  $("exifList").classList.remove("hidden");
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
    if (val === null || val === undefined || val === "") {
      dd.textContent = "—";
      dd.className = "none";
    } else {
      dd.textContent = String(val);
    }
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
}

/* ---------------- rendering ---------------- */
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

async function renderNow() {
  if (!state.engine || !state.photos.length) return;
  setStatus("busy", t("status.rendering"));
  const t0 = performance.now();
  try {
    let out;
    if (state.mode === "frame") {
      const tpl = await (await fetch(BASE + `templates/${state.templateId}.json`)).text();
      const wantPreview = $("preview").checked;
      if (wantPreview) {
        try {
          const { rgba, w, h } = await fastPreviewRgba(state.photos[0].bytes);
          out = state.engine.render_raw(rgba, w, h, state.photos[0].bytes, tpl, "jpeg", overridesJson());
        } catch {
          out = state.engine.render_with_overrides(state.photos[0].bytes, tpl, "jpeg", true, overridesJson());
        }
      } else {
        out = state.engine.render_with_overrides(state.photos[0].bytes, tpl, "jpeg", false, overridesJson());
      }
    } else {
      const lay = await (await fetch(BASE + `layouts/${state.layoutId}.json`)).text();
      out = state.engine.render_collage(state.photos.map((p) => p.bytes), lay, "jpeg", $("preview").checked);
    }
    const ms = (performance.now() - t0).toFixed(0);
    state.lastRender = out;
    state.lastRenderName =
      state.mode === "frame"
        ? `${stem(state.photos[0].name)}-framegeist.jpg`
        : `framegeist-collage-${state.layoutId}.jpg`;
    const url = URL.createObjectURL(new Blob([out], { type: "image/jpeg" }));
    setStageImage(url, `${t("stage.rendered")} · ${ms} ms · ${(out.length / 1024).toFixed(0)} KB`);
    $("exportBtn").disabled = false;
    const n = state.photos.length;
    $("exportBatchBtn").classList.toggle("hidden", !(state.mode === "frame" && n > 1));
    $("exportBatchBtn").textContent = t("btn.exportBatch", { n });
    setStatus("ready", t("status.ready"));
  } catch (e) {
    setStatus("error", t("err.render"));
    toast("error", `${t("err.render")}: ${e.message || e}`);
  }
}

function stem(name) { return name.replace(/\.[^.]+$/, ""); }

function download(bytes, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function exportCurrent() {
  if (!state.lastRender) return;
  download(state.lastRender, state.lastRenderName);
  toast("ok", t("toast.exported", { name: state.lastRenderName }));
}

async function exportBatch() {
  const photos = state.photos.slice();
  const tpl = await (await fetch(BASE + `templates/${state.templateId}.json`)).text();
  $("progressWrap").classList.remove("hidden");
  for (let i = 0; i < photos.length; i++) {
    try {
      const out = state.engine.render_with_overrides(photos[i].bytes, tpl, "jpeg", false, overridesJson());
      download(out, `${stem(photos[i].name)}-framegeist.jpg`);
    } catch (e) {
      toast("error", `${photos[i].name}: ${e.message || e}`);
    }
    $("progressBar").style.width = `${Math.round(((i + 1) / photos.length) * 100)}%`;
    setStatus("busy", `${i + 1}/${photos.length}`);
    await new Promise((r) => setTimeout(r, 220));
  }
  setStatus("ready", t("status.ready"));
  setTimeout(() => $("progressWrap").classList.add("hidden"), 1200);
}

/* ---------------- updates ---------------- */
async function checkUpdates() {
  $("updateBox").classList.remove("hidden");
  $("updateBox").innerHTML = t("update.checking");
  try {
    const rel = await (await fetch(`https://api.github.com/repos/${CC_REPO}/releases/latest`)).json();
    $("updateBox").innerHTML =
      `${t("update.latest", { v: rel.tag_name })} · <a href="${rel.html_url}" target="_blank" rel="noreferrer">${t("update.view")}</a>`;
  } catch {
    $("updateBox").textContent = t("update.fail");
  }
}

/* ---------------- wiring ---------------- */
function wire() {
  $("modeFrame").onclick = () => switchMode("frame");
  $("modeCollage").onclick = () => switchMode("collage");
  $("renderBtn").onclick = renderNow;
  $("exportBtn").onclick = exportCurrent;
  $("exportBatchBtn").onclick = exportBatch;
  $("updateBtn").onclick = checkUpdates;
  $("themeBtn").onclick = cycleTheme;
  $("langBtn").onclick = () => { setLang(currentLang() === "zh" ? "en" : "zh"); };
  $("preview").onchange = renderNow;

  $("tplSearch").oninput = (e) => { templateQuery = e.target.value.trim().toLowerCase(); buildTemplatePicker(); };
  $("layoutSearch").oninput = (e) => { layoutQuery = e.target.value.trim().toLowerCase(); buildLayoutPicker(); };

  $("sizeRange").oninput = (e) => pushOverride({ fontSizeScale: Number(e.target.value) });
  $("padRange").oninput = (e) => pushOverride({ paddingScale: Number(e.target.value) });
  $("useColor").onchange = (e) => pushOverride({ useColor: e.target.checked });
  $("colorPick").oninput = (e) => pushOverride({ textColor: e.target.value });
  $("resetTweaks").onclick = () => { if (state.templateId) saveOverrides(state.templateId, undefined); };

  const dz = $("dropzone");
  ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) acceptFiles(e.dataTransfer.files); });
  $("fileInput").onchange = (e) => { if (e.target.files?.length) acceptFiles(e.target.files); };

  window.addEventListener("fg-lang-changed", () => {
    applyTheme();
    const stageLabel = $("stageLabel").textContent;
    setStatus($("statusPill").classList.contains("error") ? "error" : "ready", t("status.ready"));
    $("langBtn").textContent = t("lang.toggle");
    if (!state.photos.length) $("stage").innerHTML = `<span class="placeholder">${t("stage.placeholder")}</span>`;
    else setStageImage(state.lastRender
      ? URL.createObjectURL(new Blob([state.lastRender], { type: "image/jpeg" }))
      : state.sourceUrl, stageLabel);
    buildTemplatePicker();
    buildLayoutPicker();
    updateFileMeta();
    showExif();
    $("statusText").textContent = t($("statusPill").classList.contains("busy") ? "status.rendering" : "status.ready");
  });
}

function switchMode(mode) {
  state.mode = mode;
  $("modeFrame").classList.toggle("on", mode === "frame");
  $("modeCollage").classList.toggle("on", mode === "collage");
  $("framePanels").classList.toggle("hidden", mode !== "frame");
  $("collagePanels").classList.toggle("hidden", mode !== "collage");
  renderNow();
}

wire();
boot().catch((e) => {
  setStatus("error", String(e.message || e));
});

// Debug hook for perf/automation (harmless in production).
window.__fg = { state, fastPreviewRgba, renderNow };

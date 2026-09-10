import init, { Engine } from "./pkg/framegeist_wasm.js";

const $ = (id) => document.getElementById(id);
const status = $("status");
const stage = $("stage");
const BASE = new URL(".", document.baseURI).href;

let engine = null;
let mode = "frame";
let photos = [];
let lastRender = null;
let lastBlobUrl = null;

// Service workers don't exist on the Tauri custom-protocol origin; only
// register on real http(s) origins (Web client, PRD G4).
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

async function boot() {
  status.textContent = "loading wasm…";
  await init("./pkg/framegeist_wasm_bg.wasm");

  const fontRes = await fetch(BASE + "templates/fonts/JetBrainsMono-Regular.ttf");
  engine = new Engine(["JetBrains Mono"], [new Uint8Array(await fontRes.arrayBuffer())]);

  const fillSelect = (sel, items, fmt) => {
    for (const t of items) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = fmt(t);
      sel.appendChild(opt);
    }
    sel.disabled = false;
  };
  fillSelect($("template"), await (await fetch(BASE + "templates.json")).json(),
    (t) => `${t.category} · ${t.name}`);
  fillSelect($("layout"), await (await fetch(BASE + "layouts.json")).json(),
    (l) => `${l.name} (${l.slots}格)`);

  $("renderBtn").disabled = false;
  status.textContent = "ready";
}

async function loadPhoto(files) {
  photos = [];
  for (const f of files) {
    photos.push(new Uint8Array(await f.arrayBuffer()));
  }
  try {
    const exif = JSON.parse(engine.probe_exif(photos[0]));
    $("exif").textContent = "EXIF: " + JSON.stringify(exif, null, 1);
  } catch (e) {
    $("exif").textContent = "EXIF: probe failed " + e;
  }
  await renderNow();
}

async function renderNow() {
  if (!photos.length) return;
  status.textContent = "rendering…";
  const t0 = performance.now();
  try {
    let out;
    if (mode === "frame") {
      const tpl = await (await fetch(BASE + `templates/${$("template").value}.json`)).text();
      out = engine.render(photos[0], tpl, "jpeg", $("preview").checked);
    } else {
      const lay = await (await fetch(BASE + `layouts/${$("layout").value}.json`)).text();
      out = engine.render_collage(photos, lay, "jpeg", $("preview").checked);
    }
    const ms = (performance.now() - t0).toFixed(0);
    lastRender = out;
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = URL.createObjectURL(new Blob([out], { type: "image/jpeg" }));
    stage.innerHTML = "";
    const img = new Image();
    img.src = lastBlobUrl;
    stage.appendChild(img);
    $("exportBtn").disabled = false;
    status.textContent = `done in ${ms} ms (${(out.length / 1024).toFixed(0)} KB)`;
  } catch (e) {
    status.textContent = "render failed: " + (e.message || e);
  }
}

function setMode(m) {
  mode = m;
  $("modeFrame").classList.toggle("on", m === "frame");
  $("modeCollage").classList.toggle("on", m === "collage");
  $("frameControls").style.display = m === "frame" ? "flex" : "none";
  $("collageControls").style.display = m === "collage" ? "flex" : "none";
}
$("modeFrame").addEventListener("click", () => setMode("frame"));
$("modeCollage").addEventListener("click", () => setMode("collage"));
$("renderBtn").addEventListener("click", renderNow);
$("template").addEventListener("change", renderNow);
$("layout").addEventListener("change", renderNow);
$("preview").addEventListener("change", renderNow);
$("exportBtn").addEventListener("click", () => {
  if (!lastRender) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lastRender], { type: "image/jpeg" }));
  a.download = `framegeist-${mode}-${(mode === "frame" ? $("template") : $("layout")).value}.jpg`;
  a.click();
});
$("updateBtn").addEventListener("click", async () => {
  const box = $("updateBox");
  box.style.display = "block";
  box.textContent = "检查更新…";
  try {
    const rel = await (await fetch("https://api.github.com/repos/meihuaanying/framegeist/releases/latest")).json();
    box.innerHTML = `最新版本 <b>${rel.tag_name}</b> · <a href="${rel.html_url}" target="_blank">查看发布</a>`;
  } catch {
    box.textContent = "更新检查失败（离线？）";
  }
});

const drop = $("drop");
["dragover", "dragenter"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => {
  const files = e.dataTransfer?.files;
  if (files?.length) loadPhoto(files);
});
$("file").addEventListener("change", (e) => {
  if (e.target.files?.length) loadPhoto(e.target.files);
});

boot().catch((e) => {
  status.textContent = "engine load failed: " + (e.message || e);
});

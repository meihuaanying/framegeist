// Minimal i18n: data-i18n attributes + dict, memory in localStorage.
export const dict = {
  zh: {
    "app.tagline": "照片全程本地处理 · 不上传 · 可离线",
    "status.boot": "引擎加载中…",
    "status.ready": "就绪",
    "status.rendering": "渲染中…",
    "status.error": "出错",
    "mode.frame": "边框模板",
    "mode.collage": "拼图",
    "drop.main": "拖入照片，或点击选择",
    "drop.hint": "支持 JPEG / PNG / WebP / TIFF；拼图模式可多选",
    "drop.multi": "已选 {n} 张",
    "template.title": "模板",
    "template.search": "搜索模板…",
    "template.all": "全部",
    "layout.title": "布局",
    "layout.search": "搜索布局…",
    "tweak.title": "微调（仅此模板）",
    "tweak.size": "文字大小",
    "tweak.padding": "内边距",
    "tweak.color": "文字颜色",
    "tweak.useColor": "覆盖颜色",
    "tweak.reset": "重置微调",
    "btn.render": "渲染预览",
    "btn.export": "导出 JPEG",
    "btn.preview": "快速预览采样",
    "btn.exportBatch": "导出全部（{n}）",
    "btn.update": "检查更新",
    "exif.title": "EXIF 信息",
    "exif.none": "拖入照片后显示",
    "exif.make": "品牌", "exif.model": "机型", "exif.lens": "镜头",
    "exif.focal": "焦距", "exif.aperture": "光圈", "exif.shutter": "快门",
    "exif.iso": "ISO", "exif.datetime": "时间", "exif.orientation": "方向",
    "stage.placeholder": "拖入一张照片开始",
    "stage.original": "原图",
    "stage.rendered": "渲染结果",
    "update.checking": "检查中…",
    "update.latest": "最新版本 {v}",
    "update.view": "查看发布",
    "update.fail": "更新检查失败（离线？）",
    "err.wasm": "引擎加载失败",
    "err.font": "字体加载失败",
    "err.render": "渲染失败",
    "err.decode": "无法解码这张照片（支持 JPEG/PNG/WebP/TIFF）",
    "toast.exported": "已导出 {name}",
    "theme.auto": "主题：跟随系统",
    "theme.light": "主题：浅色",
    "theme.dark": "主题：深色",
    "lang.toggle": "EN",
  },
  en: {
    "app.tagline": "Photos stay on your device · zero upload · offline-ready",
    "status.boot": "Loading engine…",
    "status.ready": "Ready",
    "status.rendering": "Rendering…",
    "status.error": "Error",
    "mode.frame": "Frame",
    "mode.collage": "Collage",
    "drop.main": "Drop photos or click to choose",
    "drop.hint": "JPEG / PNG / WebP / TIFF; multi-select in collage mode",
    "drop.multi": "{n} selected",
    "template.title": "Templates",
    "template.search": "Search templates…",
    "template.all": "All",
    "layout.title": "Layouts",
    "layout.search": "Search layouts…",
    "tweak.title": "Tweaks (this template)",
    "tweak.size": "Text size",
    "tweak.padding": "Padding",
    "tweak.color": "Text color",
    "tweak.useColor": "Override color",
    "tweak.reset": "Reset tweaks",
    "btn.render": "Render preview",
    "btn.export": "Export JPEG",
    "btn.preview": "Fast preview sampling",
    "btn.exportBatch": "Export all ({n})",
    "btn.update": "Check updates",
    "exif.title": "EXIF",
    "exif.none": "Drop a photo to inspect",
    "exif.make": "Make", "exif.model": "Model", "exif.lens": "Lens",
    "exif.focal": "Focal", "exif.aperture": "Aperture", "exif.shutter": "Shutter",
    "exif.iso": "ISO", "exif.datetime": "Date", "exif.orientation": "Orientation",
    "stage.placeholder": "Drop a photo to start",
    "stage.original": "Original",
    "stage.rendered": "Rendered",
    "update.checking": "Checking…",
    "update.latest": "Latest {v}",
    "update.view": "View release",
    "update.fail": "Update check failed (offline?)",
    "err.wasm": "Engine failed to load",
    "err.font": "Font failed to load",
    "err.render": "Render failed",
    "err.decode": "Cannot decode this photo (JPEG/PNG/WebP/TIFF supported)",
    "toast.exported": "Exported {name}",
    "theme.auto": "Theme: auto",
    "theme.light": "Theme: light",
    "theme.dark": "Theme: dark",
    "lang.toggle": "中",
  },
};

let lang = "zh";
export function currentLang() { return lang; }

export function initI18n() {
  const stored = localStorage.getItem("fg-lang");
  const nav = (navigator.language || "zh").toLowerCase();
  lang = stored ?? (nav.startsWith("zh") ? "zh" : "en");
  applyI18n();
  return lang;
}

export function setLang(next) {
  lang = next;
  localStorage.setItem("fg-lang", next);
  applyI18n();
  window.dispatchEvent(new CustomEvent("fg-lang-changed"));
}

export function t(key, vars) {
  let s = dict[lang][key] ?? dict.zh[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}

// Site-wide theme (auto/light/dark) + i18n (zh/en), same storage keys as app.
const KEYS = { theme: "fg-theme", lang: "fg-lang" };

const DICT = {
  zh: {
    "nav.templates": "模板墙", "nav.download": "下载", "nav.docs": "文档",
    "nav.market": "模板市场", "nav.sponsor": "赞助", "nav.app": "在线使用", "nav.home": "首页",
    "hero.title": "给照片加上它自己的故事",
    "hero.lead": "带 EXIF 参数的边框、水印与拼图。全免费、开源、可离线、四端一致——同一张照片、同一份模板，在 Windows / Android / 鸿蒙 / Web 上产出像素级一致的成品。照片永不离开你的设备。",
    "hero.cta.download": "下载客户端", "hero.cta.web": "浏览器直接用",
    "hero.meta": "MIT 开源 · 零账号 · 零付费 · 零上传",
    "f1.t": "60+ 内置模板 · 106 种拼图", "f1.d": "经典白边、胶片齿孔、拍立得、画廊卡纸、技术铭牌、杂志排版、极简角标、相机机身——全部 JSON 声明式，可自制可流通。",
    "f2.t": "真实 EXIF，不是装饰", "f2.d": "机型美化（ILCE-7CM2 → Sony α7C II）、镜头、光圈、快门、ISO、焦距一键呈现；GPS 与设备序列号默认剥离。",
    "f3.t": "像素级一致", "f3.d": "CLI 渲染的黄金图基线约束四端；Web 端已验证与 CLI 字节级一致。导出 JPEG 质量 100 + 4:4:4，绝不下采样。",
    "f4.t": "零账号 · 零付费 · 零上传", "f4.d": "没有登录、没有订阅、没有授权校验。全部功能与模板免费，模板以 .fgt 文件流通。",
    "stats.loading": "加载模板库数据…",
    "stats.count": "当前内置 {n} 套模板（{c} 个分类）+ 106 种拼图布局",
    "wall.title": "模板墙", "wall.note": "以下样张全部由 CLI 用固定测试照片真实渲染（PRD C6），禁止设计稿冒充。",
    "wall.all": "全部",
    "dl.title": "下载", "dl.note": "版本与校验和实时读取 GitHub Releases API，页面不硬编码任何版本号（PRD K2）。",
    "dl.file": "文件", "dl.size": "大小", "dl.link": "链接", "dl.download": "下载",
    "dl.loading": "读取 Releases…", "dl.empty": "该版本暂无附件",
    "dl.fail": "读取失败：{e}。请前往 GitHub Releases 手动下载。",
    "docs.title": "文档",
    "market.title": "用户模板市场",
    "market.lead": "模板市场基于独立 GitHub 仓库 framegeist-templates（建仓中，PRD E3）：",
    "market.li1": "通过 GitHub PR 提交你的 .fgt 模板包",
    "market.li2": "CI 自动校验：Schema 校验 → 真实渲染样张 → 感知哈希查重",
    "market.li3": "通过即进入市场分发，无需客户端发版即可上新",
    "market.li4": "作者署名强制保留（PRD E5），不付费、不分成",
    "market.go": "前往模板市场仓库 →",
    "sponsor.title": "赞助",
    "footer": "FrameGeist（工作名，商标检索中）· MIT 开源",
    "theme.auto": "主题：跟随系统", "theme.light": "主题：浅色", "theme.dark": "主题：深色",
    "lang.toggle": "EN",
  },
  en: {
    "nav.templates": "Templates", "nav.download": "Download", "nav.docs": "Docs",
    "nav.market": "Market", "nav.sponsor": "Sponsor", "nav.app": "Open app", "nav.home": "Home",
    "hero.title": "Give every photo its own story",
    "hero.lead": "EXIF frames, watermarks and collages. Free, open-source, offline-ready and pixel-identical across Windows / Android / HarmonyOS / Web. Your photos never leave your device.",
    "hero.cta.download": "Download", "hero.cta.web": "Use in browser",
    "hero.meta": "MIT licensed · no account · no fees · zero upload",
    "f1.t": "60+ templates · 106 layouts", "f1.d": "Classic white, film sprockets, polaroid, gallery mats, technical plates, magazine, minimal, camera shells — all declarative JSON, maker-friendly.",
    "f2.t": "Real EXIF, not decoration", "f2.d": "Model prettifier (ILCE-7CM2 → Sony α7C II), lens, aperture, shutter, ISO, focal length. GPS and serials stripped by default.",
    "f3.t": "Pixel-identical", "f3.d": "Golden-image baselines from the CLI constrain all clients; the Web build is verified byte-identical. JPEG quality 100 + 4:4:4, never downsampled.",
    "f4.t": "No accounts · no fees · no upload", "f4.d": "No login, no subscription, no license checks. Every feature and template is free; templates travel as .fgt files.",
    "stats.loading": "Loading template library…",
    "stats.count": "{n} built-in templates ({c} categories) + 106 collage layouts",
    "wall.title": "Template wall", "wall.note": "Every thumbnail is a real CLI render of the fixed test photo (PRD C6) — never a design mock.",
    "wall.all": "All",
    "dl.title": "Download", "dl.note": "Versions and checksums come live from the GitHub Releases API — nothing hard-coded (PRD K2).",
    "dl.file": "File", "dl.size": "Size", "dl.link": "Link", "dl.download": "Download",
    "dl.loading": "Reading Releases…", "dl.empty": "No assets in this release yet",
    "dl.fail": "Failed to read: {e}. Get it from GitHub Releases manually.",
    "docs.title": "Docs",
    "market.title": "Community template market",
    "market.lead": "The market lives in the separate repository framegeist-templates (being set up, PRD E3):",
    "market.li1": "Submit your .fgt package via GitHub PR",
    "market.li2": "CI validates: schema → real sample render → perceptual-hash dedup",
    "market.li3": "Merged templates ship instantly, no client release needed",
    "market.li4": "Author attribution is mandatory (PRD E5); no fees, no revenue share",
    "market.go": "Open the market repo →",
    "sponsor.title": "Sponsor",
    "footer": "FrameGeist (working name, trademark review pending) · MIT licensed",
    "theme.auto": "Theme: auto", "theme.light": "Theme: light", "theme.dark": "Theme: dark",
    "lang.toggle": "中",
  },
};

let lang = "zh";

function applyTheme() {
  const mode = localStorage.getItem(KEYS.theme) ?? "auto";
  const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  return mode;
}
function cycleTheme() {
  const order = ["auto", "light", "dark"];
  const next = order[(order.indexOf(localStorage.getItem(KEYS.theme) ?? "auto") + 1) % 3];
  localStorage.setItem(KEYS.theme, next);
  applyTheme();
  renderThemeBtn();
}
function renderThemeBtn() {
  const btn = document.querySelector("[data-theme-btn]");
  if (!btn) return;
  const mode = localStorage.getItem(KEYS.theme) ?? "auto";
  btn.textContent = mode === "auto" ? "◐" : mode === "light" ? "☀" : "☾";
  btn.title = t(`theme.${mode}`);
}
export function t(key, vars) {
  let s = DICT[lang][key] ?? DICT.zh[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  const lb = document.querySelector("[data-lang-btn]");
  if (lb) lb.textContent = t("lang.toggle");
  renderThemeBtn();
}
export function setLang(next) {
  lang = next;
  localStorage.setItem(KEYS.lang, next);
  applyI18n();
  window.dispatchEvent(new CustomEvent("fg-lang-changed"));
}
export function currentLang() { return lang; }

export function init() {
  const stored = localStorage.getItem(KEYS.lang);
  const nav = (navigator.language || "zh").toLowerCase();
  lang = stored ?? (nav.startsWith("zh") ? "zh" : "en");
  applyTheme();
  applyI18n();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  document.querySelector("[data-theme-btn]")?.addEventListener("click", cycleTheme);
  document.querySelector("[data-lang-btn]")?.addEventListener("click", () => setLang(currentLang() === "zh" ? "en" : "zh"));
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const page = location.pathname.split("/").pop() || "index.html";
    if (a.getAttribute("href") === page) a.classList.add("on");
  });
}

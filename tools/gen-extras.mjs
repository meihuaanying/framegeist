// v0.3.0 template expansion: 37 frameelf-aligned originals + 18 game-themed
// + 12 open-source-inspired = 67 new templates (63 -> 130).
// All visuals are original JSON designs; game templates ship only original
// wordmarks and carry an "unofficial" notice (no official assets).
// Usage: node tools/gen-extras.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "templates";
mkdirSync(OUT, { recursive: true });
const V = "0.3.0";

function meta(id, zh, en, category, extra = {}) {
  return {
    id,
    name: en,
    nameI18n: { zh, en },
    version: V,
    minEngineVersion: "0.1.0",
    author: "framegeist",
    license: "CC0-1.0",
    category,
    ...extra,
  };
}

const T = [];
const push = (id, zh, en, category, canvas, layers, extra = {}) =>
  T.push({ meta: meta(id, zh, en, category, extra), canvas, layers });

const font = (size, color, weight = 400, family = ["JetBrains Mono"]) => ({ family, size, weight, color });
const text = (id, anchor, f, content, o = {}) => ({ type: "text", id, anchor, font: f, content, ...o });
const item = (expr, fallback = null) => ({ expr, fallback });
const badge = (o = {}) => ({
  type: "image", id: "brand",
  asset: `@builtin/brand/{exif.brand_slug}${o.light ? "-light" : ""}`,
  size: { height: o.height ?? 0.022 },
  anchor: o.anchor ?? "bottom-left",
  ...(o.attachTo ? { attachTo: o.attachTo, attachGap: o.attachGap ?? 0.01 } : {}),
  ...(o.offset ? { offset: o.offset } : {}),
  ...(o.tint ? { tint: o.tint } : {}),
  ...(o.opacity ? { opacity: o.opacity } : {}),
});
const series = (o = {}) => ({
  type: "image", id: "series",
  asset: "@builtin/series/{exif.lens_series}",
  size: { height: o.height ?? 0.03 },
  anchor: o.anchor ?? "top-left",
  ...(o.offset ? { offset: o.offset } : {}),
  ...(o.tint ? { tint: o.tint } : {}),
  ...(o.opacity ? { opacity: o.opacity } : {}),
});
const frameImg = (slug, o = {}) => ({
  type: "image", id: o.id ?? slug,
  asset: `@builtin/frame/${slug}`,
  size: { height: o.height ?? 0.1 },
  anchor: o.anchor ?? "bottom-right",
  ...(o.offset ? { offset: o.offset } : {}),
  ...(o.opacity != null ? { opacity: o.opacity } : {}),
  ...(o.tint ? { tint: o.tint } : {}),
  ...(o.width ? { size: { width: o.width } } : {}),
});
const gameMark = (slug, o = {}) => ({
  type: "image", id: "game-mark",
  asset: `@builtin/game/${slug}`,
  size: { height: o.height ?? 0.05 },
  anchor: o.anchor ?? "top-left",
  ...(o.offset ? { offset: o.offset } : {}),
  ...(o.opacity != null ? { opacity: o.opacity } : {}),
});
const extend = (padding, bg) => ({ mode: "extend", padding, background: bg });
const overlay = () => ({ mode: "overlay", background: { type: "none" } });
const solid = (color) => ({ type: "solid", color });
const blur = (scale = 1.25, b = 40) => ({ type: "blur", scale, blur: b });

const INFO = [item("exif.model_pretty", "Unknown Camera"), item("exif.lens", null)];
const PARAMS = [item("fmt('{focal}mm f/{aperture} {shutter} ISO{iso}', exif)", "framegeist")];
const GAME_NOTICE =
  "Unofficial fan-made design; game names and trademarks belong to their respective owners.";

/* ---------------- A1. camera-frame (8) ---------------- */
const CF = [
  ["#101010", "#E8C06A", "#141414"],
  ["#16110C", "#D8B24A", "#1C150E"],
  ["#0E1420", "#7FD4FF", "#111A28"],
  ["#0F1A12", "#B7F0AD", "#132016"],
  ["#1E1408", "#FFD37F", "#241A0C"],
  ["#F2EFE9", "#2B2B2B", "#E5E1D8"],
  ["#18122B".replace("2B", "1A"), "#F0E6D2", "#1E1730"],
  ["#141414", "#C9C9C9", "#1A1A1A"],
];
CF.forEach(([bg, fg, strip], i) => {
  const darkArt = i < 6 && bg.startsWith("#1") && !bg.includes("F2");
  push(
    `camera-frame-v${i + 1}`,
    `相机相框 ${i + 1}`,
    `Camera Frame ${i + 1}`,
    "frame-shell",
    extend({ top: 0.09, right: 0.05, bottom: 0.16, left: 0.05 }, solid(bg)),
    [
      frameImg("film-strip", { id: "strip-top", height: 0.022, anchor: "top-center", offset: { x: 0, y: 0.012 }, tint: darkArt ? "light" : "dark" }),
      frameImg("film-strip", { id: "strip-bottom", height: 0.022, anchor: "bottom-center", offset: { x: 0, y: -0.005 }, tint: darkArt ? "light" : "dark" }),
      text("title", "bottom-left", font(0.026, fg, 600), INFO, { offset: { x: 0.02, y: -0.05 } }),
      badge({ attachTo: "title", light: darkArt, height: 0.021 }),
      text("params", "bottom-right", font(0.018, fg, 400), PARAMS, { offset: { x: -0.02, y: -0.055 } }),
      series({ anchor: "top-left", offset: { x: 0.02, y: 0.035 }, tint: darkArt ? "light" : "dark", height: 0.026 }),
    ]
  );
});

/* ---------------- A2. handheld (5) ---------------- */
const HH = [
  ["#FFFFFF", "#141414", "phone-frame", "light"],
  ["#F5F1E8", "#2A2118", "camera-body", "light"],
  ["#0F0F12", "#EDEDED", "phone-frame", "dark"],
  ["#F8F8F6", "#333333", "camera-body", "light"],
  ["#111820", "#D9E6F2", "phone-frame", "light"],
];
HH.forEach(([bg, fg, art, artTint], i) => {
  const darkBg = bg === "#0F0F12";
  push(
    `handheld-v${i + 1}`,
    `手持相框 ${i + 1}`,
    `Handheld ${i + 1}`,
    "frame-shell",
    extend({ top: 0.05, right: 0.34, bottom: 0.1, left: 0.05 }, solid(bg)),
    [
      frameImg(art, { id: "device", height: 0.62, anchor: "middle-right", offset: { x: -0.02, y: 0 }, tint: darkBg ? "light" : "dark", opacity: 0.9 }),
      text("title", "bottom-left", font(0.028, fg, 600), INFO, { offset: { x: 0.03, y: -0.06 } }),
      badge({ attachTo: "title", light: darkBg, height: 0.022 }),
      text("params", "bottom-left", font(0.018, fg, 400), PARAMS, { offset: { x: 0.03, y: -0.095 } }),
      text("date", "top-left", font(0.015, fg, 400), [item("date('YYYY.MM.DD', exif.datetime)", "2026.09.12")], { offset: { x: 0.03, y: 0.04 } }),
    ]
  );
});

/* ---------------- A3. lens-icon (4) ---------------- */
const LI = [
  ["#0C0C0E", "#E0E0E0", "light"],
  ["#FFFFFF", "#1A1A1A", "dark"],
  ["#101820", "#9AD1FF", "light"],
  ["#F4F1EA", "#3A332A", "dark"],
];
LI.forEach(([bg, fg, tint], i) => {
  const darkBg = tint === "light";
  push(
    `lens-icon-v${i + 1}`,
    `镜头徽章 ${i + 1}`,
    `Lens Badge ${i + 1}`,
    "technical",
    extend({ top: 0.08, right: 0.05, bottom: 0.12, left: 0.05 }, solid(bg)),
    [
      series({ anchor: "top-left", offset: { x: 0.025, y: 0.04 }, tint, height: 0.07 }),
      badge({ anchor: "top-right", offset: { x: -0.025, y: 0.045 }, light: darkBg, height: 0.032 }),
      text("lens", "bottom-left", font(0.022, fg, 500), [item("exif.lens", "Unknown Lens")], { offset: { x: 0.025, y: -0.06 } }),
      text("params", "bottom-right", font(0.016, fg, 400), PARAMS, { offset: { x: -0.025, y: -0.06 } }),
    ]
  );
});

/* ---------------- A4. film-plus (6) ---------------- */
const FP = [
  ["#0F0F0F", "#E8C06A"],
  ["#131110", "#D8B24A"],
  ["#1A120E", "#F0D08A"],
  ["#0B0B0D", "#DDBB66"],
  ["#16130F", "#E6C87A"],
  ["#101010", "#C9A24D"],
];
FP.forEach(([bg, fg], i) => {
  const pad = 0.05 + i * 0.008;
  push(
    `film-plus-v${i + 1}`,
    `胶片加强 ${i + 1}`,
    `Film Plus ${i + 1}`,
    "film",
    extend({ top: pad + 0.03, right: pad, bottom: pad + 0.09, left: pad }, solid(bg)),
    [
      frameImg("film-strip", { id: "strip-top", height: 0.02, anchor: "top-center", offset: { x: 0, y: 0.01 }, tint: "light" }),
      frameImg("film-strip", { id: "strip-bottom", height: 0.02, anchor: "bottom-center", offset: { x: 0, y: -0.008 }, tint: "light" }),
      text("title", "bottom-left", font(0.026, fg, 600), INFO, { offset: { x: 0.025, y: -0.05 } }),
      badge({ attachTo: "title", light: true, height: 0.022 }),
      text("params", "bottom-right", font(0.017, fg, 400), PARAMS, { offset: { x: -0.025, y: -0.055 } }),
      text("stock", "top-left", font(0.014, fg, 400), [item(`'FILM 400-${i + 1}'`, "FILM")], { offset: { x: 0.025, y: 0.035 } }),
    ]
  );
});

/* ---------------- A5. borderless (6, auto-contrast) ---------------- */
const BL = [
  ["bottom-left", { x: 0.025, y: -0.04 }],
  ["bottom-right", { x: -0.025, y: -0.04 }],
  ["top-left", { x: 0.025, y: 0.04 }],
  ["top-right", { x: -0.025, y: 0.04 }],
  ["middle-left", { x: 0.025, y: 0 }],
  ["middle-right", { x: -0.025, y: 0 }],
];
BL.forEach(([anchor, offset], i) => {
  push(
    `borderless-v${i + 1}`,
    `无边框 ${i + 1}`,
    `Borderless ${i + 1}`,
    "minimal",
    overlay(),
    [
      text("title", anchor, font(0.03, "auto", 600), INFO, { offset }),
      badge({ anchor, offset: { x: offset.x, y: offset.y + (String(anchor).startsWith("bottom") ? -0.045 : 0.05) }, height: 0.026 }),
      text("params", anchor, font(0.017, "auto", 400), PARAMS, {
        offset: { x: offset.x, y: offset.y + (String(anchor).startsWith("bottom") ? -0.08 : 0.085) },
      }),
    ]
  );
});

/* ---------------- A6. signature (4, Great Vibes) ---------------- */
const SG = [
  ["#FFFFFF", "#222222", "#777777"],
  ["#FAF6EE", "#3A332A", "#8A8175"],
  ["#101010", "#F2F2F0", "#9A9A9A"],
  ["#EEF2F6", "#23303E", "#6E7F91"],
];
SG.forEach(([bg, fg, sub], i) => {
  const darkBg = bg === "#101010";
  push(
    `signature-v${i + 1}`,
    `签名款 ${i + 1}`,
    `Signature ${i + 1}`,
    "gallery",
    extend({ top: 0.05, right: 0.06, bottom: 0.18, left: 0.06 }, solid(bg)),
    [
      text("signature", "bottom-center", font(0.085, fg, 400, ["Great Vibes", "Cormorant Garamond"]), [item("exif.model_pretty", "FrameGeist")], { offset: { x: 0, y: -0.075 }, lineHeight: 1.0 }),
      text("params", "bottom-center", font(0.015, sub, 400), PARAMS, { offset: { x: 0, y: -0.035 } }),
      badge({ anchor: "bottom-center", offset: { x: 0, y: -0.012 }, light: darkBg, height: 0.016 }),
    ]
  );
});

/* ---------------- A7. shell-plus (4) ---------------- */
const SP = [
  ["#101014", "#EDEDF0"],
  ["#14100C", "#EADFC8"],
  ["#0E1418", "#D7E7F0"],
  ["#1A1512", "#F0E2CE"],
];
SP.forEach(([bg, fg], i) => {
  push(
    `shell-plus-v${i + 1}`,
    `机身轮廓 ${i + 1}`,
    `Body Outline ${i + 1}`,
    "frame-shell",
    extend({ top: 0.07, right: 0.06, bottom: 0.14, left: 0.06 }, solid(bg)),
    [
      frameImg("camera-body", { id: "body-art", height: 0.34, anchor: "middle-right", offset: { x: -0.03, y: 0 }, tint: "light", opacity: 0.14 }),
      text("title", "bottom-left", font(0.028, fg, 600), INFO, { offset: { x: 0.03, y: -0.05 } }),
      badge({ attachTo: "title", light: true, height: 0.024 }),
      text("params", "bottom-left", font(0.017, fg, 400), PARAMS, { offset: { x: 0.03, y: -0.09 } }),
      series({ anchor: "top-right", offset: { x: -0.03, y: 0.035 }, tint: "light", height: 0.024 }),
    ]
  );
});

/* ---------------- B. game templates (18) ---------------- */
const GAMES = [
  { slug: "genshin", zh: "原神", en: "Genshin" },
  { slug: "zzz", zh: "绝区零", en: "Zenless Zone Zero" },
  { slug: "honkai", zh: "崩坏", en: "Honkai" },
  { slug: "arknights", zh: "明日方舟", en: "Arknights" },
  { slug: "wwmeet", zh: "燕云十六声", en: "Where Winds Meet" },
  { slug: "wukong", zh: "黑神话悟空", en: "Black Myth Wukong" },
];
const THEMES = {
  genshin: { bg: "#F7F3E8", fg: "#3E6B5A", accent: "#C9A227", light: "dark" },
  zzz: { bg: "#101012", fg: "#F2E55C", accent: "#8A8F98", light: "light" },
  honkai: { bg: "#0D1422", fg: "#8FD3FF", accent: "#D8E6F2", light: "light" },
  arknights: { bg: "#121212", fg: "#E8E8E8", accent: "#E4572E", light: "light" },
  wwmeet: { bg: "#F4EFE6", fg: "#2B2B2B", accent: "#B33A3A", light: "dark" },
  wukong: { bg: "#120E09", fg: "#D4A017", accent: "#8C2F22", light: "light" },
};
for (const g of GAMES) {
  const th = THEMES[g.slug];
  const isLightBg = th.light === "dark"; // badge tint: dark art on light bg
  // v1 hero border
  push(
    `game-${g.slug}-v1`,
    `${g.zh} · 主题边框`,
    `${g.en} · Hero Frame`,
    "game",
    extend({ top: 0.08, right: 0.05, bottom: 0.16, left: 0.05 }, solid(th.bg)),
    [
      gameMark(g.slug, { anchor: "top-left", height: 0.045, offset: { x: 0.03, y: 0.035 }, tint: isLightBg ? "dark" : "light" }),
      text("title", "bottom-left", font(0.027, th.fg, 600), INFO, { offset: { x: 0.03, y: -0.05 } }),
      badge({ attachTo: "title", light: !isLightBg, height: 0.022 }),
      text("params", "bottom-right", font(0.017, th.fg, 400), PARAMS, { offset: { x: -0.03, y: -0.055 } }),
      text("accent", "bottom-left", font(0.014, th.accent, 500), [item("date('YYYY.MM.DD', exif.datetime)", "2026.09.12")], { offset: { x: 0.03, y: -0.095 } }),
    ],
    { notice: GAME_NOTICE }
  );
  // v2 minimal corner (auto contrast)
  push(
    `game-${g.slug}-v2`,
    `${g.zh} · 极简角标`,
    `${g.en} · Corner Mark`,
    "game",
    overlay(),
    [
      gameMark(g.slug, { anchor: "bottom-right", height: 0.035, offset: { x: -0.025, y: -0.045 }, opacity: 0.95 }),
      text("params", "bottom-right", font(0.016, "auto", 500), PARAMS, { offset: { x: -0.025, y: -0.095 } }),
    ],
    { notice: GAME_NOTICE }
  );
  // v3 poster card
  push(
    `game-${g.slug}-v3`,
    `${g.zh} · 海报卡`,
    `${g.en} · Poster Card`,
    "game",
    extend({ top: 0.16, right: 0.09, bottom: 0.2, left: 0.09 }, solid(th.bg)),
    [
      gameMark(g.slug, { anchor: "top-center", height: 0.05, offset: { x: 0, y: 0.05 }, tint: isLightBg ? "dark" : "light" }),
      text("title", "bottom-center", font(0.024, th.fg, 600), INFO, { offset: { x: 0, y: -0.08 } }),
      badge({ anchor: "bottom-center", offset: { x: 0, y: -0.045 }, light: !isLightBg, height: 0.02 }),
      text("params", "bottom-center", font(0.015, th.accent, 400), PARAMS, { offset: { x: 0, y: -0.012 } }),
    ],
    { notice: GAME_NOTICE }
  );
}

/* ---------------- C. open-source inspired (12) ---------------- */
// frosted editorial ×2
[0, 1].forEach((i) => {
  push(
    `os-frosted-editorial-v${i + 1}`,
    `磨砂编辑风 ${i + 1}`,
    `Frosted Editorial ${i + 1}`,
    "classic-white",
    extend({ top: 0.14, right: 0.12, bottom: 0.22 + i * 0.02, left: 0.12 }, blur(1.3, 46)),
    [
      text("title", "bottom-center", font(0.028, "#FFFFFF", 600), INFO, { offset: { x: 0, y: -0.09 } }),
      badge({ anchor: "bottom-center", offset: { x: 0, y: -0.05 }, light: true, height: 0.02 }),
      text("params", "bottom-center", font(0.016, "#EAEAEA", 400), PARAMS, { offset: { x: 0, y: -0.015 } }),
    ]
  );
});
// gallery noir
push(
  "os-gallery-noir-v1", "画廊夜黑", "Gallery Noir", "gallery",
  extend({ top: 0.09, right: 0.09, bottom: 0.16, left: 0.09 }, solid("#101112")),
  [
    text("title", "bottom-left", font(0.024, "#F2F2F0", 600), INFO, { offset: { x: 0.03, y: -0.055 } }),
    badge({ attachTo: "title", light: true, height: 0.02 }),
    text("params", "bottom-right", font(0.015, "#B9B9B4", 400), PARAMS, { offset: { x: -0.03, y: -0.055 } }),
  ]
);
// expo around/left/right
push(
  "os-expo-around-v1", "展览环绕", "Expo Around", "gallery",
  extend({ top: 0.1, right: 0.1, bottom: 0.18, left: 0.1 }, solid("#FFFFFF")),
  [
    text("title", "bottom-center", font(0.022, "#1A1A1A", 600), INFO, { offset: { x: 0, y: -0.065 } }),
    badge({ anchor: "bottom-center", offset: { x: 0, y: -0.035 }, tint: "dark", height: 0.018 }),
    text("params", "bottom-center", font(0.014, "#777777", 400), PARAMS, { offset: { x: 0, y: -0.01 } }),
  ]
);
push(
  "os-expo-left-v1", "展览左栏", "Expo Left", "gallery",
  extend({ top: 0.06, right: 0.3, bottom: 0.08, left: 0.06 }, solid("#FAFAF8")),
  [
    text("title", "middle-left", font(0.022, "#1A1A1A", 600), INFO, { offset: { x: 0.03, y: 0.03 } }),
    text("params", "middle-left", font(0.014, "#666666", 400), PARAMS, { offset: { x: 0.03, y: -0.005 } }),
    badge({ anchor: "middle-left", offset: { x: 0.03, y: -0.04 }, tint: "dark", height: 0.02 }),
  ]
);
push(
  "os-expo-right-v1", "展览右栏", "Expo Right", "gallery",
  extend({ top: 0.06, right: 0.06, bottom: 0.08, left: 0.3 }, solid("#0F0F10")),
  [
    text("title", "middle-right", font(0.022, "#F2F2F0", 600), INFO, { offset: { x: -0.03, y: 0.03 } }),
    text("params", "middle-right", font(0.014, "#A9A9A4", 400), PARAMS, { offset: { x: -0.03, y: -0.005 } }),
    badge({ anchor: "middle-right", offset: { x: -0.03, y: -0.04 }, tint: "light", height: 0.02 }),
  ]
);
// card logo/param/frame
push(
  "os-card-logo-v1", "卡片·徽标", "Card · Logo", "magazine",
  extend({ top: 0.03, right: 0.03, bottom: 0.16, left: 0.03 }, solid("#FFFFFF")),
  [
    badge({ anchor: "top-left", offset: { x: 0.03, y: 0.035 }, tint: "dark", height: 0.035 }),
    text("title", "bottom-left", font(0.022, "#141414", 600), INFO, { offset: { x: 0.03, y: -0.075 } }),
    text("params", "bottom-left", font(0.014, "#666666", 400), PARAMS, { offset: { x: 0.03, y: -0.035 } }),
  ]
);
push(
  "os-card-param-v1", "卡片·参数", "Card · Param", "magazine",
  extend({ top: 0.03, right: 0.03, bottom: 0.16, left: 0.03 }, solid("#FFFFFF")),
  [
    text("title", "bottom-left", font(0.03, "#141414", 700), [item("fmt('{focal}mm', exif)", "35mm")], { offset: { x: 0.03, y: -0.1 } }),
    text("meta", "bottom-left", font(0.016, "#444444", 400), [item("fmt('f/{aperture}  {shutter}  ISO{iso}', exif)", "f/2.8  1/250s  ISO200")], { offset: { x: 0.03, y: -0.05 } }),
    badge({ anchor: "bottom-right", offset: { x: -0.03, y: -0.055 }, tint: "dark", height: 0.024 }),
  ]
);
push(
  "os-card-frame-v1", "卡片·框线", "Card · Frame", "classic-white",
  extend({ top: 0.06, right: 0.06, bottom: 0.18, left: 0.06 }, solid("#F7F5F0")),
  [
    text("title", "bottom-center", font(0.024, "#2A2A2A", 600), INFO, { offset: { x: 0, y: -0.085 } }),
    text("params", "bottom-center", font(0.015, "#7A7A74", 400), PARAMS, { offset: { x: 0, y: -0.045 } }),
    badge({ anchor: "bottom-center", offset: { x: 0, y: -0.012 }, tint: "dark", height: 0.018 }),
  ]
);
// instax
push(
  "os-instax-v1", "宽白拍立得", "Instax Wide", "polaroid",
  extend({ top: 0.04, right: 0.04, bottom: 0.24, left: 0.04 }, solid("#FBF9F4")),
  [
    text("date", "bottom-right", font(0.016, "#5A5A5A", 400), [item("date('YYYY.MM.DD', exif.datetime)", "2026.09.12")], { offset: { x: -0.04, y: -0.045 } }),
    badge({ anchor: "bottom-left", offset: { x: 0.04, y: -0.042 }, tint: "dark", height: 0.02 }),
    text("title", "bottom-left", font(0.02, "#2E2E2E", 600), [item("exif.model_pretty", "FrameGeist")], { offset: { x: 0.04, y: -0.1 } }),
  ]
);
// wordmark cityscape
push(
  "os-wordmark-city-v1", "城市字标", "Cityword", "magazine",
  extend({ top: 0.02, right: 0.02, bottom: 0.1, left: 0.02 }, solid("#FFFFFF")),
  [
    text("wordmark", "top-left", font(0.06, "#111111", 700, ["Space Grotesk", "Host Grotesk"]), [item("exif.make", "FRAMEGEIST")], { offset: { x: 0.03, y: 0.05 }, lineHeight: 1.0 }),
    text("params", "bottom-right", font(0.015, "#555555", 400), PARAMS, { offset: { x: -0.03, y: -0.04 } }),
    badge({ anchor: "bottom-left", offset: { x: 0.03, y: -0.035 }, tint: "dark", height: 0.018 }),
  ]
);
// postmark
push(
  "os-postmark-v1", "邮戳款", "Postmark", "gallery",
  extend({ top: 0.08, right: 0.14, bottom: 0.1, left: 0.14 }, solid("#FFFFFF")),
  [
    text("stamp1", "bottom-center", font(0.02, "#333333", 700), [item("date('YYYY.MM.DD', exif.datetime)", "2026.09.12")], { offset: { x: 0, y: -0.065 } }),
    text("stamp2", "bottom-center", font(0.014, "#777777", 400), [item("fmt('{focal}mm · f/{aperture}', exif)", "35mm · f/2.8")], { offset: { x: 0, y: -0.03 } }),
    badge({ anchor: "bottom-center", offset: { x: 0, y: -0.005 }, tint: "dark", height: 0.016 }),
  ]
);

/* ---------------- write + report ---------------- */
for (const tpl of T) {
  writeFileSync(join(OUT, `${tpl.meta.id}.json`), JSON.stringify(tpl, null, 2) + "\n");
}
const byCat = {};
for (const t of T) byCat[t.meta.category] = (byCat[t.meta.category] ?? 0) + 1;
console.log(`generated ${T.length} extra templates`, byCat);

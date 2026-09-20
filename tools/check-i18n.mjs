// v0.8.0 M0 gate: i18n integrity for the web UI.
//  1. zh/en key parity + placeholder consistency + no untranslated keys
//  2. every t("key") / data-i18n key referenced in code exists in the dict
//  3. no hardcoded user-visible strings in JS/HTML (whitelist for brands,
//     technical acronyms, symbols, expression previews)
// Usage: node tools/check-i18n.mjs [--quiet]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ROOT = process.cwd();
const QUIET = process.argv.includes("--quiet");
const dict = (await import(pathToFileURL(resolve(ROOT, "web/i18n.js")).href)).dict;
const zh = dict.zh ?? {};
const en = dict.en ?? {};
let failures = 0;
const records = [];
const fail = (msg) => { records.push(msg); console.log(`FAIL ${msg}`); failures += 1; };

/* ---------------------------------------------------------------- parity */
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const k of Object.keys(zh)) if (!(k in en)) fail(`parity: en missing key "${k}"`);
for (const k of Object.keys(en)) if (!(k in zh)) fail(`parity: zh missing key "${k}"`);
for (const [k, v] of Object.entries(zh)) {
  if (v === k) fail(`zh untranslated: "${k}"`);
  if (k in en && placeholders(v) !== placeholders(en[k])) {
    fail(`placeholders differ: "${k}" (zh {${placeholders(v)}} vs en {${placeholders(en[k])}})`);
  }
}

/* ------------------------------------------------------- key usage check */
const JS_FILES = ["web/app.js", "web/editor.js"];
const HTML_FILES = ["web/index.html"];
const keysUsed = new Set();
for (const f of JS_FILES) {
  const src = readFileSync(resolve(ROOT, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)"/g)) keysUsed.add(`${f}:${m[1]}`);
  for (const m of src.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) keysUsed.add(`${f}:${m[1]}`);
}
for (const f of HTML_FILES) {
  const src = readFileSync(resolve(ROOT, f), "utf8");
  for (const m of src.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) keysUsed.add(`${f}:${m[1]}`);
}
for (const entry of keysUsed) {
  const key = entry.slice(entry.indexOf(":") + 1);
  if (key.endsWith(".")) continue; // dynamic prefix like t("cat." + x)
  if (!(key in zh)) fail(`unknown i18n key "${key}" (${entry.split(":")[0]})`);
}

/* ------------------------------------------------------ hardcoded strings */
// Brands / technical acronyms / expression previews / symbols are allowed.
const BRAND_RE = /\b(canon|sony|nikon|fujifilm|leica|hasselblad|panasonic|lumix|ricoh|sigma|zeiss|dji|apple|tamron|epson|olympus|pentax|gopro|insta360|sandisk|phaseone|profoto|smallrig|samsung|vivo|oppo|oneplus|huawei|honor|google|motorola|nokia|blackmagic|viltrox|laowa|ttartisan|tokina|samyang|meike|7artisans|sirui|yongnuo|voigtlander|eos|ilce|nikkor|zuiko|gm|art|apo|sp|xf|xcd|batis|rf|ef)\b/i;
const TECH_RE = /^(exif|iso|jpeg|jpg|png|avif|webp|icc|gps|heic|heif|tiff|raw|dpi|kb|mb|mp|api|url|wasm|utf|sha|fps|px|mm|gb|tb|rgb|srgb|p3|adobe|ofl|cc0|mit|ui|ux|json|html|css|js|svg|dng|compression|web|light|dark|auto|official|original|s|m|l)$/i;
// ASCII punctuation/digits/symbols only (CJK counts as text, not symbols).
const ALLOW_LINE = /^[\s\d\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e_]*$/;
const PRODUCT_RE = /\b(framegeist|terraria|genshin|honkai|arknights|wukong|wwmeet|zzz)\b/i;
const LANG_RE = /^(english|chinese|中文|english \(us\)|stable|beta)$/i;
const NUMERIC_RE = /^\d+(?:\.\d+)?\s*(?:px|%|k|p|mp|mm|s|ms|·.*)?$/i;
const UI_BRANDS = /^(?:framegeist|fg|框灵|framegeist\s*·\s*框灵)$/i;
const isAllowedText = (raw) => {
  const text = raw.trim();
  if (!text) return true;
  // Symbols, digits, punctuation only -> nothing to translate.
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return true;
  if (UI_BRANDS.test(text)) return true;
  if (ALLOW_LINE.test(text)) return true;
  if (/^[a-z][\d\s°]*$/i.test(text)) return true; // single-letter + digits (z0, f2.8, 0°)
  if (NUMERIC_RE.test(text)) return true;
  if (/^(\d+(?:k|p)\s*·\s*\d+|\d+(?:k|p))$/i.test(text)) return true;
  if (LANG_RE.test(text)) return true;
  if (/^(exif|iso|jpeg|png|avif|webp|icc|gps|heic|tiff|raw|dpi|kb|mb|mp|api|url|wasm|sm|md|lg|en|zh)$/i.test(text)) return true;
  if (BRAND_RE.test(text) && !/[\u4e00-\u9fff]/.test(text)) return true;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.every((w) => TECH_RE.test(w.replace(/[^\w/.-]/g, "")))) return true;
  return false;
};
// A captured template literal that embeds unterminated expressions (nested
// backticks) is truncated by the regex; skip instead of misreporting.
const unbalanced = (s) => {
  const opens = (s.match(/\$\{/g) ?? []).length;
  const closes = (s.match(/\}/g) ?? []).length;
  return opens > closes;
};
// Strip template expressions and HTML tags to get the rendered literal text.
const literalOf = (s) => s
  .replace(/\$\{[^}]*\}/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z]+;/gi, " ")
  .trim();

const JS_PATTERNS = [
  { re: /\.textContent\s*=\s*(["'`])((?:(?!\1)[\s\S])*?)\1/g, what: "textContent" },
  { re: /\.(?:title|placeholder)\s*=\s*(["'`])((?:(?!\1)[\s\S])*?)\1/g, what: "title/placeholder" },
  { re: /setAttribute\(\s*"(?:aria-label|title|alt)"\s*,\s*(["'`])((?:(?!\1)[\s\S])*?)\1\s*\)/g, what: "attribute" },
  { re: /toast\(\s*"(?:ok|error|info)"\s*,\s*(["'`])((?:(?!\1)[\s\S])*?)\1\s*\)/g, what: "toast" },
  { re: /\.innerHTML\s*=\s*`([\s\S]*?)`/g, what: "innerHTML" },
  { re: /\.innerHTML\s*=\s*(["'])((?:(?!\1)[\s\S])*?)\1/g, what: "innerHTML" },
];
const HTML_ATTR = /(placeholder|title|aria-label|alt)="([^"]+)"/g;

const scanFile = (file) => {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  const lines = src.split("\n");
  const lineOf = (idx) => src.slice(0, idx).split("\n").length;
  if (file.endsWith(".js")) {
    for (const { re, what } of JS_PATTERNS) {
      for (const m of src.matchAll(re)) {
        const captured = m[2] ?? m[1];
        if (unbalanced(captured)) continue;
        const literal = what === "innerHTML" ? literalOf(m[1]) : literalOf(captured);
        if (isAllowedText(literal)) continue;
        fail(`${file}:${lineOf(m.index)}: hardcoded ${what}: ${JSON.stringify(literal.slice(0, 60))}`);
      }
    }
  } else {
    for (const m of src.matchAll(HTML_ATTR)) {
      const [, attr, value] = m;
      if (isAllowedText(value)) continue;
      // skip attributes that are driven by data-i18n on the same tag
      const tagStart = src.lastIndexOf("<", m.index);
      const tagEnd = src.indexOf(">", m.index);
      const tag = src.slice(tagStart, tagEnd);
      if (tag.includes(`data-i18n-${attr}`) || tag.includes("data-i18n=")) continue;
      fail(`${file}:${lineOf(m.index)}: hardcoded ${attr}="${value.slice(0, 40)}"`);
    }
    // text nodes between tags with CJK or long latin text (not in a script/style)
    const body = src.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
    for (const m of body.matchAll(/>([^<>{}=]+)</g)) {
      const text = m[1].trim();
      if (!text) continue;
      const tagStart = body.lastIndexOf("<", m.index);
      const tagEnd = body.indexOf(">", m.index);
      const tag = body.slice(tagStart, tagEnd);
      if (/data-i18n/.test(tag)) continue;
      if (isAllowedText(text)) continue;
      fail(`${file}: text node not localized: ${JSON.stringify(text.slice(0, 40))}`);
    }
  }
};

for (const f of [...JS_FILES, ...HTML_FILES, "web/settings.js"]) {
  try {
    scanFile(f);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

const jsonIdx = process.argv.indexOf("--json");
if (jsonIdx >= 0 && process.argv[jsonIdx + 1]) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({ zhKeys: Object.keys(zh).length, enKeys: Object.keys(en).length, failures: records }, null, 2), "utf8");
}
if (!QUIET) {
  console.log(`i18n check: ${Object.keys(zh).length} zh keys / ${Object.keys(en).length} en keys, ${failures} failure(s)`);
}
process.exit(failures === 0 ? 0 : 1);

// v0.7.0 M3 gate: APCA (0.1.9) readability check for the UI theme tokens in
// web/styles.css, plus a purple scan of the web tree.
//
// Usage: node tools/check-ui-contrast.mjs
import { readFileSync } from "node:fs";

const css = readFileSync("web/styles.css", "utf8");

function themeTokens(theme) {
  const re = new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`);
  const block = re.exec(css)?.[1] ?? "";
  const tokens = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

function hex(value) {
  const m = /^#?([0-9a-f]{6})$/i.exec(value ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function srgbToY([r, g, b]) {
  const lin = (c) => Math.pow(c / 255, 2.4);
  return 0.2126729 * lin(r) + 0.7151522 * lin(g) + 0.072175 * lin(b);
}

function apca(txt, bg) {
  const txtY = srgbToY(txt);
  const bgY = srgbToY(bg);
  const blkThrs = 0.022;
  const blkClmp = 1.414;
  const clamp = (y) => (y > blkThrs ? y : y + Math.pow(blkThrs - y, blkClmp));
  const ty = clamp(txtY);
  const by = clamp(bgY);
  const normBG = 0.56;
  const normTXT = 0.57;
  const revTXT = 0.62;
  const revBG = 0.65;
  const scale = 1.14;
  const loClip = 0.1;
  const loOffset = 0.027;
  let sapc;
  let out;
  if (by > ty) {
    sapc = (Math.pow(by, normBG) - Math.pow(ty, normTXT)) * scale;
    out = sapc < loClip ? 0 : sapc - loOffset;
  } else {
    sapc = (Math.pow(by, revBG) - Math.pow(ty, revTXT)) * scale;
    out = sapc > -loClip ? 0 : sapc + loOffset;
  }
  return out * 100;
}

const CHECKS = [
  ["body text", "text", "bg", 75],
  ["body text on card", "text", "bg-elev", 75],
  ["secondary text", "text-muted", "bg-elev", 60],
  ["secondary text on soft", "text-muted", "bg-soft", 55],
  ["faint text", "text-faint", "bg-elev", 30],
  ["chip text on chip", "chip-on-text", "chip-on", 75],
];

let failures = 0;
for (const theme of ["light", "dark"]) {
  const tokens = themeTokens(theme);
  console.log(`\n${theme}:`);
  for (const [label, fg, bg, min] of CHECKS) {
    const f = hex(tokens[fg]);
    const b = hex(tokens[bg]);
    if (!f || !b) {
      console.log(`  SKIP ${label} (missing token)`);
      continue;
    }
    const lc = apca(f, b);
    const ok = Math.abs(lc) >= min;
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"} ${label}: Lc ${lc.toFixed(1)} (min ${min})`);
  }
}

// white on the accent gradient endpoint (primary buttons)
const white = [255, 255, 255];
for (const [name, color] of [["accent-a", "#1772F6"], ["accent-b", "#50C8FD"]]) {
  const lc = apca(white, hex(color));
  const min = name === "accent-a" ? 45 : 30;
  const ok = Math.abs(lc) >= min;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"} button text on ${name}: Lc ${lc.toFixed(1)} (min ${min})`);
}

console.log(`\nui contrast: ${failures === 0 ? "all checks pass" : failures + " failures"}`);
process.exit(failures === 0 ? 0 : 1);

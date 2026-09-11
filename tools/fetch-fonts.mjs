// Downloads the 9 built-in engine fonts (OFL) + license files, writes
// templates/assets/fonts/fonts.json and mirrors them to web/fonts/engine/.
// CJK fonts are downloaded full here; tools/subset-cjk.py shrinks them after.
// Usage: node tools/fetch-fonts.mjs
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = "templates/assets/fonts";
const WEB = "web/fonts/engine";
mkdirSync(join(OUT, "licenses"), { recursive: true });
mkdirSync(WEB, { recursive: true });

const GF = "https://raw.githubusercontent.com/google/fonts/main";
const CJK = "https://raw.githubusercontent.com/notofonts/noto-cjk/main";

const FONTS = [
  { family: "Inter", file: "Inter-Regular.ttf", url: `${GF}/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf`, license: "OFL-1.1", licenseUrl: `${GF}/ofl/inter/OFL.txt` },
  { family: "Playfair Display", file: "PlayfairDisplay-Regular.ttf", url: `${GF}/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf`, license: "OFL-1.1", licenseUrl: `${GF}/ofl/playfairdisplay/OFL.txt` },
  { family: "Bebas Neue", file: "BebasNeue-Regular.ttf", url: `${GF}/ofl/bebasneue/BebasNeue-Regular.ttf`, license: "OFL-1.1", licenseUrl: `${GF}/ofl/bebasneue/OFL.txt` },
  { family: "Oswald", file: "Oswald-Regular.ttf", url: `${GF}/ofl/oswald/Oswald%5Bwght%5D.ttf`, license: "OFL-1.1", licenseUrl: `${GF}/ofl/oswald/OFL.txt` },
  { family: "Cormorant Garamond", file: "CormorantGaramond-Regular.ttf", url: `${GF}/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf`, license: "OFL-1.1", licenseUrl: `${GF}/ofl/cormorantgaramond/OFL.txt` },
  { family: "Space Grotesk", file: "SpaceGrotesk-Regular.ttf", url: `${GF}/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf`, license: "OFL-1.1", licenseUrl: `${GF}/ofl/spacegrotesk/OFL.txt` },
  { family: "JetBrains Mono", file: "JetBrainsMono-Regular.ttf", url: "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Regular.ttf", license: "OFL-1.1", licenseUrl: "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/OFL.txt" },
  { family: "Noto Sans SC", file: "NotoSansSC-Regular.otf", url: `${CJK}/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf`, license: "OFL-1.1", licenseUrl: `${CJK}/LICENSE` },
  { family: "Great Vibes", file: "GreatVibes-Regular.ttf", url: `${GF}/ofl/greatvibes/GreatVibes-Regular.ttf`, license: "OFL-1.1", licenseUrl: `${GF}/ofl/greatvibes/OFL.txt` },
  { family: "Ma Shan Zheng", file: "MaShanZheng-Regular.ttf", url: `${GF}/ofl/mashanzheng/MaShanZheng-Regular.ttf`, license: "OFL-1.1", licenseUrl: `${GF}/ofl/mashanzheng/OFL.txt` },
  { family: "Noto Serif SC", file: "NotoSerifSC-Regular.otf", url: `${CJK}/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf`, license: "OFL-1.1", licenseUrl: `${CJK}/LICENSE` },
];

const manifest = { fonts: FONTS.map((f) => ({ family: f.family, file: f.file, license: f.license })) };
writeFileSync(join(OUT, "fonts.json"), JSON.stringify(manifest, null, 2) + "\n");

const MIN = 50_000;
for (const f of FONTS) {
  const target = join(OUT, f.file);
  try {
    if (existsSync(target) && statSync(target).size > MIN) {
      console.log(`${f.file}: exists (skip)`);
    } else {
      const res = await fetch(f.url, { headers: { "user-agent": "FrameGeist/0.2" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < MIN) throw new Error(`too small (${buf.length})`);
      writeFileSync(target, buf);
      console.log(`${f.file}: ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
    }
    const licPath = join(OUT, "licenses", `${f.family.replace(/\s+/g, "-")}.txt`);
    if (!existsSync(licPath)) {
      const lr = await fetch(f.licenseUrl, { headers: { "user-agent": "FrameGeist/0.2" } });
      if (lr.ok) writeFileSync(licPath, await lr.text());
    }
  } catch (e) {
    console.log(`${f.file}: FAILED ${e.message}`);
  }
}

for (const f of FONTS) {
  const src = join(OUT, f.file);
  if (existsSync(src)) copyFileSync(src, join(WEB, f.file));
}
console.log("fonts.json + web/fonts/engine mirror written");

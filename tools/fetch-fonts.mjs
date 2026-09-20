// v0.7.0 M0 font pipeline, stage 1: download every OFL source font.
//
// Sources land in templates/assets/fonts/source/ (raw/ keeps archives).
// Every download is SHA256-pinned in tools/font-pins.json (trust on first
// fetch, verified on every later run). CJK releases are extracted with
// Python (zipfile / py7zr) and the selected faces copied to source/.
// The build stages are then invoked automatically:
//   python tools/instance-fonts.py   (Latin variable -> static 400/500/600/700)
//   python tools/subset-cjk.py       (CJK -> GB2312 + repo charset subsets)
//
// Usage: node tools/fetch-fonts.mjs --fetch [--force] [--no-build] [--update-pins]
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, copyFileSync, statSync, unlinkSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

if (!process.argv.includes("--fetch")) {
  console.error("usage: node tools/fetch-fonts.mjs --fetch [--force] [--no-build] [--update-pins]");
  process.exit(1);
}

const OUT = "templates/assets/fonts";
const SRC = join(OUT, "source");
const RAW = join(SRC, "raw");
const LIC = join(OUT, "licenses");
const WEB = "web/fonts/engine";
const PINS = "tools/font-pins.json";
const FORCE = process.argv.includes("--force");
const NO_BUILD = process.argv.includes("--no-build");
const UPDATE_PINS = process.argv.includes("--update-pins");
for (const d of [OUT, SRC, RAW, LIC, WEB]) mkdirSync(d, { recursive: true });

const GF = "https://raw.githubusercontent.com/google/fonts/main";
const CJK = "https://raw.githubusercontent.com/notofonts/noto-cjk/main";
const GH = "https://raw.githubusercontent.com";

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

let pins = {};
if (existsSync(PINS)) pins = JSON.parse(readFileSync(PINS, "utf8"));
let pinsDirty = false;
function setPin(key, sha, bytes) {
  pins[key] = { sha256: sha, bytes };
  pinsDirty = true;
  writeFileSync(PINS, JSON.stringify(pins, null, 2) + "\n");
}

function jsdelivrMirror(url) {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
  return m ? `https://cdn.jsdelivr.net/gh/${m[1]}/${m[2]}@${m[3]}/${m[4]}` : null;
}

async function fetchBuf(url, label) {
  const candidates = [url];
  const mirror = jsdelivrMirror(url);
  if (mirror) candidates.push(mirror);
  let lastErr;
  for (const cand of candidates) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(cand, { headers: { "user-agent": "FrameGeist/0.7" }, signal: AbortSignal.timeout(90000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const len = Number(res.headers.get("content-length") ?? 0);
        // content-length is the compressed size when the response is gzip'd.
        if (len && !res.headers.get("content-encoding") && buf.length !== len) {
          throw new Error(`truncated (${buf.length}/${len})`);
        }
        return buf;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  throw new Error(`${label}: ${lastErr.message}`);
}

async function fetchVerified(url, label, target) {
  if (!FORCE && existsSync(target) && statSync(target).size > 1024) {
    const buf = readFileSync(target);
    const pin = pins[url];
    if (!pin) {
      setPin(url, sha256(buf), buf.length);
      console.log(`  adopted ${label} sha256=${sha256(buf).slice(0, 12)}… (${(buf.length / 1048576).toFixed(2)} MB)`);
      return buf;
    }
    if (sha256(buf) === pin.sha256) {
      console.log(`  cached ${label} (${(buf.length / 1048576).toFixed(2)} MB)`);
      return buf;
    }
  }
  const buf = await fetchBuf(url, label);
  const got = sha256(buf);
  const pin = pins[url];
  if (pin && pin.sha256 !== got && !UPDATE_PINS) {
    throw new Error(`${label}: sha256 mismatch (pinned ${pin.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…; use --update-pins if upstream really changed)`);
  }
  if (!pin || pin.sha256 !== got) {
    setPin(url, got, buf.length);
    console.log(`  pinned ${label} sha256=${got.slice(0, 12)}… (${(buf.length / 1048576).toFixed(2)} MB)`);
  } else {
    console.log(`  ok ${label} (${(buf.length / 1048576).toFixed(2)} MB)`);
  }
  writeFileSync(target, buf);
  return buf;
}

function runPython(code, args, label) {
  try {
    return execFileSync("python", ["-c", code, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`${label}: ${e.stderr || e.message}`);
  }
}

// github.com itself is sometimes unreachable here while the API and
// objects.githubusercontent.com stay up; gh handles the redirect for us.
function matchPattern(dir, pattern) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  const re = new RegExp(`^${esc}$`);
  return readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f));
}

function pinReleaseAsset(key, file) {
  const buf = readFileSync(file);
  const got = sha256(buf);
  const prev = pins[key];
  if (prev && prev.sha256 !== got && !UPDATE_PINS) {
    throw new Error(`${key}: sha256 mismatch (pinned ${prev.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…)`);
  }
  if (!prev || prev.sha256 !== got) {
    setPin(key, got, buf.length);
    console.log(`  pinned ${key} sha256=${got.slice(0, 12)}… (${(buf.length / 1048576).toFixed(2)} MB)`);
  } else {
    console.log(`  cached ${key} (${(buf.length / 1048576).toFixed(2)} MB)`);
  }
  return file;
}

function ghDownload(repo, tag, pattern, destDir, expectedSize) {
  mkdirSync(destDir, { recursive: true });
  const key = `${repo}@${tag}/${pattern}`;
  const existing = matchPattern(destDir, pattern);
  if (existing.length && !FORCE && (!expectedSize || statSync(existing[0]).size === expectedSize)) {
    return pinReleaseAsset(key, existing[0]);
  }
  try {
    execFileSync("gh", ["release", "download", tag, "-R", repo, "-p", pattern, "-D", destDir, "--clobber"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new Error(`${repo}@${tag}/${pattern}: ${e.stderr || e.message}`);
  }
  const files = matchPattern(destDir, pattern);
  if (!files.length) throw new Error(`${repo}@${tag}: asset ${pattern} not found`);
  return pinReleaseAsset(key, files[0]);
}

const EXTRACT_ZIP = `
import sys, zipfile, os, shutil, fnmatch
src, dest, patterns = sys.argv[1], sys.argv[2], sys.argv[3].split(";")
os.makedirs(dest, exist_ok=True)
found = []
with zipfile.ZipFile(src) as z:
    for name in z.namelist():
        base = os.path.basename(name)
        if not base: continue
        for pat in patterns:
            if fnmatch.fnmatch(base, pat):
                out = os.path.join(dest, base)
                with z.open(name) as f, open(out, "wb") as g:
                    shutil.copyfileobj(f, g)
                found.append(base)
print("\\n".join(found))
`;

const EXTRACT_7Z = `
import sys, os
import py7zr
src, dest, patterns = sys.argv[1], sys.argv[2], sys.argv[3].split(";")
import fnmatch, shutil
os.makedirs(dest, exist_ok=True)
found = []
with py7zr.SevenZipFile(src, mode="r") as z:
    names = z.getnames()
    for name in names:
        base = os.path.basename(name)
        if base and any(fnmatch.fnmatch(base, p) for p in patterns):
            z.extract(path=dest, targets=[name])
            extracted = os.path.join(dest, name)
            final = os.path.join(dest, base)
            if os.path.abspath(extracted) != os.path.abspath(final):
                shutil.move(extracted, final)
            found.append(base)
print("\\n".join(found))
`;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function extract7z(src, patterns, dest, label) {
  // py7zr chokes on some upstream archives (LZMA filter variants); Windows
  // bsdtar reads them fine, so try tar first and keep py7zr as a fallback.
  const tar = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
  try {
    execFileSync(tar, ["-xf", src, "-C", dest], { stdio: ["ignore", "pipe", "pipe"] });
    return walk(dest).filter((f) => patterns.some((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(basename(f))));
  } catch (e) {
    console.log(`  ${label}: tar fallback to py7zr (${e.message.split("\n")[0]})`);
    const out = runPython(EXTRACT_7Z, [src, dest, patterns.join(";")], label);
    return out.split("\n").map((s) => s.trim()).filter(Boolean).map((f) => join(dest, f));
  }
}

function extract(src, patterns, label) {
  const dest = join(RAW, label);
  if (src.endsWith(".7z")) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const files = extract7z(src, patterns, dest, label);
    if (files.length === 0) throw new Error(`${label}: no files matched ${patterns.join(", ")}`);
    return files;
  }
  mkdirSync(dest, { recursive: true });
  let out;
  if (src.endsWith(".zip")) out = runPython(EXTRACT_ZIP, [src, dest, patterns.join(";")], label);
  else throw new Error(`unknown archive: ${src}`);
  const files = out.split("\n").map((s) => s.trim()).filter(Boolean);
  if (files.length === 0) throw new Error(`${label}: no files matched ${patterns.join(", ")}`);
  return files.map((f) => join(dest, f));
}

// ------------------------------------------------------------------ catalog
// Latin variable fonts: instanced to static weights by instance-fonts.py.
// CJK fonts: subset by subset-cjk.py. `stem` is part of the output filename
// and therefore the engine family key (first '-' segment, normalized).
const LATIN_VARIABLE = [
  { family: "Inter", stem: "Inter", url: `${GF}/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/inter/OFL.txt`, axes: { opsz: 16 } },
  { family: "Playfair Display", stem: "PlayfairDisplay", url: `${GF}/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/playfairdisplay/OFL.txt`, axes: {} },
  { family: "Oswald", stem: "Oswald", url: `${GF}/ofl/oswald/Oswald%5Bwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/oswald/OFL.txt`, axes: {} },
  { family: "Cormorant Garamond", stem: "CormorantGaramond", url: `${GF}/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/cormorantgaramond/OFL.txt`, axes: {} },
  { family: "Space Grotesk", stem: "SpaceGrotesk", url: `${GF}/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/spacegrotesk/OFL.txt`, axes: {} },
  { family: "Fraunces", stem: "Fraunces", url: `${GF}/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/fraunces/OFL.txt`, axes: { SOFT: 0, WONK: 0, opsz: 72 } },
  { family: "Bricolage Grotesque", stem: "BricolageGrotesque", url: `${GF}/ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/bricolagegrotesque/OFL.txt`, axes: { opsz: 36, wdth: 100 } },
  { family: "Instrument Sans", stem: "InstrumentSans", url: `${GF}/ofl/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/instrumentsans/OFL.txt`, axes: { wdth: 100 } },
  { family: "Geist", stem: "Geist", url: `${GF}/ofl/geist/Geist%5Bwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/geist/OFL.txt`, axes: {} },
  { family: "Geist Mono", stem: "GeistMono", url: `${GF}/ofl/geistmono/GeistMono%5Bwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/geistmono/OFL.txt`, axes: {} },
  { family: "Onest", stem: "Onest", url: `${GF}/ofl/onest/Onest%5Bwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/onest/OFL.txt`, axes: {} },
  { family: "Unbounded", stem: "Unbounded", url: `${GF}/ofl/unbounded/Unbounded%5Bwght%5D.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/unbounded/OFL.txt`, axes: {} },
];

// Latin static fonts: copied through unchanged (weight fixed by the file).
const LATIN_STATIC = [
  { family: "Bebas Neue", stem: "BebasNeue", weight: 400, url: `${GF}/ofl/bebasneue/BebasNeue-Regular.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/bebasneue/OFL.txt` },
  { family: "Instrument Serif", stem: "InstrumentSerif", weight: 400, url: `${GF}/ofl/instrumentserif/InstrumentSerif-Regular.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/instrumentserif/OFL.txt` },
  { family: "Great Vibes", stem: "GreatVibes", weight: 400, url: `${GF}/ofl/greatvibes/GreatVibes-Regular.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/greatvibes/OFL.txt` },

  { family: "JetBrains Mono", stem: "JetBrainsMono", weight: 400, url: `${GH}/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Regular.ttf`, lic: "OFL-1.1", licUrl: `${GH}/JetBrains/JetBrainsMono/master/OFL.txt` },
  { family: "JetBrains Mono", stem: "JetBrainsMono", weight: 500, url: `${GH}/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Medium.ttf`, lic: "OFL-1.1", licUrl: `${GH}/JetBrains/JetBrainsMono/master/OFL.txt` },
  { family: "JetBrains Mono", stem: "JetBrainsMono", weight: 700, url: `${GH}/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Bold.ttf`, lic: "OFL-1.1", licUrl: `${GH}/JetBrains/JetBrainsMono/master/OFL.txt` },
];

const NOTO_CJK = [
  { family: "Ma Shan Zheng", stem: "MaShanZheng", weight: 400, ext: "ttf", url: `${GF}/ofl/mashanzheng/MaShanZheng-Regular.ttf`, lic: "OFL-1.1", licUrl: `${GF}/ofl/mashanzheng/OFL.txt` },
  { family: "Noto Sans SC", stem: "NotoSansSC", weight: 400, ext: "otf", url: `${CJK}/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf`, lic: "OFL-1.1", licUrl: `${CJK}/Sans/LICENSE` },
  { family: "Noto Sans SC", stem: "NotoSansSC", weight: 500, ext: "otf", url: `${CJK}/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Medium.otf`, lic: "OFL-1.1", licUrl: `${CJK}/Sans/LICENSE` },
  { family: "Noto Sans SC", stem: "NotoSansSC", weight: 700, ext: "otf", url: `${CJK}/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf`, lic: "OFL-1.1", licUrl: `${CJK}/Sans/LICENSE` },
  { family: "Noto Serif SC", stem: "NotoSerifSC", weight: 400, ext: "otf", url: `${CJK}/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf`, lic: "OFL-1.1", licUrl: `${CJK}/Sans/LICENSE` },
  { family: "Noto Serif SC", stem: "NotoSerifSC", weight: 600, ext: "otf", url: `${CJK}/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-SemiBold.otf`, lic: "OFL-1.1", licUrl: `${CJK}/Sans/LICENSE` },
  { family: "Noto Serif SC", stem: "NotoSerifSC", weight: 700, ext: "otf", url: `${CJK}/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Bold.otf`, lic: "OFL-1.1", licUrl: `${CJK}/Sans/LICENSE` },
];

async function resolveRelease(repo, assetMatch) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "user-agent": "FrameGeist/0.7", accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${repo}: release lookup HTTP ${res.status}`);
  const rel = await res.json();
  const asset = rel.assets.find((a) => assetMatch(a.name));
  if (!asset) throw new Error(`${repo}: no asset matching ${assetMatch}`);
  return { tag: rel.tag_name, url: asset.browser_download_url, name: asset.name, size: asset.size };
}

async function main() {
  console.log("== v0.7.0 font fetch ==");
  const sources = { latinVariable: [], latinStatic: [], cjk: [] };

  for (const f of LATIN_VARIABLE) {
    const target = join(SRC, basename(decodeURIComponent(f.url)));
    await fetchVerified(f.url, f.stem, target);
    await fetchVerified(f.licUrl, `${f.stem} license`, join(LIC, `${f.stem}.txt`));
    sources.latinVariable.push({ ...f, file: target.split("\\").join("/"), weights: [400, 500, 600, 700] });
  }
  for (const f of LATIN_STATIC) {
    const target = join(SRC, basename(f.url));
    await fetchVerified(f.url, `${f.stem}-${f.weight}`, target);
    if (!existsSync(join(LIC, `${f.stem}.txt`)) || FORCE) {
      await fetchVerified(f.licUrl, `${f.stem} license`, join(LIC, `${f.stem}.txt`));
    }
    sources.latinStatic.push({ ...f, file: target.split("\\").join("/") });
  }
  for (const f of NOTO_CJK) {
    const target = join(SRC, basename(f.url));
    await fetchVerified(f.url, `${f.stem}-${f.weight}`, target);
    if (!existsSync(join(LIC, `${f.stem}.txt`)) || FORCE) {
      await fetchVerified(f.licUrl, `${f.stem} license`, join(LIC, `${f.stem}.txt`));
    }
    sources.cjk.push({ ...f, file: target.split("\\").join("/") });
  }

  // ---- Smiley Sans (release zip, single Oblique face) ----
  {
    const repo = "atelier-anchor/smiley-sans";
    const rel = await resolveRelease(repo, (n) => /\.zip$/i.test(n));
    const zip = ghDownload(repo, rel.tag, rel.name, RAW, rel.size);
    const [ttf] = extract(zip, ["SmileySans*.ttf"], "smiley-sans");
    const target = join(SRC, "SmileySans-Oblique.ttf");
    copyFileSync(ttf, target);
    if (!existsSync(join(LIC, "SmileySans.txt")) || FORCE) {
      await fetchVerified(`${GH}/${repo}/${rel.tag}/LICENSE`, "smiley license", join(LIC, "SmileySans.txt"));
    }
    sources.cjk.push({ family: "Smiley Sans", stem: "SmileySans", weight: 400, ext: "ttf", file: target.split("\\").join("/"), lic: "OFL-1.1" });
  }

  // ---- LXGW WenKai (TTFs committed under fonts/TTF on the main branch) ----
  {
    const repo = "lxgw/LxgwWenKai";
    const wanted = [["LXGWWenKai-Regular.ttf", 400], ["LXGWWenKai-Medium.ttf", 500]];
    for (const [name, weight] of wanted) {
      const url = `${GH}/${repo}/main/fonts/TTF/${name}`;
      const target = join(SRC, name);
      await fetchVerified(url, name, target);
      sources.cjk.push({ family: "LXGW WenKai", stem: "LXGWWenKai", weight, ext: "ttf", file: target.split("\\").join("/"), lic: "OFL-1.1" });
    }
    if (!existsSync(join(LIC, "LXGWWenKai.txt")) || FORCE) {
      await fetchVerified(`${GH}/${repo}/main/OFL.txt`, "lxgw license", join(LIC, "LXGWWenKai.txt"));
    }
  }

  // ---- Glow Sans SC (zip per family, multiple weight files) ----
  {
    const repo = "welai/glow-sans";
    const rel = await resolveRelease(repo, (n) => /GlowSansSC-Normal-.*\.zip$/i.test(n));
    const zip = ghDownload(repo, rel.tag, rel.name, RAW, rel.size);
    const files = extract(zip, ["GlowSansSC-Normal-*.otf", "GlowSansSC-Normal-*.ttf"], "glow-sans");
    const pick = (re) => {
      const hit = files.find((p) => re.test(basename(p)));
      if (!hit) throw new Error(`glow-sans: no face matching ${re} (have ${files.map((p) => basename(p)).join(", ")})`);
      return hit;
    };
    const faces = [
      [400, pick(/-Regular\.otf$/i)],
      [500, pick(/-Medium\.otf$/i)],
      [700, pick(/-Bold\.otf$/i)],
    ];
    for (const [weight, file] of faces) {
      sources.cjk.push({ family: "Glow Sans SC", stem: "GlowSansSC", weight, ext: "otf", file: file.split("\\").join("/"), lic: "OFL-1.1" });
    }
    if (!existsSync(join(LIC, "GlowSansSC.txt")) || FORCE) {
      await fetchVerified(`${GH}/${repo}/${rel.tag}/LICENSE`, "glow license", join(LIC, "GlowSansSC.txt"));
    }
  }

  // ---- Sarasa Gothic SC (7z, Regular + Bold) ----
  {
    const repo = "be5invis/Sarasa-Gothic";
    const rel = await resolveRelease(repo, (n) => /SarasaGothicSC-TTF-.*\.7z$/i.test(n));
    const archive = ghDownload(repo, rel.tag, rel.name, RAW, rel.size);
    const files = extract(archive, ["SarasaGothicSC-Regular.ttf", "SarasaGothicSC-Bold.ttf"], "sarasa");
    const wanted = [["SarasaGothicSC-Regular.ttf", 400], ["SarasaGothicSC-Bold.ttf", 700]];
    for (const [name, weight] of wanted) {
      const pick = files.find((p) => basename(p) === name);
      if (!pick) throw new Error(`sarasa: ${name} not found (have ${files.map((p) => basename(p)).join(", ")})`);
      sources.cjk.push({ family: "Sarasa Gothic SC", stem: "SarasaGothicSC", weight, ext: "ttf", file: pick.split("\\").join("/"), lic: "OFL-1.1" });
    }
    if (!existsSync(join(LIC, "SarasaGothicSC.txt")) || FORCE) {
      await fetchVerified(`${GH}/${repo}/${rel.tag}/LICENSE`, "sarasa license", join(LIC, "SarasaGothicSC.txt"));
    }
  }

  writeFileSync(join(SRC, "sources.json"), JSON.stringify(sources, null, 2) + "\n");
  if (pinsDirty) writeFileSync(PINS, JSON.stringify(pins, null, 2) + "\n");
  console.log(`sources.json: ${sources.latinVariable.length} variable, ${sources.latinStatic.length} latin static, ${sources.cjk.length} CJK faces`);

  if (!NO_BUILD) {
    if (FORCE) for (const f of readdirSync(OUT)) {
      if (/\.(ttf|otf)$/.test(f)) unlinkSync(join(OUT, f));
    }
    console.log("== instancing Latin variable fonts ==");
    console.log(runPython("import runpy; runpy.run_path('tools/instance-fonts.py', run_name='__main__')", [], "instance-fonts"));
    console.log("== subsetting CJK fonts ==");
    console.log(runPython("import runpy; runpy.run_path('tools/subset-cjk.py', run_name='__main__')", [], "subset-cjk"));
    const entries = finalizeManifest(sources);
    console.log(`fonts.json: ${entries.length} faces / ${new Set(entries.map((e) => e.family)).size} families`);
  }
  console.log("done.");
}

// Assemble the runtime manifest (one entry per weight file) and mirror to web.
function finalizeManifest(sources) {
  const byStem = new Map();
  for (const group of ["latinVariable", "latinStatic", "cjk"]) {
    for (const e of sources[group]) byStem.set(e.stem, { family: e.family, lazy: group === "cjk" });
  }
  const entries = [];
  for (const file of readdirSync(OUT)) {
    const m = /^(.+)-(\d{3})\.(ttf|otf)$/.exec(file);
    if (!m) continue;
    const meta = byStem.get(m[1]);
    if (!meta) continue;
    entries.push({ family: meta.family, file, weight: Number(m[2]), license: "OFL-1.1", ...(meta.lazy ? { lazy: true } : {}) });
  }
  entries.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight);
  const keep = new Set(entries.map((e) => e.file));
  for (const f of readdirSync(OUT)) {
    if (/\.(ttf|otf)$/.test(f) && !keep.has(f)) {
      unlinkSync(join(OUT, f));
      console.log(`removed stale ${f}`);
    }
  }
  const manifest = { fonts: entries };
  writeFileSync(join(OUT, "fonts.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const f of readdirSync(WEB)) {
    if (/\.(ttf|otf)$/.test(f) && !keep.has(f)) unlinkSync(join(WEB, f));
  }
  for (const e of entries) copyFileSync(join(OUT, e.file), join(WEB, e.file));
  writeFileSync(join(WEB, "fonts.json"), JSON.stringify(manifest, null, 2) + "\n");
  return entries;
}

main().catch((e) => {
  console.error(`fetch-fonts: ${e.message}`);
  process.exit(1);
});

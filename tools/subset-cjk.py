# v0.7.0 M0: subsets every CJK source face listed in
# templates/assets/fonts/source/sources.json to GB2312 level-1 (3755 common
# hanzi) plus latin/punctuation and every non-ASCII char used anywhere in this
# repo. Also normalizes family/style names and OS/2 weight so the engine can
# pick the right static face per `font.weight`.
# Usage: python tools/subset-cjk.py
import json
import os
import sys

from fontTools.ttLib import TTFont
from fontTools import subset

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(REPO, "templates", "assets", "fonts")
SRC = os.path.join(FONTS_DIR, "source")

SUBFAMILY = {
    "300": "Light",
    "400": "Regular",
    "500": "Medium",
    "600": "SemiBold",
    "700": "Bold",
    "800": "ExtraBold",
    "900": "Black",
}


def gb2312_level1() -> set:
    chars = set()
    # GB2312 zones 16..55 => first byte 0xB0..0xD7, second 0xA1..0xFE
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return chars


def repo_chars() -> set:
    chars = set()
    exts = {".md", ".html", ".js", ".mjs", ".json", ".rs", ".toml", ".css", ".ps1", ".py"}
    skip_dirs = {"node_modules", "target", ".git", ".next", "source"}
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for name in files:
            if os.path.splitext(name)[1].lower() in exts:
                try:
                    with open(os.path.join(root, name), encoding="utf-8", errors="ignore") as fh:
                        for ch in fh.read():
                            if ord(ch) > 127:
                                chars.add(ch)
                except OSError:
                    pass
    return chars


def build_charset() -> set:
    chars = set()
    for code in range(0x20, 0x7F):
        chars.add(chr(code))
    for start, end in [
        (0x00A0, 0x00FF),  # latin-1
        (0x2000, 0x206F),  # general punctuation
        (0x2190, 0x21FF),  # arrows
        (0x2460, 0x24FF),  # enclosed alphanumerics
        (0x25A0, 0x25FF),  # geometric shapes
        (0x2600, 0x26FF),  # misc symbols
        (0x3000, 0x303F),  # cjk punctuation
        (0xFF00, 0xFFEF),  # fullwidth forms
    ]:
        for code in range(start, end + 1):
            chars.add(chr(code))
    chars |= gb2312_level1()
    chars |= repo_chars()
    chars.discard("\n")
    chars.discard(" ")
    return chars


def set_name(ttf, name_id, value):
    name = ttf["name"]
    hit = False
    for rec in name.names:
        if rec.nameID == name_id:
            rec.string = value
            hit = True
    if not hit:
        name.setName(value, name_id, 3, 1, 0x409)


def normalize_faces(ttf, weight):
    sub = SUBFAMILY.get(str(weight), str(weight))
    fam = None
    for nid in (16, 1):
        try:
            fam = ttf["name"].getDebugName(nid)
        except Exception:
            fam = None
        if fam:
            break
    if not fam:
        return
    full = fam if sub == "Regular" else f"{fam} {sub}"
    ps = f"{fam.replace(' ', '')}-{sub}"
    set_name(ttf, 1, fam)
    set_name(ttf, 2, sub)
    set_name(ttf, 3, f"{full};FrameGeist-v0.7.0")
    set_name(ttf, 4, full)
    set_name(ttf, 6, ps)
    if ttf["name"].getDebugName(16):
        set_name(ttf, 16, fam)
    if ttf["name"].getDebugName(17):
        set_name(ttf, 17, sub)
    if "OS/2" in ttf:
        ttf["OS/2"].usWeightClass = int(weight)
    if "head" in ttf:
        ttf["head"].fontRevision = 0.7


def main() -> int:
    with open(os.path.join(SRC, "sources.json"), encoding="utf-8") as fh:
        sources = json.load(fh)
    faces = sources.get("cjk", [])

    # repo scan only needs to happen once for every face
    charset = build_charset()
    chars_file = os.path.join(FONTS_DIR, "_subset-chars.txt")
    with open(chars_file, "w", encoding="utf-8", newline="") as fh:
        fh.write("".join(sorted(charset)))
    print(f"charset: {len(charset)} chars")

    for entry in faces:
        src = entry["file"]
        stem = entry["stem"]
        weight = entry.get("weight", 400)
        ext = entry.get("ext") or os.path.splitext(src)[1].lstrip(".")
        if not os.path.exists(src):
            print(f"{os.path.basename(src)}: missing, skip")
            continue
        before = os.path.getsize(src)
        print(f"subsetting {stem}-{weight} from {os.path.basename(src)} ({before/1024/1024:.1f} MB)...")
        try:
            ttf = TTFont(src)
            normalize_faces(ttf, weight)
            options = subset.Options()
            options.layout_features = ["*"]
            options.name_IDs = ["*"]
            options.glyph_names = True
            options.hinting = False
            options.desubroutinize = True
            options.notdef_outline = True
            options.drop_tables += ["DSIG"]
            cmap = ttf.getBestCmap() or {}
            kept = [c for c in charset if ord(c) in cmap]
            missing = len(charset) - len(kept)
            subsetter = subset.Subsetter(options=options)
            subsetter.populate(text="".join(sorted(kept)))
            subsetter.subset(ttf)
            if missing:
                print(f"  note: {missing} charset chars not in this face")
            out = os.path.join(FONTS_DIR, f"{stem}-{weight}.{ext}")
            ttf.save(out)
        except Exception as e:  # noqa: BLE001 - report and continue
            print(f"  FAILED: {e}")
            continue
        print(f"  -> {os.path.basename(out)} ({os.path.getsize(out)/1024/1024:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

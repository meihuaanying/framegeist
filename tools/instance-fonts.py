# v0.7.0 M0: instance Latin variable fonts to static 400/500/600/700 faces,
# normalize weight metadata, then subset to a Latin character set (OFL kept).
# Reads templates/assets/fonts/source/sources.json, writes final
# <stem>-<weight>.<ext> files into templates/assets/fonts/.
# Usage: python tools/instance-fonts.py
import json
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(REPO, "templates", "assets", "fonts")
SRC = os.path.join(FONTS, "source")

SUBFAMILY = {
    "300": "Light",
    "400": "Regular",
    "500": "Medium",
    "600": "SemiBold",
    "700": "Bold",
    "800": "ExtraBold",
    "900": "Black",
}

# Google Fonts latin + latin-ext essential ranges + typographic punctuation.
LATIN_RANGES = [
    (0x0000, 0x00FF),
    (0x0131, 0x0131),
    (0x0152, 0x0153),
    (0x02BB, 0x02BC),
    (0x02C6, 0x02C6),
    (0x02DA, 0x02DA),
    (0x02DC, 0x02DC),
    (0x0304, 0x0304),
    (0x0308, 0x0308),
    (0x0329, 0x0329),
    (0x2000, 0x206F),
    (0x20AC, 0x20AC),
    (0x2122, 0x2122),
    (0x2190, 0x2193),
    (0x2212, 0x2212),
    (0x2215, 0x2215),
    (0xFEFF, 0xFEFF),
    (0xFFFD, 0xFFFD),
]


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
        raise ValueError("font has no family name")
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


def subset_latin(ttf, label):
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.glyph_names = True
    options.hinting = False
    options.desubroutinize = True
    options.notdef_outline = True
    options.drop_tables += ["DSIG"]
    subsetter = subset.Subsetter(options=options)
    unicodes = set()
    for lo, hi in LATIN_RANGES:
        unicodes.update(range(lo, hi + 1))
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(ttf)
    print(f"  {label}: subset ok")


def instance_variable(entry):
    src = entry["file"]
    stem = entry["stem"]
    axes = entry.get("axes") or {}
    out_paths = []
    for weight in entry.get("weights", [400, 500, 600, 700]):
        ttf = TTFont(src)
        fvar = ttf["fvar"]
        loc = {}
        for axis in fvar.axes:
            tag = axis.axisTag
            if tag == "wght":
                loc[tag] = weight
            elif tag in axes:
                loc[tag] = axes[tag]
            else:
                loc[tag] = axis.defaultValue
        print(f"{stem} wght={weight}: pinning {loc}")
        ttf = instancer.instantiateVariableFont(ttf, loc, inplace=False, optimize=True, updateFontNames=False)
        normalize_faces(ttf, weight)
        subset_latin(ttf, f"{stem}-{weight}")
        out = os.path.join(FONTS, f"{stem}-{weight}.ttf")
        ttf.save(out)
        print(f"  -> {os.path.basename(out)} ({os.path.getsize(out)/1024:.0f} KB)")
        out_paths.append(out)
    return out_paths


def copy_static(entry):
    src = entry["file"]
    stem = entry["stem"]
    weight = entry.get("weight", 400)
    ext = entry.get("ext") or os.path.splitext(src)[1].lstrip(".")
    ttf = TTFont(src)
    normalize_faces(ttf, weight)
    subset_latin(ttf, f"{stem}-{weight}")
    out = os.path.join(FONTS, f"{stem}-{weight}.{ext}")
    ttf.save(out)
    print(f"  -> {os.path.basename(out)} ({os.path.getsize(out)/1024:.0f} KB)")
    return out


def main():
    sources = json.load(open(os.path.join(SRC, "sources.json"), encoding="utf-8"))
    print(f"instancing {len(sources.get('latinVariable', []))} variable faces")
    for entry in sources.get("latinVariable", []):
        instance_variable(entry)
    print(f"copying {len(sources.get('latinStatic', []))} static faces")
    for entry in sources.get("latinStatic", []):
        copy_static(entry)
    return 0


if __name__ == "__main__":
    sys.exit(main())

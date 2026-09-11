# Subsets the bundled CJK fonts to GB2312 level-1 (3755 common hanzi) plus
# latin/punctuation and every non-ASCII char used anywhere in this repo.
# Usage: python tools/subset-cjk.py
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(REPO, "templates", "assets", "fonts")
WEB_DIR = os.path.join(REPO, "web", "fonts", "engine")
TARGETS = ["NotoSansSC-Regular.otf", "NotoSerifSC-Regular.otf", "MaShanZheng-Regular.ttf"]


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
    skip_dirs = {"node_modules", "target", ".git", ".next"}
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


def build_charset() -> str:
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
    return "".join(sorted(chars))


def main() -> int:
    charset = build_charset()
    chars_file = os.path.join(FONTS_DIR, "_subset-chars.txt")
    with open(chars_file, "w", encoding="utf-8", newline="") as fh:
        fh.write(charset)
    print(f"charset: {len(charset)} chars")

    for name in TARGETS:
        src = os.path.join(FONTS_DIR, name)
        if not os.path.exists(src):
            print(f"{name}: missing, skip")
            continue
        before = os.path.getsize(src)
        tmp = src + ".subset"
        cmd = [
            sys.executable, "-m", "fontTools.subset", src,
            f"--text-file={chars_file}",
            f"--output-file={tmp}",
            "--layout-features=*",
            "--name-IDs=*",
            "--glyph-names",
            "--no-hinting",
            "--desubroutinize",
        ]
        print(f"subsetting {name} ({before/1024/1024:.1f} MB)...")
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-800:])
            print(r.stderr[-800:])
            print(f"{name}: pyftsubset failed")
            continue
        os.replace(tmp, src)
        after = os.path.getsize(src)
        print(f"{name}: {before/1024/1024:.2f} MB -> {after/1024/1024:.2f} MB")
        web = os.path.join(WEB_DIR, name)
        if os.path.isdir(WEB_DIR):
            with open(src, "rb") as rf, open(web, "wb") as wf:
                wf.write(rf.read())
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Builds small, fully synthetic TrueType fonts for tests.

Each glyph is a rectangle whose width depends on the character, so layout,
tracking and fitting are measurable without depending on whatever fonts happen
to be installed. Weight changes the stem (rectangle) height so renders differ.
"""

from __future__ import annotations

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,-:'!&"
UPM = 1000


def glyph_advance(ch: str, mono: bool) -> int:
    if mono:
        return 600
    return 300 if ch == " " else 500 + (ord(ch) % 5) * 60


def make_font(
    path: Path,
    family: str = "Test Sans",
    style: str = "Regular",
    weight: int = 400,
    width: int = 5,
    serif_style: int = 12,  # panose: 12 normal sans, 3 cove (serif)
    family_type: int = 2,
    mono: bool = False,
    italic: bool = False,
    license_text: str | None = "SIL Open Font License 1.1",
    license_url: str | None = "https://openfontlicense.org",
) -> Path:
    names = [".notdef"] + [f"g{ord(c)}" for c in CHARS]
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({ord(c): f"g{ord(c)}" for c in CHARS})

    glyphs, metrics = {}, {}
    stem = 40 + weight // 20  # heavier weights draw thicker rectangles
    for name in names:
        ch = None if name == ".notdef" else chr(int(name[1:]))
        advance = 500 if ch is None else glyph_advance(ch, mono)
        pen = TTGlyphPen(None)
        if ch is None or ch != " ":
            left, right = 60, advance - 60
            pen.moveTo((left, 0))
            pen.lineTo((left, 700))
            pen.lineTo((right, 700))
            pen.lineTo((right, 700 - stem))
            pen.lineTo((left + stem, 700 - stem))
            pen.lineTo((left + stem, 0))
            pen.closePath()
        glyphs[name] = pen.glyph()
        metrics[name] = (advance, 60)

    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    strings = {"familyName": family, "styleName": style}
    if license_text:
        strings["licenseDescription"] = license_text
    if license_url:
        strings["licenseInfoURL"] = license_url
    fb.setupNameTable(strings)
    fb.setupOS2(usWeightClass=weight, usWidthClass=width, sTypoAscender=800, sTypoDescender=-200, sTypoLineGap=0, usWinAscent=800, usWinDescent=200, fsSelection=0x01 if italic else 0x40)
    fb.font["head"].macStyle = (0x02 if italic else 0) | (0x01 if weight >= 700 else 0)
    os2 = fb.font["OS/2"]
    os2.panose.bFamilyType = family_type
    os2.panose.bSerifStyle = serif_style
    fb.setupPost(isFixedPitch=1 if mono else 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(path))
    return path


def make_family_set(directory: Path) -> Path:
    """A small, varied library: sans in three weights, a serif, a mono, a condensed face."""
    make_font(directory / "TestSans-Regular.ttf", "Test Sans", "Regular", 400)
    make_font(directory / "TestSans-Bold.ttf", "Test Sans", "Bold", 700)
    make_font(directory / "TestSans-Black.ttf", "Test Sans", "Black", 900)
    make_font(directory / "TestSans-Italic.ttf", "Test Sans", "Italic", 400, italic=True)
    make_font(directory / "TestSerif-Regular.ttf", "Test Serif", "Regular", 400, serif_style=3)
    make_font(directory / "TestSerif-Bold.ttf", "Test Serif", "Bold", 700, serif_style=3)
    make_font(directory / "TestMono-Regular.ttf", "Test Mono", "Regular", 400, mono=True)
    make_font(directory / "TestCondensed-Bold.ttf", "Test Condensed", "Bold", 700, width=3)
    return directory

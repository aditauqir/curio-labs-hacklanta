"""The local font library.

Fonts are indexed by reading the font files themselves (name table, OS/2, post,
fvar), so family, weight, width, category and licence come from the font and not
from guesses about its file name. A ``fonts.json`` sidecar in any scanned
directory can override category and licence where the font file is silent or
wrong. Categories are only used for fallbacks; no specific font is baked in.
"""

from __future__ import annotations

import json
import logging
import os
import struct
import sys
from dataclasses import dataclass, field, replace
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from fontTools.ttLib import TTCollection, TTFont, TTLibError
from PIL import ImageFont

# Many system fonts carry implausible 'created' timestamps; fontTools logs a
# warning for each one on every scan. It is not actionable here.
logging.getLogger("fontTools.ttLib.tables._h_e_a_d").setLevel(logging.ERROR)

FONT_SUFFIXES = {".ttf", ".otf", ".ttc", ".otc"}
CATEGORIES = ("sans-serif", "serif", "display", "monospace", "script", "symbol")

WIDTH_NAMES = {1: "ultra-condensed", 2: "extra-condensed", 3: "condensed", 4: "semi-condensed", 5: "normal", 6: "semi-expanded", 7: "expanded", 8: "extra-expanded", 9: "ultra-expanded"}


@dataclass(frozen=True)
class FontFace:
    path: Path
    index: int  # face index inside a .ttc collection; 0 otherwise
    family: str
    style: str
    weight: int  # 100 to 900
    width: int  # OS/2 usWidthClass, 1 to 9
    italic: bool
    category: str
    license: str | None
    license_url: str | None
    variable: bool
    postscript_name: str | None = None
    weight_range: tuple[int, int] | None = None  # for variable fonts

    @property
    def width_name(self) -> str:
        return WIDTH_NAMES.get(self.width, "normal")

    @property
    def full_name(self) -> str:
        return f"{self.family} {self.style}".strip()

    def sort_key(self) -> tuple:
        return (self.family.lower(), self.weight, self.width, self.italic, str(self.path), self.index)


class NoFontsError(LookupError):
    """Raised when a lookup needs fonts but the library is empty."""


@dataclass(frozen=True)
class IndexIssue:
    path: Path
    message: str


def _name(font: TTFont, *ids: int) -> str | None:
    table = font["name"] if "name" in font else None
    if table is None:
        return None
    for name_id in ids:
        record = table.getName(name_id, 3, 1, 0x409) or table.getName(name_id, 1, 0, 0) or table.getName(name_id, 3, 10, 0x409)
        if record is not None:
            value = record.toUnicode().strip()
            if value:
                return value
    for name_id in ids:
        for record in table.names:
            if record.nameID == name_id:
                try:
                    value = record.toUnicode().strip()
                except UnicodeDecodeError:
                    continue
                if value:
                    return value
    return None


_SERIF_WORDS = ("serif", "roman", "garamond", "times", "georgia", "playfair", "didot", "bodoni", "baskerville", "caslon", "merriweather", "lora", "palatino", "cambria", "minion", "book")
_SANS_WORDS = ("sans", "gothic", "grotesk", "helvet", "arial", "inter", "roboto", "futura", "avenir", "verdana", "tahoma")
_SCRIPT_WORDS = ("script", "hand", "brush", "calligra", "cursive", "signature")
_DISPLAY_WORDS = ("display", "poster", "headline", "stencil", "decorative", "impact", "outline", "shadow", "inline")
_MONO_WORDS = ("mono", "code", "courier", "consolas", "typewriter")


def guess_category(font: TTFont, family: str, weight: int, width: int) -> str:
    """Category from the font's own metrics first, then its name."""
    post = font["post"] if "post" in font else None
    if post is not None and getattr(post, "isFixedPitch", 0):
        return "monospace"

    lowered = family.lower()
    os2 = font["OS/2"] if "OS/2" in font else None
    panose = getattr(os2, "panose", None)
    family_type = getattr(panose, "bFamilyType", 0) if panose else 0
    serif_style = getattr(panose, "bSerifStyle", 0) if panose else 0

    if family_type == 3:
        return "script"
    if family_type == 4:
        return "display"
    if family_type == 5:
        return "symbol"

    if any(word in lowered for word in _MONO_WORDS):
        return "monospace"
    if any(word in lowered for word in _SCRIPT_WORDS):
        return "script"
    if any(word in lowered for word in _DISPLAY_WORDS):
        return "display"

    if family_type == 2:
        if 11 <= serif_style <= 16:
            return "sans-serif"
        if 3 <= serif_style <= 10:
            return "serif"

    if any(word in lowered for word in _SANS_WORDS) and "serif" not in lowered.replace("sans serif", "").replace("sans-serif", ""):
        return "sans-serif"
    if any(word in lowered for word in _SERIF_WORDS):
        return "serif"
    return "sans-serif"


def read_face(path: Path, index: int, font: TTFont) -> FontFace:
    family = _name(font, 16, 1) or path.stem
    style = _name(font, 17, 2) or "Regular"
    os2 = font["OS/2"] if "OS/2" in font else None

    weight = snap_weight(getattr(os2, "usWeightClass", 400) or 400)
    width = int(getattr(os2, "usWidthClass", 5) or 5)
    width = min(max(width, 1), 9)

    selection = int(getattr(os2, "fsSelection", 0) or 0)
    mac_style = int(getattr(font["head"], "macStyle", 0)) if "head" in font else 0
    italic = bool(selection & 0x01) or bool(mac_style & 0x02) or "italic" in style.lower() or "oblique" in style.lower()

    variable = "fvar" in font
    weight_range = None
    if variable:
        for axis in font["fvar"].axes:
            if axis.axisTag == "wght":
                weight_range = (int(axis.minValue), int(axis.maxValue))

    return FontFace(
        path=path,
        index=index,
        family=family,
        style=style,
        weight=weight,
        width=width,
        italic=italic,
        category=guess_category(font, family, weight, width),
        license=_name(font, 13),
        license_url=_name(font, 14),
        variable=variable,
        postscript_name=_name(font, 6),
        weight_range=weight_range,
    )


def _sidecar(directory: Path) -> dict[str, dict[str, str]]:
    meta = directory / "fonts.json"
    if not meta.is_file():
        return {}
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {str(key).lower(): value for key, value in data.items() if isinstance(value, dict)} if isinstance(data, dict) else {}


def default_font_dirs() -> list[Path]:
    """Operating-system font folders, plus any in ``CURIO_FONT_DIRS``."""
    dirs: list[Path] = []
    extra = os.environ.get("CURIO_FONT_DIRS")
    if extra:
        dirs.extend(Path(p) for p in extra.split(os.pathsep) if p)
    if sys.platform == "win32":
        dirs.append(Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts")
        local = os.environ.get("LOCALAPPDATA")
        if local:
            dirs.append(Path(local) / "Microsoft" / "Windows" / "Fonts")
    elif sys.platform == "darwin":
        dirs += [Path("/System/Library/Fonts"), Path("/Library/Fonts"), Path.home() / "Library" / "Fonts"]
    else:
        dirs += [Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), Path.home() / ".fonts", Path.home() / ".local" / "share" / "fonts"]
    return [d for d in dirs if d.is_dir()]


@dataclass
class FontLibrary:
    """An index of font faces with lookup by family, category and weight."""

    faces: list[FontFace] = field(default_factory=list)
    issues: list[IndexIssue] = field(default_factory=list)
    category_defaults: dict[str, list[str]] = field(default_factory=dict)

    @classmethod
    def from_directories(cls, directories: Iterable[str | Path], **kwargs) -> "FontLibrary":
        library = cls(**kwargs)
        for directory in directories:
            library.add_directory(directory)
        return library

    @classmethod
    def from_system(cls, **kwargs) -> "FontLibrary":
        return cls.from_directories(default_font_dirs(), **kwargs)

    # ------------------------------------------------------------- indexing

    def add_directory(self, directory: str | Path) -> int:
        """Indexes every font under ``directory``. Returns the number of faces added."""
        root = Path(directory)
        before = len(self.faces)
        if not root.is_dir():
            self.issues.append(IndexIssue(root, "not a directory"))
            return 0
        sidecars: dict[Path, dict] = {}
        for path in sorted(p for p in root.rglob("*") if p.suffix.lower() in FONT_SUFFIXES):
            self.add_file(path, sidecars.setdefault(path.parent, _sidecar(path.parent)))
        return len(self.faces) - before

    def add_file(self, path: str | Path, sidecar: dict | None = None) -> int:
        path = Path(path)
        sidecar = sidecar if sidecar is not None else _sidecar(path.parent)
        try:
            if path.suffix.lower() in (".ttc", ".otc"):
                fonts = list(TTCollection(str(path), lazy=True).fonts)
            else:
                fonts = [TTFont(str(path), lazy=True, fontNumber=0)]
        except (TTLibError, OSError, struct.error) as error:
            self.issues.append(IndexIssue(path, f"unreadable font: {error}"))
            return 0

        added = 0
        for index, font in enumerate(fonts):
            try:
                face = read_face(path, index, font)
            except Exception as error:  # a malformed table must not abort the scan
                self.issues.append(IndexIssue(path, f"could not read metadata: {error}"))
                continue
            override = sidecar.get(face.family.lower()) or sidecar.get(path.name.lower()) or {}
            if override.get("category") in CATEGORIES:
                face = _replace(face, category=override["category"])
            if isinstance(override.get("license"), str):
                face = _replace(face, license=override["license"])
            if face not in self.faces:
                self.faces.append(face)
                added += 1
        self.faces.sort(key=FontFace.sort_key)
        return added

    # --------------------------------------------------------------- lookup

    def __len__(self) -> int:
        return len(self.faces)

    def families(self) -> list[str]:
        return sorted({face.family for face in self.faces}, key=str.lower)

    def in_family(self, family: str) -> list[FontFace]:
        wanted = normalise(family)
        return [face for face in self.faces if normalise(face.family) == wanted]

    def by_category(self, category: str) -> list[FontFace]:
        return [face for face in self.faces if face.category == category]

    def nearest(
        self,
        candidates: list[FontFace],
        weight: int | None = None,
        width: int | None = None,
        italic: bool | None = None,
    ) -> FontFace | None:
        """The candidate closest to the requested weight, width and slant.

        Ties break on the font's own ordering so the choice is deterministic.
        """
        if not candidates:
            return None

        def distance(face: FontFace) -> tuple:
            if face.variable and face.weight_range and weight is not None:
                lo, hi = face.weight_range
                weight_gap = 0 if lo <= weight <= hi else min(abs(weight - lo), abs(weight - hi))
            else:
                weight_gap = abs(face.weight - weight) if weight is not None else 0
            width_gap = abs(face.width - width) if width is not None else 0
            slant_gap = 0 if italic is None else int(face.italic != italic)
            return (slant_gap, weight_gap + width_gap * 80, face.sort_key())

        return min(candidates, key=distance)

    def best_for(self, category: str | None, weight: int | None = None, width: int | None = None, italic: bool | None = None) -> FontFace | None:
        """Category default: a configured preferred family if present, else the nearest face in the category."""
        if category:
            for family in self.category_defaults.get(category, []):
                hit = self.nearest(self.in_family(family), weight, width, italic)
                if hit:
                    return hit
            hit = self.nearest(self.by_category(category), weight, width, italic)
            if hit:
                return hit
        return None


def _replace(face: FontFace, **changes) -> FontFace:
    return replace(face, **changes)


def normalise(name: str) -> str:
    """Lower-case alphanumerics only, so 'Playfair Display' == 'playfair-display'."""
    return "".join(ch for ch in name.lower() if ch.isalnum())


# ----------------------------------------------------------------- loading

_WEIGHT_WORDS = {
    "thin": 100, "hairline": 100, "extralight": 200, "ultralight": 200, "light": 300,
    "regular": 400, "normal": 400, "book": 400, "medium": 500, "semibold": 600, "demibold": 600,
    "bold": 700, "extrabold": 800, "ultrabold": 800, "heavy": 900, "black": 900, "ultra": 900,
}


def snap_weight(value: float) -> int:
    """Snaps to the nearest hundred in 100..900, rounding halves up (650 -> 700).

    Python's ``round`` rounds halves to even, which would send 650 down and 750 up.
    """
    return min(max(int(value // 100 + (1 if value % 100 >= 50 else 0)) * 100, 100), 900)


def parse_weight(value: object, default: int = 400) -> int:
    """Turns 'bold', 'extra bold', '700' or 700 into 100..900."""
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return snap_weight(value)
    if isinstance(value, str):
        key = normalise(value)
        if key.isdigit():
            return snap_weight(int(key))
        if key in _WEIGHT_WORDS:
            return _WEIGHT_WORDS[key]
    return default


@lru_cache(maxsize=256)
def _load(path: str, index: int, size: int, weight: int | None) -> ImageFont.FreeTypeFont:
    # BASIC layout keeps rendering identical on machines with and without Raqm.
    font = ImageFont.truetype(path, size, index=index, layout_engine=ImageFont.Layout.BASIC)
    if weight is not None:
        try:
            axes = font.get_variation_axes()
            values = []
            for axis in axes:
                name = axis["name"].decode() if isinstance(axis["name"], bytes) else str(axis["name"])
                if "weight" in name.lower():
                    values.append(min(max(weight, axis["minimum"]), axis["maximum"]))
                else:
                    values.append(axis["default"])
            font.set_variation_by_axes(values)
        except (OSError, AttributeError):
            pass  # a static font, or FreeType without variation support
    return font


def load_pil_font(face: FontFace, size_px: float, weight: int | None = None) -> ImageFont.FreeTypeFont:
    """Opens ``face`` at a pixel size. ``weight`` only applies to variable fonts."""
    return _load(str(face.path), face.index, max(int(round(size_px)), 1), weight if face.variable else None)

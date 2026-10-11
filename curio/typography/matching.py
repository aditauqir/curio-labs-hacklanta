"""Mapping a style's ``font_matches`` onto installed fonts.

The rule from the brief: try the listed fonts by descending confidence, then
fall back to a default for the role's category, then to anything installed. The
result records which step succeeded, so a design that quietly fell back is
visible in its recipe rather than looking like an exact match.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

from .library import FontFace, FontLibrary, NoFontsError, normalise, parse_weight

_STYLE_WORDS = (
    "extrabold", "ultrabold", "semibold", "demibold", "extralight", "ultralight",
    "hairline", "regular", "medium", "italic", "oblique", "heavy", "black", "light",
    "bold", "thin", "book", "normal", "condensed", "extended", "narrow", "wide",
)

FUZZY_THRESHOLD = 0.86


@dataclass
class FontMatch:
    face: FontFace
    #: exact_name | family | fuzzy | category_default | any_installed
    method: str
    requested: str | None = None
    confidence: float | None = None
    tried: list[str] = field(default_factory=list)

    @property
    def is_fallback(self) -> bool:
        return self.method in ("category_default", "any_installed")


def split_style(name: str) -> tuple[str, dict[str, Any]]:
    """Splits 'Helvetica Neue Bold Italic' into ('helveticaneue', {weight, italic, width})."""
    key = normalise(name)
    hints: dict[str, Any] = {}
    changed = True
    while changed:
        changed = False
        for word in _STYLE_WORDS:
            if key.endswith(word) and len(key) > len(word):
                key = key[: -len(word)]
                if word in ("italic", "oblique"):
                    hints["italic"] = True
                elif word in ("condensed", "narrow"):
                    hints["width"] = 3
                elif word in ("extended", "wide"):
                    hints["width"] = 7
                else:
                    hints.setdefault("weight", parse_weight(word))
                changed = True
    return key, hints


def resolve_font(
    font_matches: list[dict[str, Any]] | None,
    library: FontLibrary,
    *,
    category: str | None = None,
    weight: Any = None,
    width: int | None = None,
    italic: bool | None = None,
) -> FontMatch:
    """Picks the installed face for a role.

    ``weight``/``width``/``italic`` come from the role (for example a style's
    ``"weight": "black"``) and choose among the faces of the matched family.
    """
    if len(library) == 0:
        raise NoFontsError("the font library is empty; add a font directory first")

    wanted_weight = parse_weight(weight) if weight is not None else None
    tried: list[str] = []
    entries = sorted(
        (m for m in (font_matches or []) if isinstance(m, dict) and isinstance(m.get("name"), str) and m["name"].strip()),
        key=lambda m: -(float(m["confidence"]) if isinstance(m.get("confidence"), (int, float)) else 0.0),
    )

    for entry in entries:
        name = entry["name"].strip()
        confidence = float(entry["confidence"]) if isinstance(entry.get("confidence"), (int, float)) else None
        tried.append(name)

        family_key, hints = split_style(name)
        w = wanted_weight if wanted_weight is not None else hints.get("weight")
        it = italic if italic is not None else hints.get("italic")
        # A bare family name means its normal width: "Arial" is Arial, not Arial Narrow.
        wd = width if width is not None else hints.get("width", 5)

        # 1. The whole name is a family ("Playfair Display"), or a family + style.
        for key, method in ((normalise(name), "exact_name"), (family_key, "exact_name")):
            faces = library.faces if not key else [f for f in library.faces if normalise(f.family) == key]
            hit = library.nearest(faces, w, wd, it) if faces else None
            if hit:
                return FontMatch(hit, method, name, confidence, tried)

        # 2. A face whose full name matches ("Playfair Display Bold").
        full = [f for f in library.faces if normalise(f.full_name) == normalise(name) or (f.postscript_name and normalise(f.postscript_name) == normalise(name))]
        if full:
            return FontMatch(sorted(full, key=FontFace.sort_key)[0], "exact_name", name, confidence, tried)

        # 3. Close spelling, or one name containing the other.
        best: tuple[float, str] | None = None
        for family in library.families():
            fk = normalise(family)
            ratio = SequenceMatcher(None, family_key or normalise(name), fk).ratio()
            if (family_key and (fk.startswith(family_key) or family_key.startswith(fk)) and min(len(fk), len(family_key)) >= 4):
                ratio = max(ratio, FUZZY_THRESHOLD)
            if ratio >= FUZZY_THRESHOLD and (best is None or ratio > best[0] or (ratio == best[0] and family.lower() < best[1].lower())):
                best = (ratio, family)
        if best:
            hit = library.nearest(library.in_family(best[1]), w, wd, it)
            if hit:
                return FontMatch(hit, "fuzzy", name, confidence, tried)

    # 4. The role's category default, then anything at all.
    hit = library.best_for(category, wanted_weight, width, italic)
    if hit:
        return FontMatch(hit, "category_default", entries[0]["name"] if entries else None, None, tried)

    anything = library.nearest(library.faces, wanted_weight, width, italic)
    assert anything is not None
    return FontMatch(anything, "any_installed", entries[0]["name"] if entries else None, None, tried)

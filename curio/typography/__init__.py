"""Typography: font library, matching, text layout and rendering, legibility."""

from .legibility import LegibilityFix, LegibilityReport, check_legibility, fix_legibility
from .library import FontFace, FontLibrary, NoFontsError, default_font_dirs, load_pil_font, parse_weight
from .matching import FontMatch, resolve_font
from .text import (
    GroupItem,
    TextMetrics,
    TextRender,
    arc_path,
    fit_group,
    fit_text_size,
    measure_text,
    render_microtype_column,
    render_text,
    render_text_on_path,
    resolve_size_px,
)

__all__ = [
    "FontFace",
    "FontLibrary",
    "FontMatch",
    "GroupItem",
    "LegibilityFix",
    "LegibilityReport",
    "NoFontsError",
    "TextMetrics",
    "TextRender",
    "arc_path",
    "check_legibility",
    "default_font_dirs",
    "fit_group",
    "fit_text_size",
    "fix_legibility",
    "load_pil_font",
    "measure_text",
    "parse_weight",
    "render_microtype_column",
    "render_text",
    "render_text_on_path",
    "resolve_font",
    "resolve_size_px",
]

"""Pixel-length parameters and resolution independence.

Style data stores lengths (halftone pitch, blur radius, stroke width...) in pixels
at a fixed **reference size**: 1080 px on the short edge. A poster rendered at
another size scales those lengths by ``output_short_edge / 1080`` so the style
looks the same at 1080 px and at 4000 px. Without this, a 7.8 px halftone is a
fine screen on a small poster and an invisible one on a large print.

This module is the single list of which op parameters are lengths. A test fails
if an op adds a ``*_px`` parameter that is missing here.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from .registry import _REGISTRY

REFERENCE_SHORT_EDGE_PX = 1080

LENGTH_PARAMS: dict[str, tuple[str, ...]] = {
    "halftone_screen": ("pitch_px",),
    "grain": ("size",),
    "blur": ("radius",),
    "unsharp_mask": ("radius",),
    "ink_bleed": ("spread_px",),
    "distress": ("scale_px",),
    "halation": ("radius_px",),
    "scan_lines": ("spacing_px",),
    "misregistration": ("red", "green", "blue"),
    "stroke": ("width_px",),
    "drop_shadow": ("dx", "dy", "blur_px"),
    "feather": ("radius_px", "shrink_px"),
    "mask": ("feather_px",),
}


def _mark() -> None:
    for op_name, names in LENGTH_PARAMS.items():
        spec = _REGISTRY[op_name]
        for name in names:
            spec.params[name] = replace(spec.params[name], length=True)


_mark()


def scale_for(canvas_width: int, canvas_height: int) -> float:
    """The factor applied to reference-pixel lengths for a canvas of this size."""
    return min(canvas_width, canvas_height) / REFERENCE_SHORT_EDGE_PX


def scale_lengths(op_name: str, params: dict[str, Any], scale: float) -> dict[str, Any]:
    """Returns ``params`` with this op's length parameters multiplied by ``scale``."""
    names = LENGTH_PARAMS.get(op_name, ())
    out = dict(params)
    for name in names:
        value = out.get(name)
        if value is None:
            continue
        out[name] = [v * scale for v in value] if isinstance(value, (list, tuple)) else value * scale
    return out


def length_defaults_scaled(op_name: str, params: dict[str, Any], scale: float) -> dict[str, Any]:
    """Like :func:`scale_lengths`, but also scales the op's own default for any
    length parameter the caller did not set, so an unset pitch still follows the
    output size."""
    spec = _REGISTRY[op_name]
    merged = dict(params)
    for name in LENGTH_PARAMS.get(op_name, ()):
        if name not in merged:
            default = spec.params[name].default
            merged[name] = list(default) if isinstance(default, list) else default
    return scale_lengths(op_name, merged, scale)

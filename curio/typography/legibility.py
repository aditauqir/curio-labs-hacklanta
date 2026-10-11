"""The legibility guard: minimum contrast between type and what is behind it,
with an automatic fix when the check fails.

The fix order is the least visible change first: shift the type colour (keeping
its hue), then add an outline, then put a plate behind the type. Each step is
only taken if it actually reaches the target ratio, so the guard never reports
a fix that does not work.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from curio.core.color import contrast_ratio, lab_to_rgb, parse_hex, rgb_to_lab, to_hex

WCAG_BODY = 4.5
WCAG_LARGE = 3.0


@dataclass
class LegibilityReport:
    worst_ratio: float
    median_ratio: float
    required: float
    passes: bool


@dataclass
class LegibilityFix:
    #: none | color_shift | outline | plate | unfixable
    kind: str
    text_color: str
    outline_color: str | None = None
    outline_px: float = 0.0
    plate_color: str | None = None
    plate_opacity: float = 0.0
    ratio_after: float = 0.0
    note: str = ""


def _samples(background: np.ndarray | tuple[float, float, float] | str) -> np.ndarray:
    """Background pixels as an ``(N, 3)`` array, from a colour or an image region."""
    if isinstance(background, str):
        return np.array([parse_hex(background)], dtype=np.float32)
    arr = np.asarray(background, dtype=np.float32)
    if arr.ndim == 1:
        return arr[None, :3]
    return arr.reshape(-1, arr.shape[-1])[:, :3]


def check_legibility(text_color: str, background, required: float = WCAG_BODY) -> LegibilityReport:
    """Contrast of the type against a background colour or an image region.

    The *worst* ratio matters, not the mean: type that crosses a bright patch
    of an otherwise dark photo is unreadable at that spot. The 5th/95th
    percentile of the region stands in for its worst case so one stray pixel
    does not fail a design.
    """
    samples = _samples(background)
    text = np.array(parse_hex(text_color), dtype=np.float32)
    ratios = np.asarray(contrast_ratio(np.broadcast_to(text, samples.shape), samples), dtype=np.float32)
    worst = float(np.percentile(ratios, 5))
    median = float(np.percentile(ratios, 50))
    return LegibilityReport(worst, median, required, worst >= required)


def _shifted(text_color: str, lightness: float) -> str:
    lab = rgb_to_lab(np.array(parse_hex(text_color), dtype=np.float32))
    lab = np.array([lightness, lab[1], lab[2]], dtype=np.float32)
    return to_hex(lab_to_rgb(lab))


def fix_legibility(text_color: str, background, required: float = WCAG_BODY, size_px: float = 24.0) -> LegibilityFix:
    """Returns the smallest change that makes the type meet ``required`` contrast."""
    report = check_legibility(text_color, background, required)
    if report.passes:
        return LegibilityFix("none", text_color, ratio_after=report.worst_ratio, note="already legible")

    samples = _samples(background)
    bg_light = float(rgb_to_lab(samples.mean(axis=0))[0])
    original_l = float(rgb_to_lab(np.array(parse_hex(text_color), dtype=np.float32))[0])

    # 1. Move the lightness away from the background, keeping hue and chroma.
    direction = -1.0 if bg_light > 50.0 else 1.0
    for step in range(0, 101, 2):
        lightness = float(np.clip(original_l + direction * step, 0.0, 100.0))
        candidate = _shifted(text_color, lightness)
        trial = check_legibility(candidate, background, required)
        if trial.passes:
            return LegibilityFix("color_shift", candidate, ratio_after=trial.worst_ratio, note=f"lightness {original_l:.0f} -> {lightness:.0f}")
        if lightness in (0.0, 100.0):
            break

    # 2. An outline that separates the type from the background on its own.
    outline_px = max(1.0, round(size_px / 12.0, 1))
    for outline in ("#000000", "#FFFFFF"):
        text_vs_outline = float(contrast_ratio(parse_hex(text_color), parse_hex(outline)))
        outline_vs_bg = check_legibility(outline, background, required=WCAG_LARGE)
        if text_vs_outline >= required and outline_vs_bg.passes:
            return LegibilityFix("outline", text_color, outline, outline_px, ratio_after=text_vs_outline, note="outline separates the type from a busy background")

    # 3. A plate behind the type, in whichever of black/white contrasts the type most.
    plate = max(("#000000", "#FFFFFF"), key=lambda c: float(contrast_ratio(parse_hex(text_color), parse_hex(c))))
    ratio = float(contrast_ratio(parse_hex(text_color), parse_hex(plate)))
    if ratio >= required:
        return LegibilityFix("plate", text_color, plate_color=plate, plate_opacity=0.9, ratio_after=ratio, note="a plate sits behind the type")

    # 4. The type colour itself cannot be kept: use black or white type on the opposite plate.
    type_color, plate = ("#FFFFFF", "#000000") if original_l > 50.0 else ("#000000", "#FFFFFF")
    ratio = float(contrast_ratio(parse_hex(type_color), parse_hex(plate)))
    if ratio >= required:
        return LegibilityFix("plate", type_color, plate_color=plate, plate_opacity=0.9, ratio_after=ratio, note="type colour replaced and plated")

    return LegibilityFix("unfixable", text_color, ratio_after=report.worst_ratio, note="no automatic fix reaches the required contrast")

"""Text layout and rendering.

Text is drawn with real font outlines (FreeType via Pillow, BASIC layout so the
result does not depend on whether Raqm is installed). Glyphs are placed one by
one so tracking can be negative or fractional and per-pair kerning is kept.
Output is a straight-alpha RGBA image that drops into a layer.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import numpy as np
from PIL import Image as PILImage
from PIL import ImageDraw

from curio.core.blend import composite
from curio.core.color import parse_hex
from curio.core.image import Image, clip01
from curio.core.layers import Transform, place

from .library import FontFace, load_pil_font

CASES = ("none", "upper", "lower", "title")
ALIGNS = ("left", "center", "right")


@dataclass
class TextMetrics:
    width: int
    height: int
    lines: list[str]
    line_height: float
    ascent: float
    descent: float


@dataclass
class TextRender:
    image: Image  # RGBA float
    lines: list[str]
    size_px: int
    face: FontFace
    #: Row of the first baseline and column where text starts, valid when unrotated.
    baseline: float | None = None
    origin_x: float | None = None
    metrics: TextMetrics | None = None

    @property
    def width(self) -> int:
        return self.image.shape[1]

    @property
    def height(self) -> int:
        return self.image.shape[0]


def apply_case(text: str, case: str) -> str:
    if case == "upper":
        return text.upper()
    if case == "lower":
        return text.lower()
    if case == "title":
        return text.title()
    if case == "none":
        return text
    raise ValueError(f"case must be one of {CASES}, got {case!r}")


def _advances(font, line: str, tracking_px: float) -> list[float]:
    """Per-glyph advances including pair kerning and tracking."""
    out: list[float] = []
    for i, ch in enumerate(line):
        if i < len(line) - 1:
            advance = font.getlength(ch + line[i + 1]) - font.getlength(line[i + 1])
        else:
            advance = font.getlength(ch)
        out.append(advance + tracking_px)
    return out


def _line_width(font, line: str, tracking_px: float) -> float:
    if not line:
        return 0.0
    advances = _advances(font, line, tracking_px)
    # Tracking after the last glyph is not part of the visible line.
    return sum(advances) - tracking_px


def wrap_lines(text: str, font, tracking_px: float, max_width: float | None) -> list[str]:
    """Greedy word wrap. Explicit newlines always break; a word longer than the box stays whole."""
    out: list[str] = []
    for hard in text.split("\n"):
        if max_width is None or not hard.strip():
            out.append(hard)
            continue
        words, current = hard.split(), ""
        for word in words:
            trial = f"{current} {word}".strip()
            if current and _line_width(font, trial, tracking_px) > max_width:
                out.append(current)
                current = word
            else:
                current = trial
        out.append(current)
    return out


def measure_text(
    text: str,
    face: FontFace,
    size_px: float,
    *,
    tracking: float = 0.0,
    leading: float = 1.1,
    case: str = "none",
    max_width: float | None = None,
    weight: int | None = None,
) -> TextMetrics:
    """Size of the text block without drawing it. ``tracking`` is in em."""
    font = load_pil_font(face, size_px, weight)
    tracking_px = tracking * size_px
    lines = wrap_lines(apply_case(text, case), font, tracking_px, max_width)
    ascent, descent = font.getmetrics()
    width = max((_line_width(font, line, tracking_px) for line in lines), default=0.0)
    line_height = leading * size_px
    height = ascent + descent + max(len(lines) - 1, 0) * line_height
    return TextMetrics(int(math.ceil(width)), int(math.ceil(height)), lines, line_height, float(ascent), float(descent))


def render_text(
    text: str,
    face: FontFace,
    size_px: float,
    *,
    color: str = "#000000",
    tracking: float = 0.0,
    leading: float = 1.1,
    case: str = "none",
    align: str = "left",
    max_width: float | None = None,
    outline_px: float = 0.0,
    outline_color: str = "#000000",
    rotation_deg: float = 0.0,
    weight: int | None = None,
    hollow: bool = False,
) -> TextRender:
    """Renders text to a tight RGBA image.

    ``tracking`` and ``leading`` are in em and as a multiple of the size, as in
    a layout tool. Negative tracking is allowed for tight display type.

    ``hollow=True`` draws outline-only lettering: the interior is transparent and
    only a ring of ``outline_px`` around each glyph is drawn, in ``color``.
    """
    if hollow and outline_px <= 0:
        raise ValueError("hollow text needs outline_px greater than 0")
    if align not in ALIGNS:
        raise ValueError(f"align must be one of {ALIGNS}, got {align!r}")
    size = max(int(round(size_px)), 1)
    font = load_pil_font(face, size, weight)
    metrics = measure_text(text, face, size, tracking=tracking, leading=leading, case=case, max_width=max_width, weight=weight)
    tracking_px = tracking * size
    stroke = max(int(round(outline_px)), 0)

    pad = stroke + int(math.ceil(size * 0.15)) + 2
    block_width = max(metrics.width, int(max_width) if (max_width and align != "left") else 0)
    width, height = block_width + 2 * pad, metrics.height + 2 * pad
    fill_mask = PILImage.new("L", (width, height), 0)
    stroke_mask = PILImage.new("L", (width, height), 0) if stroke else None
    fill_draw = ImageDraw.Draw(fill_mask)
    stroke_draw = ImageDraw.Draw(stroke_mask) if stroke_mask is not None else None

    first_baseline = pad + metrics.ascent
    for row, line in enumerate(metrics.lines):
        line_w = _line_width(font, line, tracking_px)
        x = pad + {"left": 0.0, "center": (block_width - line_w) / 2.0, "right": block_width - line_w}[align]
        y = first_baseline + row * metrics.line_height
        for ch, advance in zip(line, _advances(font, line, tracking_px)):
            if not ch.isspace():
                fill_draw.text((x, y), ch, font=font, fill=255, anchor="ls")
                if stroke_draw is not None:
                    stroke_draw.text((x, y), ch, font=font, fill=255, anchor="ls", stroke_width=stroke)
            x += advance

    fill_a = np.asarray(fill_mask, dtype=np.float32) / 255.0
    rgb = np.empty((height, width, 3), dtype=np.float32)
    rgb[...] = parse_hex(color)
    alpha = fill_a
    if stroke_mask is not None:
        stroke_a = np.maximum(np.asarray(stroke_mask, dtype=np.float32) / 255.0, fill_a)
        if hollow:
            alpha = np.clip(stroke_a - fill_a, 0.0, 1.0)  # the ring only; rgb stays the text colour
        else:
            rgb = np.array(parse_hex(outline_color), np.float32) * (1.0 - fill_a[..., None]) + rgb * fill_a[..., None]
            alpha = stroke_a
    image = np.concatenate([rgb, alpha[..., None]], axis=2).astype(np.float32)

    baseline: float | None = first_baseline
    origin_x: float | None = float(pad)
    if rotation_deg % 360 != 0:
        from curio.ops import apply_op

        image = apply_op("rotate", image, {"angle_deg": float(np.clip(((rotation_deg + 180) % 360) - 180, -180, 180))})
        baseline = origin_x = None

    return TextRender(clip01(image), metrics.lines, size, face, baseline, origin_x, metrics)


def fit_text_size(
    text: str,
    face: FontFace,
    box_w: float,
    box_h: float,
    *,
    min_px: int = 4,
    max_px: int = 4000,
    wrap: bool = True,
    tracking: float = 0.0,
    leading: float = 1.1,
    case: str = "none",
    weight: int | None = None,
) -> int:
    """The largest pixel size at which the text fits inside the box.

    With ``wrap=False`` the text stays on its explicit lines and only width and
    height limit the size (a one-line headline filling a width, for example).
    Returns ``min_px`` if even that does not fit; the caller should check.
    """

    def fits(size: int) -> bool:
        m = measure_text(text, face, size, tracking=tracking, leading=leading, case=case, max_width=box_w if wrap else None, weight=weight)
        return m.width <= box_w and m.height <= box_h

    if not fits(min_px):
        return min_px
    lo, hi = min_px, max_px
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if fits(mid):
            lo = mid
        else:
            hi = mid - 1
    return lo


def resolve_size_px(size_rel: float, canvas_height_px: float) -> float:
    """Converts a style's ``size_rel`` to pixels.

    ASSUMPTION (see curio/OPEN_ITEMS.md): ``size_rel`` is the font size as a
    fraction of the canvas height. The style files do not define it yet, so this
    is the single place to change when they do.
    """
    if not size_rel or size_rel <= 0:
        raise ValueError("size_rel must be positive")
    return float(size_rel) * float(canvas_height_px)


@dataclass
class GroupItem:
    text: str
    face: FontFace
    size_rel: float
    tracking: float = 0.0
    leading: float = 1.1
    case: str = "none"
    weight: int | None = None
    wrap: bool = True


def fit_group(items: Sequence[GroupItem], box_w: float, box_h: float, *, gap_em: float = 0.35, max_scale: float = 4000.0) -> list[int]:
    """Sizes a stack of text items to fill a box while keeping their ratios.

    Each item's size is ``size_rel`` times one shared scale, so hierarchy from
    the preset survives auto-fitting. Returns pixel sizes in item order.
    """
    if not items:
        return []

    def sizes(scale: float) -> list[int]:
        return [max(int(round(item.size_rel * scale)), 1) for item in items]

    def fits(scale: float) -> bool:
        total = 0.0
        for item, size in zip(items, sizes(scale)):
            m = measure_text(item.text, item.face, size, tracking=item.tracking, leading=item.leading, case=item.case, max_width=box_w if item.wrap else None, weight=item.weight)
            if m.width > box_w:
                return False
            total += m.height + gap_em * size
        return total - gap_em * sizes(scale)[-1] <= box_h

    lo, hi = 1.0, max_scale
    if not fits(lo):
        return sizes(lo)
    for _ in range(40):
        mid = (lo + hi) / 2.0
        if fits(mid):
            lo = mid
        else:
            hi = mid
    return sizes(lo)


def render_microtype_column(
    lines: Iterable[str],
    face: FontFace,
    size_px: float,
    width_px: float,
    *,
    columns: int = 1,
    gutter_px: float | None = None,
    tracking: float = 0.08,
    leading: float = 1.3,
    case: str = "upper",
    color: str = "#000000",
    align: str = "left",
    weight: int | None = None,
    wrap: bool = False,
) -> TextRender:
    """Small set type in one or more columns: tracklists, credits, fine print.

    Lines are dealt into ``columns`` columns in reading order; ``width_px`` is
    the total width, split evenly around the gutter. Each input line stays on
    one line by default (a track title should not break mid-row); a line wider
    than its column then overflows, and ``wrap=True`` breaks it instead.
    """
    items = [line for line in lines if isinstance(line, str)]
    columns = max(int(columns), 1)
    gutter = float(gutter_px if gutter_px is not None else size_px * 1.5)
    column_width = (width_px - gutter * (columns - 1)) / columns
    if column_width <= 0:
        raise ValueError("columns and gutter leave no width for text")

    per_column = max(math.ceil(len(items) / columns), 1)
    renders = [
        render_text(
            "\n".join(items[i * per_column : (i + 1) * per_column]),
            face,
            size_px,
            color=color,
            tracking=tracking,
            leading=leading,
            case=case,
            align=align,
            max_width=column_width if (wrap or align != "left") else None,
            weight=weight,
        )
        for i in range(columns)
    ]
    height = max(r.height for r in renders)
    pad_x = renders[0].origin_x or 0.0
    total_w = int(round(sum(column_width for _ in renders) + gutter * (columns - 1) + 2 * pad_x))
    canvas = np.zeros((height, total_w, 4), dtype=np.float32)
    for i, render in enumerate(renders):
        x0 = int(round(i * (column_width + gutter)))
        w = min(render.width, total_w - x0)
        canvas[: render.height, x0 : x0 + w] = render.image[:, :w]
    first = renders[0]
    return TextRender(canvas, [line for r in renders for line in r.lines], first.size_px, face, first.baseline, first.origin_x, first.metrics)


# ----------------------------------------------------------------- on a path


def arc_path(cx: float, cy: float, radius: float, start_deg: float, end_deg: float, steps: int = 96) -> list[tuple[float, float]]:
    """Points along a circular arc; angles are clockwise from 3 o'clock (screen space)."""
    angles = np.radians(np.linspace(start_deg, end_deg, steps))
    return [(cx + radius * math.cos(a), cy + radius * math.sin(a)) for a in angles]


def render_text_on_path(
    text: str,
    face: FontFace,
    size_px: float,
    path: Sequence[tuple[float, float]],
    canvas_size: tuple[int, int],
    *,
    color: str = "#000000",
    tracking: float = 0.0,
    start: float = 0.0,
    case: str = "none",
    weight: int | None = None,
) -> Image:
    """Draws text along a polyline and returns a canvas-sized RGBA image.

    Each glyph is rotated to the path tangent with its baseline on the path.
    ``start`` is the distance along the path where the text begins. Glyphs that
    would run past the end of the path are not drawn.
    """
    if len(path) < 2:
        raise ValueError("a path needs at least two points")
    size = max(int(round(size_px)), 1)
    font = load_pil_font(face, size, weight)
    text = apply_case(text, case)
    points = np.asarray(path, dtype=np.float64)
    segment = np.hypot(*np.diff(points, axis=0).T)
    cumulative = np.concatenate([[0.0], np.cumsum(segment)])
    total = float(cumulative[-1])

    canvas = np.zeros((canvas_size[1], canvas_size[0], 4), dtype=np.float32)
    distance = float(start)
    for ch, advance in zip(text, _advances(font, text, tracking * size)):
        centre = distance + (advance - tracking * size) / 2.0
        distance += advance
        if ch.isspace():
            continue
        if centre < 0 or centre > total:
            continue
        index = int(np.clip(np.searchsorted(cumulative, centre, side="right") - 1, 0, len(segment) - 1))
        t = (centre - cumulative[index]) / max(segment[index], 1e-9)
        x, y = points[index] + (points[index + 1] - points[index]) * t
        angle = math.degrees(math.atan2(points[index + 1][1] - points[index][1], points[index + 1][0] - points[index][0]))

        glyph = render_text(ch, face, size, color=color, weight=weight)
        placed = place(glyph.image, canvas_size, Transform(x=float(x), y=float(y), rotation_deg=angle, anchor=(0.5, (glyph.baseline or 0.0) / glyph.height)))
        canvas = composite(canvas, placed)
    return canvas

"""Placing a layout's regions on a canvas of a given size.

Regions are fractions of the canvas. The engine turns them into pixel boxes,
applies any tuning the director asked for (always clamped to the region's own
bounds), enforces photo aspect ratios, and drops optional text regions that have
no content. It never invents content: a required slot with nothing in it is an
error, not a placeholder.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from .schema import Layout, Region


class PlacementError(ValueError):
    """Raised when a layout cannot be placed with the content supplied."""


@dataclass
class PlacedRegion:
    region: Region
    x: float
    y: float
    w: float
    h: float
    content: Any = None

    @property
    def box(self) -> tuple[float, float, float, float]:
        return (self.x, self.y, self.w, self.h)


@dataclass
class Placement:
    canvas: tuple[int, int]
    regions: list[PlacedRegion]
    dropped: list[str] = field(default_factory=list)
    log: list[str] = field(default_factory=list)

    def get(self, region_id: str) -> PlacedRegion:
        for placed in self.regions:
            if placed.region.id == region_id:
                return placed
        raise KeyError(region_id)

    def by_role(self, role: str) -> list[PlacedRegion]:
        return [p for p in self.regions if p.region.role == role]


def canvas_size(aspect: str, short_edge: int = 1080) -> tuple[int, int]:
    """``"4:5"`` (width:height) at a given short edge, as ``(width, height)`` pixels."""
    try:
        a, b = (float(part) for part in aspect.split(":"))
    except (ValueError, AttributeError) as error:
        raise ValueError(f"aspect must look like '4:5', got {aspect!r}") from error
    if a <= 0 or b <= 0:
        raise ValueError(f"aspect must be positive, got {aspect!r}")
    if a <= b:
        return short_edge, int(round(short_edge * b / a))
    return int(round(short_edge * a / b)), short_edge


def has_content(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple)):
        return any(has_content(v) for v in value)
    return True


def place(
    layout: Layout,
    width: int,
    height: int,
    content: Mapping[str, Any] | None = None,
    tuning: Mapping[str, float] | None = None,
    has_photo: bool = True,
) -> Placement:
    """Resolves ``layout`` into pixel boxes.

    ``tuning`` maps ``"<region id>.<x|y|w|h>"`` to a fraction of the canvas. Values
    outside a region's declared bounds are clamped and the clamp is logged.
    """
    content = content or {}
    tuning = dict(tuning or {})
    log: list[str] = []
    known = {f"{r.id}.{axis}" for r in layout.regions for axis in "xywh"}
    for key in sorted(set(tuning) - known):
        log.append(f"ignored tuning {key!r}: no such region parameter")

    placed: list[PlacedRegion] = []
    dropped: list[str] = []

    for region in sorted(layout.regions, key=lambda r: r.z):
        if region.role == "photo" and not has_photo:
            raise PlacementError(f"layout {layout.layout_id!r} has a photo region ({region.id!r}) but no photo was supplied")

        value = None
        if region.role == "type":
            value = content.get(region.content)
            if not has_content(value):
                if region.optional:
                    dropped.append(region.id)
                    log.append(f"dropped optional region {region.id!r}: no content for slot {region.content!r}")
                    continue
                raise PlacementError(f"required slot {region.content!r} (region {region.id!r}) has no content")

        frac: dict[str, float] = {}
        for axis in "xywh":
            bounds = getattr(region, axis)
            wanted = tuning.get(f"{region.id}.{axis}")
            if wanted is None:
                frac[axis] = bounds.default
                continue
            frac[axis] = bounds.clamp(float(wanted))
            if frac[axis] != float(wanted):
                log.append(f"clamped {region.id}.{axis}: {float(wanted):g} -> {frac[axis]:g} (bounds {bounds.lo:g}..{bounds.hi:g})")

        x, y, w, h = frac["x"] * width, frac["y"] * height, frac["w"] * width, frac["h"] * height

        # Fractions of a different canvas shape distort a region. A stated aspect
        # ratio is the real constraint, so keep the width and recompute the height.
        if region.aspect_ratio is not None and w > 0:
            ratio = min(max(w / h if h > 0 else region.aspect_ratio.default, region.aspect_ratio.lo), region.aspect_ratio.hi)
            h = w / ratio

        placed.append(PlacedRegion(region, x, y, w, h, value))

    return Placement((width, height), placed, dropped, log)

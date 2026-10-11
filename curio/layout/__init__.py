"""Layouts: regions as fractions of the canvas, and the engine that places content."""

from .engine import PlacedRegion, Placement, PlacementError, canvas_size, has_content, place
from .schema import (
    ALIGNMENTS,
    EDGES,
    REGION_ROLES,
    REQUIRED_SLOTS,
    SLOT_ROLES,
    Bounds,
    Layout,
    LayoutError,
    Region,
    parse_bounds,
    parse_layout,
)

__all__ = [
    "ALIGNMENTS",
    "Bounds",
    "EDGES",
    "Layout",
    "LayoutError",
    "PlacedRegion",
    "Placement",
    "PlacementError",
    "REGION_ROLES",
    "canvas_size",
    "has_content",
    "place",
    "REQUIRED_SLOTS",
    "Region",
    "SLOT_ROLES",
    "parse_bounds",
    "parse_layout",
]

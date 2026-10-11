"""The compiled layout: regions positioned as fractions of the canvas.

A layout says *where* things go and how much room each has to move; it says
nothing about colours, fonts or photo treatment (those belong to the style
family). Each coordinate is a :class:`Bounds`: a default plus the range the
director may tune it within. Layouts are shared data, referenced by templates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

SLOT_ROLES = ("kicker", "headline", "subhead", "body", "tracklist", "credits", "date", "venue", "url", "logo", "caption", "price")
REGION_ROLES = ("photo", "solid", "type", "frame", "rule", "texture")
EDGES = ("top", "right", "bottom", "left")
ALIGNMENTS = ("left", "center", "right")

#: Slots a poster cannot do without. Everything else collapses when it has no content.
REQUIRED_SLOTS = ("headline", "photo")


@dataclass(frozen=True)
class Bounds:
    lo: float
    hi: float
    default: float

    def clamp(self, value: float) -> float:
        return min(max(value, self.lo), self.hi)

    def to_dict(self) -> dict[str, float]:
        return {"lo": self.lo, "hi": self.hi, "default": self.default}

    @classmethod
    def fixed(cls, value: float) -> "Bounds":
        return cls(value, value, value)


@dataclass(frozen=True)
class Region:
    id: str
    role: str
    content: str  # slot role for type regions, "photo" for photos, a hex colour for solid regions
    x: Bounds
    y: Bounds
    w: Bounds
    h: Bounds
    z: int = 0
    bleed: tuple[str, ...] = ()
    aspect_ratio: Bounds | None = None
    frame: dict[str, Any] | None = None
    optional: bool = False

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "x": self.x.to_dict(),
            "y": self.y.to_dict(),
            "w": self.w.to_dict(),
            "h": self.h.to_dict(),
            "z": self.z,
            "bleed": list(self.bleed),
            "optional": self.optional,
        }
        if self.aspect_ratio is not None:
            out["aspect_ratio"] = self.aspect_ratio.to_dict()
        if self.frame is not None:
            out["frame"] = self.frame
        return out


@dataclass(frozen=True)
class Layout:
    layout_id: str
    cluster_id: str
    regions: tuple[Region, ...]
    alignment: str = "left"
    negative_space: Bounds | None = None
    aspects_seen: tuple[str, ...] = ()
    members: tuple[str, ...] = ()
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def slots(self) -> list[str]:
        """Content slots this layout can place, in z order."""
        return [r.content for r in sorted(self.regions, key=lambda r: r.z) if r.role == "type"]

    def region(self, region_id: str) -> Region:
        for region in self.regions:
            if region.id == region_id:
                return region
        raise KeyError(region_id)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "schema_version": "1.0",
            "layout_id": self.layout_id,
            "cluster_id": self.cluster_id,
            "alignment": self.alignment,
            "aspects_seen": list(self.aspects_seen),
            "members": list(self.members),
            "regions": [r.to_dict() for r in self.regions],
        }
        if self.negative_space is not None:
            out["negative_space"] = self.negative_space.to_dict()
        out.update(self.extra)
        return out


class LayoutError(ValueError):
    """Raised with a field path when a layout document is malformed."""


def _num(value: Any, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or abs(value) == float("inf"):
        raise LayoutError(f"{path}: must be a number, got {value!r}")
    return float(value)


def parse_bounds(raw: Any, path: str, lo_limit: float = -0.5, hi_limit: float = 1.5) -> Bounds:
    if not isinstance(raw, dict):
        raise LayoutError(f"{path}: must be an object with lo, hi, default")
    lo, hi, default = _num(raw.get("lo"), f"{path}.lo"), _num(raw.get("hi"), f"{path}.hi"), _num(raw.get("default"), f"{path}.default")
    if not lo <= default <= hi:
        raise LayoutError(f"{path}: needs lo <= default <= hi, got {lo}, {default}, {hi}")
    if lo < lo_limit or hi > hi_limit:
        raise LayoutError(f"{path}: {lo}..{hi} is outside {lo_limit}..{hi_limit}")
    return Bounds(lo, hi, default)


def parse_layout(raw: Any) -> Layout:
    """Validates a compiled layout document. Raises :class:`LayoutError` with the field path."""
    if not isinstance(raw, dict):
        raise LayoutError("(root): a layout must be an object")
    layout_id, cluster_id = raw.get("layout_id"), raw.get("cluster_id")
    if not isinstance(layout_id, str) or not layout_id:
        raise LayoutError("layout_id: required text")
    if not isinstance(cluster_id, str) or not cluster_id:
        raise LayoutError("cluster_id: required text")
    alignment = raw.get("alignment", "left")
    if alignment not in ALIGNMENTS:
        raise LayoutError(f"alignment: must be one of {ALIGNMENTS}")

    regions_raw = raw.get("regions")
    if not isinstance(regions_raw, list) or not regions_raw:
        raise LayoutError("regions: needs at least one region")

    seen: set[str] = set()
    regions: list[Region] = []
    for i, r in enumerate(regions_raw):
        p = f"regions[{i}]"
        if not isinstance(r, dict):
            raise LayoutError(f"{p}: must be an object")
        rid = r.get("id")
        if not isinstance(rid, str) or not rid:
            raise LayoutError(f"{p}.id: required text")
        if rid in seen:
            raise LayoutError(f"{p}.id: duplicate region id {rid!r}")
        seen.add(rid)
        role = r.get("role")
        if role not in REGION_ROLES:
            raise LayoutError(f"{p}.role: must be one of {REGION_ROLES}")
        content = r.get("content", "")
        if not isinstance(content, str):
            raise LayoutError(f"{p}.content: must be text")
        if role == "type" and content not in SLOT_ROLES:
            raise LayoutError(f"{p}.content: a type region needs a slot role from {SLOT_ROLES}, got {content!r}")
        bleed = r.get("bleed", [])
        if not isinstance(bleed, list) or any(e not in EDGES for e in bleed):
            raise LayoutError(f"{p}.bleed: must be a list of {EDGES}")
        x, y = parse_bounds(r.get("x"), f"{p}.x"), parse_bounds(r.get("y"), f"{p}.y")
        w, h = parse_bounds(r.get("w"), f"{p}.w", 0.0, 1.5), parse_bounds(r.get("h"), f"{p}.h", 0.0, 1.5)
        if x.default + w.default > 1.0 + 1e-6 and "right" not in bleed:
            raise LayoutError(f"{p}: x + w = {x.default + w.default:.3f} runs off the right edge without a right bleed")
        if y.default + h.default > 1.0 + 1e-6 and "bottom" not in bleed:
            raise LayoutError(f"{p}: y + h = {y.default + h.default:.3f} runs off the bottom edge without a bottom bleed")
        aspect = parse_bounds(r["aspect_ratio"], f"{p}.aspect_ratio", 0.05, 20.0) if r.get("aspect_ratio") is not None else None
        z = r.get("z", 0)
        if isinstance(z, bool) or not isinstance(z, int):
            raise LayoutError(f"{p}.z: must be a whole number")
        frame = r.get("frame")
        if frame is not None and not isinstance(frame, dict):
            raise LayoutError(f"{p}.frame: must be an object")
        regions.append(Region(rid, role, content, x, y, w, h, z, tuple(bleed), aspect, frame, bool(r.get("optional", False))))

    negative = parse_bounds(raw["negative_space"], "negative_space", 0.0, 1.0) if raw.get("negative_space") is not None else None
    known = {"schema_version", "layout_id", "cluster_id", "alignment", "regions", "negative_space", "aspects_seen", "members"}
    return Layout(
        layout_id=layout_id,
        cluster_id=cluster_id,
        regions=tuple(regions),
        alignment=alignment,
        negative_space=negative,
        aspects_seen=tuple(raw.get("aspects_seen", [])),
        members=tuple(raw.get("members", [])),
        extra={k: v for k, v in raw.items() if k not in known},
    )

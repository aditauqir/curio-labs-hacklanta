"""Rendering a template into a poster: photo, regions, type, legibility, record.

The runner takes one compiled template (preset + layout + overrides), the user's
content and photo, and produces pixels plus a *record*: every value used, every
override that was clamped or rejected, every font fallback, every legibility fix
and every capability the style needed but the engine does not have. A poster
that quietly differs from its style is a bug; the record is where it shows.

ASSUMPTIONS (see curio/OPEN_ITEMS.md), kept in this file:

* Global texture layers sit directly above the ground, below every region, as in
  the recipes' ``layer_order`` (``paper, photo, type``).
* The text colour is the palette's ``text`` role, else ``ink``, else black. The
  ground is ``ground``, else ``background``, else ``paper``, else white.
* A style's ``size_rel`` is the *largest* size; type shrinks to fit its box.
* Type sits at the top of its box; alignment within the box follows the role's
  ``align``, else the layout's alignment.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from curio.core.color import is_hex, parse_hex
from curio.core.image import Image, split_alpha
from curio.core.layers import Layer, LayerStack, Transform, render
from curio.core.layers import place as place_image
from curio.core.seed import derive_seed, rng
from curio.core.stacks import OpCall, run_stack
from curio.core.textures import resolve_texture
from curio.layout import PlacedRegion, canvas_size, place
from curio.ops import apply_op
from curio.ops.units import length_defaults_scaled, scale_for
from curio.store import CompiledStyles
from curio.style_schema import Preset
from curio.typography import (
    FontLibrary,
    TextRender,
    fit_text_size,
    fix_legibility,
    measure_text,
    parse_weight,
    render_microtype_column,
    render_text,
    resolve_font,
    resolve_size_px,
)
from curio.typography.legibility import WCAG_BODY, WCAG_LARGE

#: Texture types with a procedural source. Anything else is reported, not faked.
PROCEDURAL_TEXTURES = {
    "paper": "procedural:paper",
    "grain": "procedural:grain",
    "scratches": "procedural:scratches",
    "fibers": "procedural:fibers",
}
MICROTYPE_SLOTS = ("tracklist", "credits")
MAX_COLUMNS = 4
#: Smallest type the runner will set, in pixels at the 1080 px reference size.
MIN_TYPE_PX = 9.0
#: WCAG "large text" is 18 pt, about 24 px on screen; scaled with the canvas.
LARGE_TYPE_PX = 24.0


@dataclass
class Photo:
    image: Image
    focus: tuple[float, float] = (0.5, 0.5)
    source: str | None = None
    license: str | None = None


@dataclass
class RenderRequest:
    template_id: str
    content: dict[str, Any] = field(default_factory=dict)
    photo: Photo | None = None
    aspect: str | None = None
    short_edge: int = 1080
    seed: int = 0
    overrides: dict[str, Any] = field(default_factory=dict)
    tuning: dict[str, float] = field(default_factory=dict)
    drop: list[str] = field(default_factory=list)


@dataclass
class RenderResult:
    image: Image  # RGB float
    record: dict[str, Any]
    #: The layers before flattening, and what each one is (see ``curio.render.pack``).
    stack: LayerStack | None = None
    elements: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def warnings(self) -> list[str]:
        return self.record["warnings"]


def palette_color(preset: Preset, *roles: str, default: str) -> str:
    """The first palette colour whose role is in ``roles``, in the order given."""
    entries = preset.data.get("palette") or []
    for role in roles:
        for entry in entries:
            if isinstance(entry, dict) and entry.get("role") == role and is_hex(entry.get("color")):
                return entry["color"].upper()
    return default


def _box(p: PlacedRegion) -> tuple[int, int, int, int]:
    x, y = int(round(p.x)), int(round(p.y))
    return x, y, max(int(round(p.x + p.w)) - x, 1), max(int(round(p.y + p.h)) - y, 1)


def _solid(w: int, h: int, color: str) -> Image:
    out = np.empty((h, w, 3), dtype=np.float32)
    out[...] = parse_hex(color)
    return out


def _ring(w: int, h: int, stroke: int, color: str) -> Image:
    out = np.zeros((h, w, 4), dtype=np.float32)
    out[..., :3] = parse_hex(color)
    s = max(min(stroke, w // 2, h // 2), 1)
    out[:s, :, 3] = out[-s:, :, 3] = out[:, :s, 3] = out[:, -s:, 3] = 1.0
    return out


def prepare_photo(photo: Photo, box_w: int, box_h: int, warnings: list[str]) -> Image:
    """Crops around the focus point to the box's aspect, then resizes to the box."""
    rgb, _ = split_alpha(photo.image.astype(np.float32)) if photo.image.ndim == 3 else (np.repeat(photo.image[..., None], 3, axis=2), None)
    aspect = float(np.clip(box_w / box_h, 0.1, 10.0))
    fx, fy = (float(np.clip(v, 0.0, 1.0)) for v in photo.focus)
    cropped = apply_op("crop", rgb, {"mode": "focus", "aspect": aspect, "focus_x": fx, "focus_y": fy})
    upscale = box_w / cropped.shape[1]
    if upscale > 1.0 + 1e-6:
        warnings.append(f"photo upscaled x{upscale:.2f}: the crop is {cropped.shape[1]}x{cropped.shape[0]} px for a {box_w}x{box_h} px box; detail will be soft")
    return apply_op("resize", cropped, {"width": box_w, "height": box_h, "fit": "stretch"})


def treatment_calls(preset_steps, scale: float, warnings: list[str]) -> list[OpCall]:
    """The preset's photo steps with lengths scaled to the output size."""
    calls = []
    for step in preset_steps:
        if not step.enabled:
            continue
        if step.op == "cutout":
            warnings.append(f"step {step.id!r} (cutout) skipped: subject isolation is open item 1 and no matte was supplied")
            continue
        calls.append(OpCall(op=step.op, params=length_defaults_scaled(step.op, step.params, scale), seed=step.seed, id=step.id))
    return calls


@dataclass
class _Type:
    render: TextRender
    transform: Transform


def _fits_columns(lines: list[str], face, size: int, box_w: float, box_h: float, columns: int, tracking: float, leading: float, case: str) -> bool:
    gutter = size * 1.5
    column_w = (box_w - gutter * (columns - 1)) / columns
    if column_w <= 0:
        return False
    per = max(math.ceil(len(lines) / columns), 1)
    for i in range(columns):
        chunk = lines[i * per : (i + 1) * per]
        if not chunk:
            continue
        m = measure_text("\n".join(chunk), face, size, tracking=tracking, leading=leading, case=case)
        if m.width > column_w or m.height > box_h:
            return False
    return True


def fit_microtype(lines: list[str], face, box_w: float, box_h: float, max_px: int, min_px: int, tracking: float, leading: float, case: str) -> tuple[int, int, bool]:
    """The (size, columns) pair with the largest size that fits; fewer columns win ties.

    Returns ``fits=False`` with the minimum size and one column when nothing fits.
    """
    best: tuple[int, int] | None = None
    for columns in range(1, min(MAX_COLUMNS, len(lines)) + 1):
        if not _fits_columns(lines, face, min_px, box_w, box_h, columns, tracking, leading, case):
            continue
        lo, hi = min_px, max(max_px, min_px)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if _fits_columns(lines, face, mid, box_w, box_h, columns, tracking, leading, case):
                lo = mid
            else:
                hi = mid - 1
        if best is None or lo > best[0]:
            best = (lo, columns)
    if best is None:
        return min_px, 1, False
    return best[0], best[1], True


def render_poster(request: RenderRequest, styles: CompiledStyles, fonts: FontLibrary) -> RenderResult:
    ref = styles.resolve(request.template_id)
    template, preset, layout = ref.template, ref.preset, ref.layout
    warnings: list[str] = []

    aspect = request.aspect or next(iter(template.get("aspects_seen") or layout.aspects_seen or ()), "4:5")
    width, height = canvas_size(aspect, request.short_edge)
    scale = scale_for(width, height)

    for need in template.get("unsupported_by_engine", []):
        warnings.append(f"the style needs {need!r}, which the engine does not do; rendered without it")

    overrides = {**template.get("overrides", {}), **request.overrides}
    resolved = preset.resolve(overrides, drop=request.drop)
    for event in resolved.log:
        if event.action == "rejected":
            warnings.append(f"override {event}")
    calls = treatment_calls(resolved.steps, scale, warnings)

    placement = place(layout, width, height, request.content, request.tuning, has_photo=request.photo is not None)

    ground = palette_color(preset, "ground", "background", "paper", default="#FFFFFF")
    ink = palette_color(preset, "ink", "text", "shadow", default="#000000")
    text_default = palette_color(preset, "text", "ink", default="#000000")
    roles = (preset.data.get("type_rules") or {}).get("roles") or {}

    stack = LayerStack()
    record_textures: list[dict[str, Any]] = []
    record_fonts: dict[str, Any] = {}
    record_legibility: dict[str, Any] = {}
    record_type: dict[str, Any] = {}
    elements: dict[str, dict[str, Any]] = {}  # layer name -> what it is, for the asset pack

    # Global textures, directly above the ground.
    for i, rule in enumerate((preset.data.get("texture_rules") or {}).get("layers") or []):
        kind = rule.get("type")
        probability = float(rule.get("probability", 1.0))
        roll = float(rng(request.seed, "texture", i, kind).random())
        if roll >= probability:
            record_textures.append({"type": kind, "applied": False, "reason": f"probability {probability:g}"})
            continue
        source = PROCEDURAL_TEXTURES.get(kind)
        if source is None:
            warnings.append(f"texture {kind!r} has no procedural source; skipped (scanned textures are not supported yet)")
            record_textures.append({"type": kind, "applied": False, "reason": "no procedural source"})
            continue
        opacity = rule.get("opacity", 1.0)
        opacity = float(opacity.get("default", 1.0)) if isinstance(opacity, dict) else float(opacity)
        blend = rule.get("blend", "normal")
        image = resolve_texture(source, (width, height), derive_seed(request.seed, "texture", i, kind))
        stack.add(Layer(f"texture:{i}:{kind}", image, blend=blend, opacity=opacity))
        elements[f"texture:{i}:{kind}"] = {"kind": "global_texture", "texture": kind}
        record_textures.append({"type": kind, "applied": True, "source": source, "blend": blend, "opacity": opacity})

    for placed in placement.regions:  # already in z order
        region = placed.region
        x, y, w, h = _box(placed)

        if region.role == "solid":
            color = region.content.upper() if is_hex(region.content) else palette_color(preset, region.content, default="")
            if not color:
                warnings.append(f"solid region {region.id!r}: {region.content!r} is neither a colour nor a palette role; skipped")
                continue
            stack.add(Layer(f"solid:{region.id}", _solid(w, h, color), transform=Transform(x, y)))
            elements[f"solid:{region.id}"] = {"kind": "rect", "role": "solid", "region": region.id, "box": [x, y, w, h], "fill": color}

        elif region.role == "rule":
            color = region.content.upper() if is_hex(region.content) else ink
            stack.add(Layer(f"rule:{region.id}", _solid(w, h, color), transform=Transform(x, y)))
            elements[f"rule:{region.id}"] = {"kind": "rect", "role": "rule", "region": region.id, "box": [x, y, w, h], "fill": color}

        elif region.role == "texture":
            source = PROCEDURAL_TEXTURES.get(region.content)
            if source is None:
                warnings.append(f"texture region {region.id!r}: {region.content!r} has no procedural source; skipped")
                continue
            image = resolve_texture(source, (w, h), derive_seed(request.seed, "region", region.id))
            stack.add(Layer(f"texture:{region.id}", image, blend="multiply", transform=Transform(x, y)))
            elements[f"texture:{region.id}"] = {"kind": "image", "role": "texture", "region": region.id, "texture": region.content}

        elif region.role in ("photo", "frame"):
            if region.role == "photo":
                assert request.photo is not None  # place() raised otherwise
                pixels = prepare_photo(request.photo, w, h, warnings)
                pixels = run_stack(pixels, calls, seed=derive_seed(request.seed, "photo", region.id))
                if pixels.shape[:2] != (h, w):
                    warnings.append(f"the treatment changed the photo size to {pixels.shape[1]}x{pixels.shape[0]}; fitted back to the box")
                    pixels = apply_op("resize", pixels, {"width": w, "height": h, "fit": "cover"})
                stack.add(Layer(f"photo:{region.id}", pixels, transform=Transform(x, y)))
                elements[f"photo:{region.id}"] = {
                    "kind": "image", "role": "photo", "region": region.id,
                    "treatment": [{"id": c.id, "op": c.op, "params": c.params} for c in calls],
                    "source": request.photo.source, "license": request.photo.license,
                }
            frame = region.frame or ({} if region.role == "frame" else None)
            if frame is not None:
                stroke = max(int(round(float(frame.get("stroke_frac_short_edge", 0.004)) * min(width, height))), 1)
                color = frame["color"].upper() if is_hex(frame.get("color")) else ink
                stack.add(Layer(f"frame:{region.id}", _ring(w, h, stroke, color), transform=Transform(x, y)))
                elements[f"frame:{region.id}"] = {"kind": "rect", "role": "frame", "region": region.id, "box": [x, y, w, h], "stroke": color, "stroke_px": stroke}

        elif region.role == "type":
            slot = region.content
            rule = roles.get(slot)
            if rule is None:
                warnings.append(f"no type rule for slot {slot!r} in preset {preset.id!r}; set in the default face, sized to its box")
                rule = {}
            match = resolve_font(rule.get("font_matches"), fonts, category=rule.get("category"), weight=rule.get("weight"), italic=rule.get("italic"))
            face = match.face
            if match.is_fallback:
                warnings.append(f"slot {slot!r}: none of {match.tried or ['(no fonts listed)']} is installed; fell back to {face.full_name} ({match.method})")
            record_fonts[region.id] = {"family": face.family, "style": face.style, "method": match.method, "requested": match.requested, "license": face.license}
            weight = parse_weight(rule["weight"]) if face.variable and rule.get("weight") is not None else None

            case = rule.get("case", "none")
            tracking = rule.get("tracking", 0.0)
            tracking = float(tracking.get("default", 0.0)) if isinstance(tracking, dict) else float(tracking)
            size_rel = rule.get("size_rel")
            size_rel = size_rel.get("default") if isinstance(size_rel, dict) else size_rel
            target = resolve_size_px(size_rel, height) if size_rel else float(h)
            min_px = max(int(round(MIN_TYPE_PX * scale)), 4)
            max_px = max(int(target), min_px)
            align = rule.get("align") or layout.alignment
            rotation = float(rule.get("rotation_deg", 0.0) or 0.0)
            outline = rule.get("outline") if isinstance(rule.get("outline"), dict) else None
            hollow = bool(outline and outline.get("fill") == "none")
            outline_px = float(outline.get("stroke_frac_short_edge", 0.001)) * min(width, height) if outline else 0.0
            outline_px = max(outline_px, 1.0) if outline else 0.0

            value = placed.content
            microtype = slot in MICROTYPE_SLOTS
            if microtype:
                lines = [str(v) for v in value] if isinstance(value, (list, tuple)) else str(value).splitlines()
                lines = [line for line in lines if line.strip()]
                size, columns, fits = fit_microtype(lines, face, w, h, max_px, min_px, tracking, 1.3, case)
            else:
                text = "\n".join(str(v) for v in value) if isinstance(value, (list, tuple)) else str(value)
                size = fit_text_size(text, face, w, h, min_px=min_px, max_px=max_px, tracking=tracking, case=case, weight=weight)
                m = measure_text(text, face, size, tracking=tracking, case=case, max_width=w, weight=weight)
                fits, columns = m.width <= w and m.height <= h, 1
            if not fits:
                warnings.append(f"slot {slot!r} does not fit region {region.id!r} even at {size} px; it overflows its box")

            def draw(color: str, extra_outline: float = 0.0, extra_color: str = "#000000") -> _Type:
                if microtype:
                    r = render_microtype_column(lines, face, size, w, columns=columns, tracking=tracking, leading=1.3, case=case, color=color, align=align, weight=weight)
                else:
                    r = render_text(
                        text, face, size, color=color, tracking=tracking, case=case, align=align, max_width=w, weight=weight,
                        outline_px=outline_px if hollow else extra_outline, outline_color=extra_color, hollow=hollow, rotation_deg=rotation,
                    )
                if r.origin_x is None:  # rotated: centre it on the box
                    return _Type(r, Transform(x + w / 2.0, y + h / 2.0, anchor=(0.5, 0.5)))
                return _Type(r, Transform(x - r.origin_x, y - r.origin_x))

            color = text_default
            typeset = draw(color)
            footprint = place_image(typeset.render.image, (width, height), typeset.transform)[..., 3]
            background = render(stack, width, height, background=ground, seed=request.seed)
            ink_mask = footprint > 0.5
            samples = background[ink_mask] if ink_mask.any() else background[max(y, 0) : y + h, max(x, 0) : x + w]
            required = WCAG_LARGE if size >= LARGE_TYPE_PX * scale else WCAG_BODY
            fix = fix_legibility(color, samples, required, size_px=size)

            if fix.kind == "outline" and hollow:
                # Hollow type has no fill to outline; a plate in the outline colour gives the same separation.
                fix.kind, fix.plate_color, fix.plate_opacity = "plate", fix.outline_color, 0.9
            if fix.kind == "color_shift":
                typeset = draw(fix.text_color)
            elif fix.kind == "outline":
                typeset = draw(fix.text_color, fix.outline_px, fix.outline_color or "#000000")
            elif fix.kind == "plate":
                typeset = draw(fix.text_color)
                alpha = place_image(typeset.render.image, (width, height), typeset.transform)[..., 3]
                ys, xs = np.nonzero(alpha > 0.05)
                if len(xs):
                    pad = int(round(size * 0.25))
                    x0, y0 = max(int(xs.min()) - pad, 0), max(int(ys.min()) - pad, 0)
                    x1, y1 = min(int(xs.max()) + pad + 1, width), min(int(ys.max()) + pad + 1, height)
                    stack.add(Layer(f"plate:{region.id}", _solid(x1 - x0, y1 - y0, fix.plate_color or "#000000"), opacity=fix.plate_opacity, transform=Transform(x0, y0)))
                    elements[f"plate:{region.id}"] = {
                        "kind": "rect", "role": "plate", "region": region.id, "box": [x0, y0, x1 - x0, y1 - y0],
                        "fill": fix.plate_color or "#000000", "opacity": fix.plate_opacity, "linked_to": f"type:{region.id}",
                    }
            elif fix.kind == "unfixable":
                warnings.append(f"slot {slot!r}: {fix.note} (contrast {fix.ratio_after:.2f}, needs {required:g})")
            record_legibility[region.id] = {
                "kind": fix.kind,
                "text_color": fix.text_color,
                "outline_color": fix.outline_color if fix.kind == "outline" else None,
                "plate_color": fix.plate_color if fix.kind == "plate" else None,
                "ratio_after": round(fix.ratio_after, 3),
                "required": required,
                "note": fix.note,
            }
            record_type[region.id] = {"slot": slot, "size_px": size, "columns": columns, "fits": fits, "align": align, "hollow": hollow}
            stack.add(Layer(f"type:{region.id}", typeset.render.image, transform=typeset.transform))
            # Hollow type is a ring in the text colour; otherwise only the legibility fix adds an outline.
            if hollow:
                text_outline = {"px": round(outline_px, 3), "color": fix.text_color}
            elif fix.kind == "outline":
                text_outline = {"px": round(float(fix.outline_px), 3), "color": fix.outline_color or "#000000"}
            else:
                text_outline = None
            elements[f"type:{region.id}"] = {
                "kind": "text", "role": "type", "region": region.id, "slot": slot, "box": [x, y, w, h],
                "text": lines if microtype else text, "case": case, "columns": columns,
                "font": {"family": face.family, "style": face.style, "weight": face.weight, "italic": face.italic, "file": face.path.name, "license": face.license},
                "size_px": size, "tracking_em": tracking, "leading": 1.3 if microtype else 1.1, "align": align,
                "color": fix.text_color, "hollow": hollow, "rotation_deg": rotation, "outline": text_outline,
                "fits": fits,
            }

    image = render(stack, width, height, background=ground, seed=request.seed)

    assets: list[dict[str, Any]] = []
    if request.photo is not None:
        if not request.photo.license:
            warnings.append("the photo has no licence recorded; it cannot be cleared for publication")
        assets.append({"kind": "photo", "source": request.photo.source, "license": request.photo.license})
    for region_id, font in sorted(record_fonts.items()):
        assets.append({"kind": "font", "region": region_id, "family": font["family"], "style": font["style"], "license": font["license"]})

    record = {
        "schema_version": "1.0",
        "template_id": template["template_id"],
        "preset_id": preset.id,
        "layout_id": layout.layout_id,
        "aspect": aspect,
        "canvas": [width, height],
        "seed": request.seed,
        "ground": ground,
        "overrides": overrides,
        "values": resolved.values,
        "tune_log": [str(e) for e in resolved.log],
        "steps": [{"id": c.id, "op": c.op, "params": c.params} for c in calls],
        "placement_log": list(placement.log),
        "dropped_regions": list(placement.dropped),
        "layers": stack.names,
        "textures": record_textures,
        "type": record_type,
        "fonts": record_fonts,
        "legibility": record_legibility,
        "assets_used": assets,
        "unsupported_by_engine": list(template.get("unsupported_by_engine", [])),
        "warnings": warnings,
    }
    return RenderResult(image, record, stack, elements)

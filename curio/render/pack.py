"""Asset packs: a rendered poster as separate, movable elements for a freeform editor.

``render_poster`` composites everything into one image. ``write_pack`` keeps the
pieces apart instead, so the website can let a user move, resize, recolour and
retype them:

    pack/
      manifest.json         what every element is and where it sits (format below)
      preview.png           the engine's own flattened render, for comparison
      record.json           the full render record (values, fixes, licences, warnings)
      layers/<id>.png       pixels for image elements and the background

The format is documented for frontend developers in ``curio/docs/ASSET_PACK_SPEC.md``.
Keep the two in step: bump ``PACK_VERSION`` on any breaking change.

Fidelity: composing the elements in order (``compose_pack``) reproduces
``preview.png`` up to 8-bit rounding. That holds because the runner places global
textures directly above the ground and below every region (OPEN_ITEMS A13), so
ground plus textures bake into one background image with no loss.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from curio.core.blend import composite
from curio.core.color import parse_hex
from curio.core.image import Image, load_image, save_image
from curio.core.layers import Layer, LayerStack, Transform, place, render

from .poster import RenderResult, _ring, _solid

PACK_FORMAT = "curio.asset_pack"
PACK_VERSION = "1.0"


def _element_id(layer_name: str) -> str:
    return layer_name.replace(":", "-")


def _top_left(layer: Layer) -> tuple[float, float]:
    t = layer.transform or Transform()
    if t.rotation_deg or t.scale_x != 1.0 or t.sy != 1.0:
        # The runner bakes rotation into the pixels and never scales; anything else
        # would need a transform in the manifest, which version 1.0 does not have.
        raise ValueError(f"layer {layer.name!r} has a scale or rotation transform; asset packs do not support that yet")
    h, w = layer.image.shape[:2]
    return t.x - t.anchor[0] * w, t.y - t.anchor[1] * h


def _num(value: float) -> float | int:
    rounded = round(float(value), 3)
    return int(rounded) if rounded == int(rounded) else rounded


def build_manifest(result: RenderResult) -> tuple[dict[str, Any], dict[str, Image]]:
    """The manifest and the images it refers to (published path -> pixels)."""
    if result.stack is None:
        raise ValueError("this result has no layer stack; render it with curio.render.render_poster")
    width, height = result.record["canvas"]
    ground = result.record["ground"]
    files: dict[str, Image] = {}

    textures = [layer for layer in result.stack if result.elements.get(layer.name, {}).get("kind") == "global_texture"]
    background_file = None
    if textures:
        background_file = "layers/background.png"
        files[background_file] = render(LayerStack(textures), width, height, background=ground, seed=result.record["seed"])

    elements: list[dict[str, Any]] = []
    for layer in result.stack:
        meta = result.elements.get(layer.name)
        if meta is None:
            raise ValueError(f"layer {layer.name!r} has no element description; the runner and the pack are out of step")
        kind = meta["kind"]
        if kind == "global_texture":
            continue
        element: dict[str, Any] = {
            "id": _element_id(layer.name),
            "kind": kind,
            "role": meta["role"],
            "region": meta["region"],
            "opacity": _num(layer.opacity),
            "blend": layer.blend,
        }
        if kind == "image":
            x, y = _top_left(layer)
            h, w = layer.image.shape[:2]
            path = f"layers/{element['id']}.png"
            files[path] = layer.image
            element.update(x=_num(x), y=_num(y), w=w, h=h, rotation_deg=0, file=path)
            for key in ("texture", "treatment", "source", "license"):
                if key in meta:
                    element[key] = meta[key]
        elif kind == "rect":
            x, y, w, h = meta["box"]
            element.update(x=x, y=y, w=w, h=h, rotation_deg=0)
            if "fill" in meta:
                element["fill"] = meta["fill"]
            if "stroke" in meta:
                element.update(stroke=meta["stroke"], stroke_px=meta["stroke_px"])
            if "linked_to" in meta:
                element["linked_to"] = _element_id(meta["linked_to"])
        elif kind == "text":
            x, y, w, h = meta["box"]
            rx, ry = _top_left(layer)
            rh, rw = layer.image.shape[:2]
            path = f"layers/{element['id']}.png"
            files[path] = layer.image
            element.update(x=x, y=y, w=w, h=h, rotation_deg=_num(meta["rotation_deg"]))
            for key in ("slot", "text", "case", "columns", "font", "size_px", "tracking_em", "leading", "align", "color", "hollow", "outline", "fits"):
                element[key] = meta[key]
            element["raster"] = {"file": path, "x": _num(rx), "y": _num(ry), "w": rw, "h": rh}
        else:
            raise ValueError(f"unknown element kind {kind!r} for layer {layer.name!r}")
        elements.append(element)

    fonts = {(e["font"]["family"], e["font"]["style"]): e["font"] for e in elements if e["kind"] == "text"}
    manifest = {
        "format": PACK_FORMAT,
        "version": PACK_VERSION,
        "template_id": result.record["template_id"],
        "preset_id": result.record["preset_id"],
        "layout_id": result.record["layout_id"],
        "seed": result.record["seed"],
        "canvas": {"width": width, "height": height, "aspect": result.record["aspect"], "unit": "px"},
        "background": {"color": ground, "file": background_file},
        "elements": elements,
        "fonts": [fonts[k] for k in sorted(fonts)],
        "assets_used": result.record["assets_used"],
        "warnings": result.record["warnings"],
        "preview": "preview.png",
        "record": "record.json",
    }
    return manifest, files


def write_pack(result: RenderResult, out_dir: str | Path) -> Path:
    """Writes the pack folder and returns the manifest path."""
    out = Path(out_dir)
    manifest, files = build_manifest(result)
    for relative, image in files.items():
        path = out / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        save_image(image, path)
    save_image(result.image, out / "preview.png")
    (out / "record.json").write_text(json.dumps(result.record, indent=2, sort_keys=True), encoding="utf-8")
    path = out / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def compose_pack(pack_dir: str | Path) -> Image:
    """Rebuilds the poster from a pack alone: the reference for any other renderer.

    Elements are drawn bottom to top, each at its own position with its own opacity
    and blend mode. Text uses its ``raster``; a renderer with the fonts can set the
    editable text instead.
    """
    root = Path(pack_dir)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    width, height = manifest["canvas"]["width"], manifest["canvas"]["height"]
    background = manifest["background"]
    canvas = np.ones((height, width, 4), dtype=np.float32)
    if background["file"]:
        canvas[..., :3] = load_image(root / background["file"])[..., :3]
    else:
        canvas[..., :3] = parse_hex(background["color"])

    for element in manifest["elements"]:
        if element["kind"] == "image":
            pixels, x, y = load_image(root / element["file"]), element["x"], element["y"]
        elif element["kind"] == "text":
            raster = element["raster"]
            pixels, x, y = load_image(root / raster["file"]), raster["x"], raster["y"]
        else:
            w, h = element["w"], element["h"]
            pixels = _ring(w, h, element["stroke_px"], element["stroke"]) if "stroke" in element else _solid(w, h, element["fill"])
            x, y = element["x"], element["y"]
        placed = place(pixels, (width, height), Transform(x, y))
        canvas = composite(canvas, placed, mode=element["blend"], opacity=element["opacity"])
    return canvas[..., :3].copy()

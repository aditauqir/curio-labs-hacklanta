"""The layer stack and renderer.

Layers are ordered bottom to top. Each has a blend mode, opacity, optional mask,
a transform, and optionally an effect chain applied to its own pixels before it
is composited. An *adjustment* layer has no pixels: it runs its chain over
everything beneath it, like a Photoshop adjustment layer.

Positions are in canvas pixels, and a layer may extend past the canvas edge,
which is how "bleed off the edge" compositions are expressed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

import cv2
import numpy as np

from .blend import BLEND_MODES, composite
from .color import parse_hex
from .image import Image, clip01, has_alpha
from .seed import derive_seed
from .stacks import OpCall, get_stack, run_stack


@dataclass
class Transform:
    """Places a layer on the canvas.

    ``x, y`` is where the layer's anchor lands on the canvas, in pixels. The
    anchor is a fraction of the layer's own size (0.5, 0.5 is its centre).
    """

    x: float = 0.0
    y: float = 0.0
    scale_x: float = 1.0
    scale_y: float | None = None
    rotation_deg: float = 0.0
    anchor: tuple[float, float] = (0.0, 0.0)

    @property
    def sy(self) -> float:
        return self.scale_x if self.scale_y is None else self.scale_y


@dataclass
class Layer:
    name: str
    image: Image | None = None
    blend: str = "normal"
    opacity: float = 1.0
    mask: np.ndarray | None = None  # canvas-sized (H, W) float, 1 = visible
    transform: Transform | None = None
    effects: list[OpCall] | str = field(default_factory=list)
    visible: bool = True
    adjustment: list[OpCall] | str | None = None

    def __post_init__(self) -> None:
        if self.blend not in BLEND_MODES:
            raise ValueError(f"unknown blend mode {self.blend!r}")
        if self.image is None and self.adjustment is None:
            raise ValueError(f"layer {self.name!r} needs an image or an adjustment chain")


class LayerStack:
    """An ordered list of layers, bottom first."""

    def __init__(self, layers: Iterable[Layer] = ()) -> None:
        self.layers: list[Layer] = []
        for layer in layers:
            self.add(layer)

    def __len__(self) -> int:
        return len(self.layers)

    def __iter__(self):
        return iter(self.layers)

    @property
    def names(self) -> list[str]:
        return [layer.name for layer in self.layers]

    def add(self, layer: Layer) -> Layer:
        return self.insert(len(self.layers), layer)

    def insert(self, index: int, layer: Layer) -> Layer:
        if layer.name in self.names:
            raise ValueError(f"a layer named {layer.name!r} already exists")
        self.layers.insert(index, layer)
        return layer

    def get(self, name: str) -> Layer:
        for layer in self.layers:
            if layer.name == name:
                return layer
        raise KeyError(f"no layer named {name!r}")

    def remove(self, name: str) -> Layer:
        layer = self.get(name)
        self.layers.remove(layer)
        return layer

    def move(self, name: str, index: int) -> None:
        layer = self.remove(name)
        self.layers.insert(index, layer)

    def reorder(self, names: list[str]) -> None:
        """Applies a bottom-to-top order (for example a preset's ``layer_order``).

        Names that are not layers are ignored; layers not listed keep their
        relative order below the listed ones.
        """
        listed = [self.get(name) for name in names if name in self.names]
        rest = [layer for layer in self.layers if layer not in listed]
        self.layers = rest + listed


def _affine(transform: Transform, size: tuple[int, int]) -> np.ndarray:
    w, h = size
    ax, ay = transform.anchor[0] * w, transform.anchor[1] * h
    theta = np.radians(transform.rotation_deg)
    cos, sin = np.cos(theta), np.sin(theta)
    sx, sy = transform.scale_x, transform.sy
    # canvas = T(x, y) . R . S . T(-anchor)
    return np.array(
        [
            [cos * sx, -sin * sy, transform.x - (cos * sx * ax - sin * sy * ay)],
            [sin * sx, cos * sy, transform.y - (sin * sx * ax + cos * sy * ay)],
        ],
        dtype=np.float64,
    )


def place(image: Image, canvas_size: tuple[int, int], transform: Transform | None) -> Image:
    """Returns ``image`` placed on a transparent RGBA canvas of ``canvas_size`` (w, h)."""
    cw, ch = canvas_size
    rgba = image if has_alpha(image) else np.concatenate([image, np.ones(image.shape[:2] + (1,), np.float32)], axis=2)

    if transform is None:
        transform = Transform()
    identity = transform.scale_x == 1.0 and transform.sy == 1.0 and transform.rotation_deg == 0.0
    # Warp premultiplied colour so transparent edges do not bleed dark fringes.
    pre = rgba.copy()
    pre[..., :3] *= pre[..., 3:4]
    matrix = _affine(transform, (rgba.shape[1], rgba.shape[0]))
    interpolation = cv2.INTER_LINEAR if identity else cv2.INTER_CUBIC
    warped = cv2.warpAffine(pre, matrix, (cw, ch), flags=interpolation, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    alpha = np.clip(warped[..., 3:4], 0.0, 1.0)
    rgb = np.where(alpha > 1e-6, warped[..., :3] / np.maximum(alpha, 1e-6), 0.0)
    return clip01(np.concatenate([rgb, alpha], axis=2))


def render(stack: LayerStack, width: int, height: int, background: str | tuple[float, float, float] | None = "#FFFFFF", seed: int = 0) -> Image:
    """Composites the stack onto a ``width`` x ``height`` canvas.

    Returns RGB when a background colour is given, RGBA (transparent canvas)
    when ``background`` is ``None``.
    """
    from curio.ops import apply_op  # noqa: F401  (ensures ops are registered)

    if background is None:
        canvas = np.zeros((height, width, 4), dtype=np.float32)
    else:
        colour = parse_hex(background) if isinstance(background, str) else background
        canvas = np.empty((height, width, 4), dtype=np.float32)
        canvas[..., :3] = colour
        canvas[..., 3] = 1.0

    for index, layer in enumerate(stack.layers):
        if not layer.visible or layer.opacity <= 0.0:
            continue
        layer_seed = derive_seed(seed, "layer", index, layer.name)

        if layer.adjustment is not None:
            chain = get_stack(layer.adjustment) if isinstance(layer.adjustment, str) else layer.adjustment
            adjusted = run_stack(canvas, chain, seed=layer_seed)
            canvas = composite(canvas, adjusted, mode=layer.blend, opacity=layer.opacity, mask=layer.mask)
            continue

        assert layer.image is not None
        pixels = layer.image
        chain = get_stack(layer.effects) if isinstance(layer.effects, str) else layer.effects
        if chain:
            pixels = run_stack(pixels, chain, seed=layer_seed)

        placed = place(pixels, (width, height), layer.transform)
        canvas = composite(canvas, placed, mode=layer.blend, opacity=layer.opacity, mask=layer.mask)

    return canvas[..., :3].copy() if background is not None else canvas


def bleed_off_edge(
    layer_size: tuple[int, int],
    canvas_size: tuple[int, int],
    edge: str = "right",
    overhang: float = 0.2,
    height_fraction: float = 1.0,
    align: float = 0.5,
) -> Transform:
    """Positions a layer so part of it runs off one canvas edge.

    The layer is scaled so its height (for left/right) or width (for top/bottom)
    is ``height_fraction`` of the canvas, then pushed so ``overhang`` of its
    length along the bleed axis lies outside the canvas. ``align`` slides it
    along the other axis (0 start, 1 end).
    """
    if edge not in ("left", "right", "top", "bottom"):
        raise ValueError("edge must be left, right, top or bottom")
    lw, lh = layer_size
    cw, ch = canvas_size
    horizontal = edge in ("left", "right")
    scale = (ch * height_fraction / lh) if horizontal else (cw * height_fraction / lw)
    sw, sh = lw * scale, lh * scale

    if horizontal:
        y = (ch - sh) * align
        x = cw - sw * (1 - overhang) if edge == "right" else -sw * overhang
        return Transform(x=x, y=y, scale_x=scale)
    x = (cw - sw) * align
    y = ch - sh * (1 - overhang) if edge == "bottom" else -sh * overhang
    return Transform(x=x, y=y, scale_x=scale)

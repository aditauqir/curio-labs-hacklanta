"""Texture and finish ops: grain, paper, scan lines, misregistration, ink bleed,
distress, halation, vignette, texture overlays."""

from __future__ import annotations

import cv2
import numpy as np

from curio.core.blend import BLEND_MODE_NAMES, blend_rgb
from curio.core.color import luma
from curio.core.noise import fbm, value_noise
from curio.core.seed import rng
from curio.core.textures import resolve_texture
from curio.ops import Bool, Choice, Color, Float, FloatList, Param, register_op
from curio.ops._util import hex_array, smoothstep


def _grain_field(shape: tuple[int, int], size: float, generator: np.random.Generator) -> np.ndarray:
    """Zero-mean, unit-variance grain with features about ``size`` pixels wide."""
    field = generator.standard_normal(shape).astype(np.float32)
    if size > 1.0:
        field = cv2.GaussianBlur(field, (0, 0), size * 0.5)
    return (field - field.mean()) / max(float(field.std()), 1e-6)


@register_op(
    "grain",
    category="texture",
    stochastic=True,
    params=[
        Float("amount", 0.25, 0.0, 1.0),
        Float("size", 1.2, 0.5, 12.0, "feature size in pixels"),
        Choice("mode", "mono", ["mono", "chroma"]),
        Choice("blend", "soft_light", ["soft_light", "overlay", "multiply", "screen", "linear_dodge"]),
        Float("midtone_bias", 0.5, 0.0, 1.0, "how much grain concentrates in the mid tones"),
    ],
)
def grain(img, p, seed):
    """Film-style grain blended over the image."""
    h, w = img.shape[:2]
    g = rng(seed, "grain")
    if p.mode == "mono":
        field = _grain_field((h, w), p.size, g)[..., None]
        field = np.repeat(field, 3, axis=2)
    else:
        field = np.stack([_grain_field((h, w), p.size, g) for _ in range(3)], axis=2)
    layer = np.clip(0.5 + field * 0.18, 0.0, 1.0)

    y = luma(img)[..., None]
    weight = p.amount * (1.0 - p.midtone_bias * np.abs(2.0 * y - 1.0))
    return img + (blend_rgb(img, layer, p.blend) - img) * weight


@register_op(
    "noise",
    category="texture",
    stochastic=True,
    params=[
        Float("amount", 0.1, 0.0, 1.0),
        Choice("kind", "gaussian", ["gaussian", "uniform"]),
        Bool("mono", True),
    ],
)
def noise(img, p, seed):
    """Additive noise."""
    g = rng(seed, "noise")
    shape = img.shape[:2] + ((1,) if p.mono else (3,))
    field = g.standard_normal(shape) if p.kind == "gaussian" else (g.random(shape) * 2.0 - 1.0) * 1.7
    return img + field.astype(np.float32) * p.amount * 0.5


@register_op(
    "paper_texture",
    category="texture",
    stochastic=True,
    params=[
        Float("amount", 0.6, 0.0, 1.0),
        Color("tint", "#FFFFFF", "multiplies the paper colour"),
        Choice("blend", "multiply", ["multiply", "overlay", "soft_light", "screen"]),
    ],
)
def paper_texture(img, p, seed):
    """Procedural paper tooth, blotches and fibres laid over the image."""
    h, w = img.shape[:2]
    paper = resolve_texture("procedural:paper", (w, h), seed) * hex_array([p.tint])[0]
    return img + (blend_rgb(img, np.clip(paper, 0.0, 1.0), p.blend) - img) * p.amount


@register_op(
    "scan_lines",
    category="texture",
    params=[
        Float("spacing_px", 4.0, 2.0, 64.0),
        Float("thickness", 0.4, 0.05, 0.95, "fraction of the spacing"),
        Float("opacity", 0.3, 0.0, 1.0),
        Float("angle_deg", 0.0, -90.0, 90.0, "0 is horizontal lines"),
        Color("color", "#000000"),
    ],
)
def scan_lines(img, p, seed):
    """Evenly spaced lines, as on a CRT or a line screen."""
    h, w = img.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    theta = np.radians(p.angle_deg)
    coord = (-np.sin(theta) * xs + np.cos(theta) * ys) / p.spacing_px
    frac = coord - np.floor(coord)
    edge = 1.0 / p.spacing_px
    bar = smoothstep(0.0, edge, frac) * (1.0 - smoothstep(p.thickness, p.thickness + edge, frac))
    ink = hex_array([p.color])[0]
    a = (bar * p.opacity)[..., None]
    return img * (1.0 - a) + ink * a


@register_op(
    "misregistration",
    category="texture",
    params=[
        FloatList("red", [2.0, 0.0], -100.0, 100.0, min_items=2, max_items=2, doc="dx, dy in pixels"),
        FloatList("green", [0.0, 0.0], -100.0, 100.0, min_items=2, max_items=2),
        FloatList("blue", [-2.0, 0.0], -100.0, 100.0, min_items=2, max_items=2),
    ],
)
def misregistration(img, p, seed):
    """Shifts each colour channel, like a print plate out of register."""
    h, w = img.shape[:2]
    out = np.empty_like(img)
    for index, shift in enumerate((p.red, p.green, p.blue)):
        matrix = np.array([[1, 0, shift[0]], [0, 1, shift[1]]], dtype=np.float32)
        out[..., index] = cv2.warpAffine(np.ascontiguousarray(img[..., index]), matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return out


@register_op(
    "ink_bleed",
    category="texture",
    stochastic=True,
    params=[
        Float("spread_px", 2.0, 0.0, 30.0),
        Float("roughness", 0.5, 0.0, 1.0),
        Float("amount", 1.0, 0.0, 1.0),
        Color("ink", "#000000"),
    ],
)
def ink_bleed(img, p, seed):
    """Dark areas swell outward with an uneven edge, like ink soaking into paper."""
    if p.spread_px <= 0 or p.amount <= 0:
        return img
    h, w = img.shape[:2]
    # Only heavily inked areas bleed. Using raw darkness would paint mid-tones.
    ink_area = smoothstep(0.5, 0.8, 1.0 - luma(img))
    spread = cv2.GaussianBlur(ink_area, (0, 0), p.spread_px)
    wobble = fbm((h, w), max(p.spread_px * 2.0, 3.0), rng(seed, "ink_bleed"), octaves=3)
    swelled = smoothstep(0.3, 0.5, spread + (wobble - 0.5) * p.roughness * 0.5)
    added = np.clip(swelled - ink_area, 0.0, 1.0) * p.amount
    ink = hex_array([p.ink])[0]
    return img * (1.0 - added[..., None]) + ink * added[..., None]


@register_op(
    "distress",
    category="texture",
    stochastic=True,
    params=[
        Float("amount", 0.3, 0.0, 1.0),
        Float("scale_px", 24.0, 2.0, 400.0, "size of the worn patches"),
        Float("speckle", 0.3, 0.0, 1.0, "fine flecks"),
        Color("paper", "#F2EBDD", "colour revealed where the ink is worn away"),
    ],
)
def distress(img, p, seed):
    """Erodes the image into worn patches and flecks that reveal the paper."""
    if p.amount <= 0:
        return img
    h, w = img.shape[:2]
    g = rng(seed, "distress")
    patches = fbm((h, w), p.scale_px, g, octaves=4)
    wear = smoothstep(1.0 - p.amount * 0.6 - 0.02, 1.0 - p.amount * 0.6 + 0.02, patches)
    flecks = (value_noise((h, w), 1.5, g) > 1.0 - p.speckle * p.amount * 0.5).astype(np.float32)
    mask = np.clip(wear + flecks, 0.0, 1.0)[..., None]
    return img * (1.0 - mask) + hex_array([p.paper])[0] * mask


@register_op(
    "halation",
    category="texture",
    params=[
        Float("radius_px", 20.0, 1.0, 200.0),
        Float("threshold", 0.7, 0.0, 0.99),
        Float("strength", 0.6, 0.0, 2.0),
        Color("tint", "#FF6A3D"),
    ],
)
def halation(img, p, seed):
    """A tinted glow around bright areas."""
    bright = np.clip((luma(img) - p.threshold) / max(1.0 - p.threshold, 1e-4), 0.0, 1.0)
    glow = cv2.GaussianBlur(bright, (0, 0), p.radius_px)[..., None] * hex_array([p.tint])[0] * p.strength
    return blend_rgb(img, np.clip(glow, 0.0, 1.0), "screen")


@register_op(
    "vignette",
    category="texture",
    params=[
        Float("amount", 0.4, 0.0, 1.0),
        Float("radius", 0.7, 0.0, 1.5, "where darkening starts; 1 is the corners"),
        Float("softness", 0.5, 0.05, 1.5),
        Color("color", "#000000"),
    ],
)
def vignette(img, p, seed):
    """Darkens (or tints) toward the edges."""
    h, w = img.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    nx, ny = (xs - (w - 1) / 2.0) / (w / 2.0), (ys - (h - 1) / 2.0) / (h / 2.0)
    r = np.sqrt(nx**2 + ny**2) / np.sqrt(2.0)
    v = smoothstep(p.radius, p.radius + p.softness, r)[..., None] * p.amount
    return img * (1.0 - v) + hex_array([p.color])[0] * v


@register_op(
    "overlay_texture",
    category="texture",
    stochastic=True,
    params=[
        Param("texture", "image", "procedural:paper", doc="a registered texture id, 'procedural:*', or an image array"),
        Choice("blend", "multiply", BLEND_MODE_NAMES),
        Float("opacity", 0.5, 0.0, 1.0),
        Float("zoom", 1.0, 1.0, 8.0),
        Bool("invert", False),
    ],
)
def overlay_texture(img, p, seed):
    """Lays a texture over the image with a chosen blend mode."""
    h, w = img.shape[:2]
    texture = resolve_texture(p.texture, (w, h), seed, zoom=p.zoom)
    if p.invert:
        texture = 1.0 - texture
    return img + (blend_rgb(img, texture, p.blend) - img) * p.opacity

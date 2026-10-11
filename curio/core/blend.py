"""Blend modes and Porter-Duff compositing.

Formulas follow the W3C Compositing and Blending spec, the same definitions
Photoshop-style tools use, so a recipe reads the way a designer expects. All
functions take straight-alpha float arrays.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from .image import Image

BlendFn = Callable[[np.ndarray, np.ndarray], np.ndarray]


def _multiply(b, s):
    return b * s


def _screen(b, s):
    return 1.0 - (1.0 - b) * (1.0 - s)


def _hard_light(b, s):
    return np.where(s <= 0.5, b * 2.0 * s, _screen(b, 2.0 * s - 1.0))


def _overlay(b, s):
    return _hard_light(s, b)


def _soft_light(b, s):
    d = np.where(b <= 0.25, ((16.0 * b - 12.0) * b + 4.0) * b, np.sqrt(b))
    return np.where(s <= 0.5, b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b))


def _difference(b, s):
    return np.abs(b - s)


def _exclusion(b, s):
    return b + s - 2.0 * b * s


def _color_dodge(b, s):
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.minimum(1.0, b / np.maximum(1.0 - s, 1e-6))
    return np.where(b <= 0.0, 0.0, np.where(s >= 1.0, 1.0, out))


def _color_burn(b, s):
    with np.errstate(divide="ignore", invalid="ignore"):
        out = 1.0 - np.minimum(1.0, (1.0 - b) / np.maximum(s, 1e-6))
    return np.where(b >= 1.0, 1.0, np.where(s <= 0.0, 0.0, out))


BLEND_MODES: dict[str, BlendFn] = {
    "normal": lambda b, s: s,
    "multiply": _multiply,
    "screen": _screen,
    "overlay": _overlay,
    "soft_light": _soft_light,
    "hard_light": _hard_light,
    "difference": _difference,
    "exclusion": _exclusion,
    "color_dodge": _color_dodge,
    "color_burn": _color_burn,
    "darken": np.minimum,
    "lighten": np.maximum,
    "linear_dodge": lambda b, s: np.minimum(1.0, b + s),
}

BLEND_MODE_NAMES = tuple(BLEND_MODES)


def blend_rgb(backdrop: np.ndarray, source: np.ndarray, mode: str) -> np.ndarray:
    """Blends two RGB arrays with no alpha handling."""
    try:
        fn = BLEND_MODES[mode]
    except KeyError as error:
        raise ValueError(f"unknown blend mode {mode!r}; expected one of {BLEND_MODE_NAMES}") from error
    return np.clip(fn(backdrop, source), 0.0, 1.0).astype(np.float32)


def composite(
    backdrop: Image,
    source: Image,
    mode: str = "normal",
    opacity: float = 1.0,
    mask: np.ndarray | None = None,
) -> Image:
    """Composites ``source`` over ``backdrop`` and returns an RGBA image.

    Both inputs may be RGB (treated as opaque) or RGBA. ``mask`` is an ``(H, W)``
    array that scales the source's alpha, as a layer mask does.
    """
    if backdrop.shape[:2] != source.shape[:2]:
        raise ValueError(f"size mismatch: backdrop {backdrop.shape[:2]} vs source {source.shape[:2]}")

    cb, ab = backdrop[..., :3], (backdrop[..., 3] if backdrop.shape[2] == 4 else np.ones(backdrop.shape[:2], np.float32))
    cs, a_s = source[..., :3], (source[..., 3] if source.shape[2] == 4 else np.ones(source.shape[:2], np.float32))

    a_s = a_s * float(np.clip(opacity, 0.0, 1.0))
    if mask is not None:
        a_s = a_s * np.clip(mask.astype(np.float32), 0.0, 1.0)

    blended = blend_rgb(cb, cs, mode)
    ar = ab + a_s - ab * a_s
    safe = np.maximum(ar, 1e-6)[..., None]
    weight = (a_s / np.maximum(ar, 1e-6))[..., None]
    mixed = (1.0 - ab[..., None]) * cs + ab[..., None] * blended
    out_rgb = (1.0 - weight) * cb + weight * mixed
    out_rgb = np.where(safe <= 1e-6, 0.0, out_rgb)
    return np.concatenate([np.clip(out_rgb, 0.0, 1.0), ar[..., None]], axis=2).astype(np.float32)

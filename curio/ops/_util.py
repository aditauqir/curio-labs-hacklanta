"""Helpers shared by op modules. Underscore-prefixed, so op discovery skips it."""

from __future__ import annotations

import numpy as np

from curio.core.color import luma, parse_hex


def hex_array(colors: list[str]) -> np.ndarray:
    return np.array([parse_hex(c) for c in colors], dtype=np.float32)


def gradient_lut(colors: list[str], positions: list[float] | None = None, size: int = 1024) -> np.ndarray:
    """A ``(size, 3)`` colour ramp. Positions default to even spacing."""
    stops = hex_array(colors)
    if positions and len(positions) == len(colors):
        order = np.argsort(positions)
        pos = np.asarray(positions, dtype=np.float32)[order]
        stops = stops[order]
    else:
        pos = np.linspace(0.0, 1.0, len(colors), dtype=np.float32)
    grid = np.linspace(0.0, 1.0, size, dtype=np.float32)
    return np.stack([np.interp(grid, pos, stops[:, c]) for c in range(3)], axis=1).astype(np.float32)


def map_through_lut(values: np.ndarray, lut: np.ndarray) -> np.ndarray:
    """Maps an ``(H, W)`` array in [0, 1] through a ``(N, 3)`` colour ramp."""
    index = np.clip(values, 0.0, 1.0) * (len(lut) - 1)
    lo = np.floor(index).astype(np.int32)
    hi = np.minimum(lo + 1, len(lut) - 1)
    frac = (index - lo)[..., None]
    return (lut[lo] * (1.0 - frac) + lut[hi] * frac).astype(np.float32)


def smoothstep(edge0: float | np.ndarray, edge1: float | np.ndarray, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / np.maximum(edge1 - edge0, 1e-6), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def grey_rgb(plane: np.ndarray) -> np.ndarray:
    return np.repeat(plane[..., None], 3, axis=2).astype(np.float32)


def luma_plane(rgb: np.ndarray) -> np.ndarray:
    return luma(rgb)


def odd(value: float, minimum: int = 1) -> int:
    n = max(int(round(value)), minimum)
    return n if n % 2 == 1 else n + 1

"""Seeded procedural noise used by grain, paper, distress and ink effects.

Everything takes a NumPy ``Generator`` so the caller controls reproducibility:
the same generator state always produces the same field.
"""

from __future__ import annotations

import cv2
import numpy as np


def white_noise(shape: tuple[int, int], rng: np.random.Generator) -> np.ndarray:
    return rng.random(shape, dtype=np.float32)


def value_noise(shape: tuple[int, int], cell: float, rng: np.random.Generator) -> np.ndarray:
    """Smooth noise in [0, 1] with features about ``cell`` pixels wide."""
    h, w = shape
    cell = max(float(cell), 1.0)
    gh, gw = int(np.ceil(h / cell)) + 3, int(np.ceil(w / cell)) + 3
    grid = rng.random((gh, gw), dtype=np.float32)
    up = cv2.resize(grid, (int(gw * cell), int(gh * cell)), interpolation=cv2.INTER_CUBIC)
    off = int(cell)
    return np.clip(up[off : off + h, off : off + w], 0.0, 1.0)


def fbm(shape: tuple[int, int], cell: float, rng: np.random.Generator, octaves: int = 4, persistence: float = 0.5) -> np.ndarray:
    """Fractal (multi-octave) noise normalised to [0, 1]."""
    total = np.zeros(shape, dtype=np.float32)
    amplitude, norm, size = 1.0, 0.0, float(cell)
    for _ in range(max(int(octaves), 1)):
        total += amplitude * value_noise(shape, size, rng)
        norm += amplitude
        amplitude *= persistence
        size = max(size / 2.0, 1.0)
    total /= norm
    lo, hi = float(total.min()), float(total.max())
    return ((total - lo) / (hi - lo)).astype(np.float32) if hi > lo else np.full(shape, 0.5, np.float32)

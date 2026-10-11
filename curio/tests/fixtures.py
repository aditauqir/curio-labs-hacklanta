"""Deterministic stand-in inputs for tests. Nothing here is a real photograph."""

from __future__ import annotations

import cv2
import numpy as np


def standin_photo(size: int = 96) -> np.ndarray:
    """A synthetic 'portrait': sky gradient, sun, hills, and a shaded figure.

    It has smooth gradients, hard edges, dark and bright regions and colour, so
    tonal, screening and edge ops all have something meaningful to act on.
    """
    h = w = size
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    t = ys / (h - 1)
    img = np.empty((h, w, 3), dtype=np.float32)
    img[..., 0] = 0.30 + 0.55 * t
    img[..., 1] = 0.45 + 0.30 * t
    img[..., 2] = 0.80 - 0.30 * t

    sun = np.hypot(xs - 0.78 * w, ys - 0.22 * h) < 0.11 * w
    img[sun] = (1.0, 0.93, 0.62)

    hills = ys > (0.72 + 0.06 * np.sin(xs / w * 6.0)) * h
    img[hills] = (0.16, 0.30, 0.20)

    cx, cy = 0.40 * w, 0.62 * h
    body = ((xs - cx) / (0.22 * w)) ** 2 + ((ys - (cy + 0.20 * h)) / (0.26 * h)) ** 2 < 1.0
    head = np.hypot(xs - cx, ys - (cy - 0.04 * h)) < 0.12 * w
    shade = 0.55 + 0.45 * np.clip((xs - (cx - 0.2 * w)) / (0.4 * w), 0, 1)
    figure = (body | head)
    img[figure] = np.stack([0.50 * shade, 0.20 * shade, 0.22 * shade], axis=-1)[figure]
    img[head] = np.stack([0.90 * shade, 0.68 * shade, 0.56 * shade], axis=-1)[head]

    return np.clip(cv2.GaussianBlur(img, (0, 0), 0.6), 0.0, 1.0).astype(np.float32)


def standin_rgba(size: int = 96) -> np.ndarray:
    """The stand-in photo with the figure as an opaque, soft-edged subject."""
    rgb = standin_photo(size)
    h = w = size
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = 0.40 * w, 0.62 * h
    body = ((xs - cx) / (0.22 * w)) ** 2 + ((ys - (cy + 0.20 * h)) / (0.26 * h)) ** 2 < 1.0
    head = np.hypot(xs - cx, ys - (cy - 0.04 * h)) < 0.12 * w
    alpha = cv2.GaussianBlur((body | head).astype(np.float32), (0, 0), 1.0)
    return np.concatenate([rgb, alpha[..., None]], axis=2).astype(np.float32)


def standin_matte(size: int = 96) -> np.ndarray:
    return standin_rgba(size)[..., 3]

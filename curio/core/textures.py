"""Texture sources: procedural generators and a registry of supplied textures.

Procedural textures are preferred wherever they look right, because they carry
no licence and are exactly reproducible from a seed. Supplied textures (paper
scans, CC0 libraries) are registered by id once the asset layer has fetched
them; ops refer to a texture only by id.
"""

from __future__ import annotations

import cv2
import numpy as np

from .image import Image, split_alpha
from .noise import fbm, value_noise
from .seed import rng

_SUPPLIED: dict[str, Image] = {}

PROCEDURAL = ("procedural:paper", "procedural:grain", "procedural:scratches", "procedural:fibers")


def register_texture(texture_id: str, image: Image) -> None:
    """Registers a supplied texture (RGB or grey). Ids may not shadow procedural ones."""
    if texture_id.startswith("procedural:"):
        raise ValueError("ids starting with 'procedural:' are reserved")
    _SUPPLIED[texture_id] = split_alpha(image.astype(np.float32))[0] if image.ndim == 3 else image.astype(np.float32)


def clear_textures() -> None:
    _SUPPLIED.clear()


def fibers(shape: tuple[int, int], generator: np.random.Generator, count: int, length: float) -> np.ndarray:
    """Short curved fibre strokes on a 0 background, thin and low contrast."""
    h, w = shape
    canvas = np.zeros((h, w), dtype=np.float32)
    for _ in range(count):
        x, y = generator.random() * w, generator.random() * h
        angle = generator.random() * np.pi
        bend = (generator.random() - 0.5) * 0.6
        pts = []
        for step in range(5):
            t = step / 4.0
            a = angle + bend * t
            pts.append((int(x + np.cos(a) * length * t), int(y + np.sin(a) * length * t)))
        cv2.polylines(canvas, [np.array(pts, dtype=np.int32)], False, float(0.3 + 0.7 * generator.random()), 1, cv2.LINE_AA)
    return canvas


def procedural(texture_id: str, size: tuple[int, int], seed: int) -> Image:
    """Generates a texture at ``size = (width, height)`` as float RGB."""
    w, h = size
    shape = (h, w)
    short = float(min(w, h))

    if texture_id == "procedural:paper":
        g = rng(seed, "paper")
        blotch = fbm(shape, short / 3.0, g, octaves=4)
        tooth = value_noise(shape, 1.5, g)
        fib = cv2.GaussianBlur(fibers(shape, g, int(w * h / 4000), short * 0.04), (0, 0), 0.6)
        tone = 0.90 + 0.07 * blotch + 0.04 * (tooth - 0.5) - 0.06 * fib
        tint = np.array([1.0, 0.985, 0.94], dtype=np.float32)
        return np.clip(tone[..., None] * tint, 0, 1).astype(np.float32)

    if texture_id == "procedural:grain":
        g = rng(seed, "grain-texture")
        n = np.clip(0.5 + (g.random(shape, dtype=np.float32) - 0.5) * 1.0, 0, 1)
        return np.repeat(n[..., None], 3, axis=2)

    if texture_id == "procedural:scratches":
        g = rng(seed, "scratches")
        base = np.full(shape, 0.5, dtype=np.float32)
        for _ in range(int(w * h / 12000) + 4):
            x, y = g.random() * w, g.random() * h
            angle = (g.random() - 0.5) * 0.5 + (np.pi / 2 if g.random() < 0.5 else 0.0)
            length = short * (0.05 + 0.25 * g.random())
            tone = 0.5 + (0.45 if g.random() < 0.6 else -0.45) * (0.3 + 0.7 * g.random())
            cv2.line(base, (int(x), int(y)), (int(x + np.cos(angle) * length), int(y + np.sin(angle) * length)), float(tone), 1, cv2.LINE_AA)
        return np.repeat(base[..., None], 3, axis=2)

    if texture_id == "procedural:fibers":
        g = rng(seed, "fibers")
        f = np.clip(1.0 - 0.5 * fibers(shape, g, int(w * h / 2500), short * 0.05), 0, 1)
        return np.repeat(f[..., None], 3, axis=2)

    raise KeyError(f"unknown procedural texture {texture_id!r}; expected one of {PROCEDURAL}")


def resolve_texture(reference: str | np.ndarray, size: tuple[int, int], seed: int = 0, zoom: float = 1.0) -> Image:
    """Returns a texture as float RGB covering ``size = (width, height)``.

    A registered or array texture is scaled to *cover* the canvas and centre
    cropped, then optionally zoomed in.
    """
    if isinstance(reference, str) and reference.startswith("procedural:"):
        return procedural(reference, size, seed)

    if isinstance(reference, str):
        try:
            source = _SUPPLIED[reference]
        except KeyError as error:
            raise KeyError(f"texture {reference!r} is not registered") from error
    else:
        source = reference.astype(np.float32)

    if source.ndim == 2:
        source = np.repeat(source[..., None], 3, axis=2)
    source = source[..., :3]

    w, h = size
    scale = max(w / source.shape[1], h / source.shape[0]) * max(zoom, 1.0)
    new_w, new_h = max(int(np.ceil(source.shape[1] * scale)), w), max(int(np.ceil(source.shape[0] * scale)), h)
    resized = cv2.resize(source, (new_w, new_h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    x0, y0 = (new_w - w) // 2, (new_h - h) // 2
    return np.clip(resized[y0 : y0 + h, x0 : x0 + w], 0.0, 1.0).astype(np.float32)

"""Image representation and file I/O.

An image is a ``float32`` NumPy array shaped ``(H, W, 3)`` or ``(H, W, 4)`` with
values in ``[0, 1]`` in the sRGB encoding (display-referred, like Photoshop's
default). Alpha is straight (not premultiplied). Working in float avoids the
banding that 8-bit intermediates cause across a long op chain; conversion to
8-bit happens once, at export.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image as PILImage

Image = np.ndarray


def new_image(width: int, height: int, color: tuple[float, float, float] = (0.0, 0.0, 0.0), alpha: float | None = None) -> Image:
    """A flat-colour image. Pass ``alpha`` for an RGBA image."""
    channels = 3 if alpha is None else 4
    img = np.empty((height, width, channels), dtype=np.float32)
    img[..., 0], img[..., 1], img[..., 2] = color
    if alpha is not None:
        img[..., 3] = alpha
    return img


def has_alpha(img: Image) -> bool:
    return img.ndim == 3 and img.shape[2] == 4


def split_alpha(img: Image) -> tuple[Image, Image | None]:
    """Returns ``(rgb, alpha)``; alpha is ``None`` for an RGB image."""
    if has_alpha(img):
        return img[..., :3], img[..., 3]
    return img, None


def merge_alpha(rgb: Image, alpha: Image | None) -> Image:
    if alpha is None:
        return rgb
    return np.concatenate([rgb, alpha[..., None]], axis=2)


def as_float(img: Image) -> Image:
    """Normalises any input to float32 in [0, 1] without changing its shape."""
    if img.dtype == np.uint8:
        return img.astype(np.float32) / 255.0
    if img.dtype == np.uint16:
        return img.astype(np.float32) / 65535.0
    return img.astype(np.float32, copy=False)


def clip01(img: Image) -> Image:
    return np.clip(img, 0.0, 1.0, out=None).astype(np.float32, copy=False)


def from_pil(pil: PILImage.Image) -> Image:
    """Converts a PIL image to float RGB(A). Palette and grey modes are expanded."""
    if pil.mode not in ("RGB", "RGBA"):
        pil = pil.convert("RGBA" if "A" in pil.getbands() or pil.mode == "P" and "transparency" in pil.info else "RGB")
    return np.asarray(pil, dtype=np.float32) / 255.0


def to_pil(img: Image) -> PILImage.Image:
    arr = np.clip(np.rint(clip01(img) * 255.0), 0, 255).astype(np.uint8)
    return PILImage.fromarray(arr, "RGBA" if has_alpha(img) else "RGB")


def load_image(path: str | Path) -> Image:
    with PILImage.open(path) as pil:
        pil.load()
        return from_pil(pil)


def save_image(img: Image, path: str | Path, dpi: int | None = None) -> None:
    pil = to_pil(img)
    kwargs: dict[str, object] = {}
    if dpi:
        kwargs["dpi"] = (dpi, dpi)
    pil.save(path, **kwargs)


def to_uint8(img: Image) -> np.ndarray:
    return np.clip(np.rint(clip01(img) * 255.0), 0, 255).astype(np.uint8)

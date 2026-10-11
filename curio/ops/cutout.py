"""Subject cutout.

OPEN ITEM (see curio/OPEN_ITEMS.md): the project has not decided how to isolate
a subject without a generative model. Candidates are classical segmentation
(GrabCut, thresholding on high-contrast photos), a user-supplied mask, or an
allowed non-generative segmentation model. That decision is not made here.

What exists is the seam: a :class:`Segmenter` interface, one implementation that
needs no decision (a mask the user supplies), and an op that uses whichever
segmenter is configured. Anything else raises, naming this open item, instead
of quietly guessing.
"""

from __future__ import annotations

from typing import Protocol

import numpy as np

from curio.core.textures import resolve_texture
from curio.ops import Param, register_op
from curio.ops.registry import Params


class Segmenter(Protocol):
    """Returns a ``(H, W)`` float alpha matte in [0, 1] for an RGB image."""

    def segment(self, rgb: np.ndarray, seed: int) -> np.ndarray: ...


class UserMaskSegmenter:
    """Uses a matte the user (or an earlier step) already provided."""

    def __init__(self, matte: np.ndarray) -> None:
        self.matte = matte

    def segment(self, rgb: np.ndarray, seed: int) -> np.ndarray:
        matte = self.matte
        if matte.ndim == 3:
            matte = matte[..., 0]
        if matte.shape != rgb.shape[:2]:
            raise ValueError(f"matte size {matte.shape} does not match image {rgb.shape[:2]}")
        return np.clip(matte.astype(np.float32), 0.0, 1.0)


_default: Segmenter | None = None


def set_default_segmenter(segmenter: Segmenter | None) -> None:
    """Configures the segmenter ``cutout`` uses when no matte is given."""
    global _default
    _default = segmenter


@register_op("cutout", category="masking", outputs_alpha=True, params=[Param("matte", "image", None, doc="optional alpha matte (array)")])
def cutout(img, p: Params, seed):
    """Isolates the subject by writing a matte into the alpha channel."""
    rgb = img[..., :3]
    if p.matte is not None:
        if isinstance(p.matte, str):
            matte = resolve_texture(p.matte, (rgb.shape[1], rgb.shape[0]), seed)[..., 0]
        else:
            matte = UserMaskSegmenter(p.matte).segment(rgb, seed)
    elif _default is not None:
        matte = _default.segment(rgb, seed)
    else:
        raise NotImplementedError(
            "cutout has no segmenter: this is an OPEN ITEM (curio/OPEN_ITEMS.md). "
            "Pass a matte, or call set_default_segmenter() with an approved implementation."
        )
    return np.concatenate([rgb, matte[..., None]], axis=2)

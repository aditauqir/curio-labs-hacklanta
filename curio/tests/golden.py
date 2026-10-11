"""Golden-image comparison.

A golden is an 8-bit PNG produced with a fixed input, params and seed. Tests
compare against it with a small tolerance (image libraries differ by a level or
two across platforms) and fail loudly when a golden is missing, so a new op
cannot be added without one. Regenerate with ``pytest --update-golden`` and
review the diff in the images.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image as PILImage

from curio.core.image import to_uint8

GOLDEN_DIR = Path(__file__).parent / "golden"
MAX_LEVEL_DIFF = 3
MEAN_LEVEL_DIFF = 0.5


def _save(path: Path, arr: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    PILImage.fromarray(arr, "RGBA" if arr.shape[2] == 4 else "RGB").save(path, optimize=True)


def check_golden(name: str, image: np.ndarray, update: bool) -> None:
    actual = to_uint8(image)
    path = GOLDEN_DIR / f"{name}.png"

    if update:
        _save(path, actual)
        return

    if not path.exists():
        raise AssertionError(f"missing golden image {path.name}; run `pytest --update-golden` and review it")

    expected = np.asarray(PILImage.open(path))
    assert expected.shape == actual.shape, f"{name}: shape {actual.shape} != golden {expected.shape}"
    diff = np.abs(expected.astype(np.int16) - actual.astype(np.int16))
    assert diff.max() <= MAX_LEVEL_DIFF and diff.mean() <= MEAN_LEVEL_DIFF, (
        f"{name}: differs from golden (max {diff.max()}, mean {diff.mean():.3f})"
    )

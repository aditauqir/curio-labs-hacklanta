"""The supplied asset library: halftone maps, grain, paper, overlays, patterns, vectors.

The files live in ``curio/assets`` (or ``$CURIO_ASSETS_DIR``) with an
``assets_manifest.json`` describing each one. Everything there is original
procedural output, CC0. Ops and styles refer to an asset only by id, written
``asset:<id>`` wherever a texture is accepted.

Scale: asset pixels are defined at the engine's reference size (1080 px on the
short edge), like every other length. A tileable asset is therefore **tiled**, not
stretched, so a 7.8 px halftone stays 7.8 px; at another output size it is
resampled by the same factor as every other length (``scale``). A non-tileable
overlay is fitted to cover the canvas, as a scan would be.

Conventions (from the manifest):
* ``halftone_threshold``: grey 0..255, high at dot centres. Light where
  luminance > map; soft edge ``clip((L - map) / softness + 0.5, 0, 1)``.
* ``grain``: centred on 128, blend overlay or soft light.
* ``paper`` and multiply patterns/overlays: 255 means no effect.
* ``screen`` overlays: 0 means no effect.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image as PILImage

from .image import Image

ASSET_PREFIX = "asset:"
KINDS = ("halftone_threshold", "grain", "paper", "pattern", "overlay", "vector")
BLEND_HINTS = ("threshold", "normal", "multiply", "screen", "overlay", "soft_light")
_ID = re.compile(r"^[a-z0-9_]+$")


@dataclass(frozen=True)
class Asset:
    id: str
    file: str  # relative to the library folder, forward slashes
    kind: str
    width: int
    height: int
    blend_hint: str
    tileable: bool
    license: str
    notes: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    achieved: dict[str, Any] = field(default_factory=dict)
    svg: str | None = None  # vector assets also ship an SVG

    @property
    def reference(self) -> str:
        return ASSET_PREFIX + self.id


@dataclass(frozen=True)
class AssetIssue:
    asset: str
    message: str

    def __str__(self) -> str:
        return f"assets_manifest.json: {self.asset}: {self.message}"


def default_assets_dir() -> Path:
    configured = os.environ.get("CURIO_ASSETS_DIR")
    return Path(configured) if configured else Path(__file__).resolve().parent.parent / "assets"


def _inside(root: Path, relative: Any) -> Path | None:
    """The file ``relative`` names inside ``root``, or None if it escapes or is not plain."""
    if not isinstance(relative, str) or not relative or "\\" in relative or relative.startswith("/") or ":" in relative:
        return None
    path = (root / relative).resolve()
    return path if path.is_relative_to(root.resolve()) else None


class AssetLibrary:
    """Reads and checks the manifest once; loads pixels lazily and caches them."""

    def __init__(self, directory: str | Path | None = None) -> None:
        self.directory = Path(directory) if directory is not None else default_assets_dir()
        self.assets: dict[str, Asset] = {}
        self.issues: list[AssetIssue] = []
        self._pixels: dict[str, Image] = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self) -> None:
        path = self.directory / "assets_manifest.json"
        if not path.is_file():
            self.issues.append(AssetIssue("(manifest)", f"not found in {self.directory}"))
            return
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            self.issues.append(AssetIssue("(manifest)", f"cannot read: {error}"))
            return
        for raw in manifest.get("assets", []):
            asset, problem = self._parse(raw)
            if problem:
                self.issues.append(AssetIssue(str(raw.get("id", "?")) if isinstance(raw, dict) else "?", problem))
            elif asset.id in self.assets:
                self.issues.append(AssetIssue(asset.id, "duplicate id"))
            else:
                self.assets[asset.id] = asset

    def _parse(self, raw: Any) -> tuple[Asset | None, str | None]:
        if not isinstance(raw, dict):
            return None, "an asset must be an object"
        asset_id = raw.get("id")
        if not isinstance(asset_id, str) or not _ID.match(asset_id):
            return None, "id must be [a-z0-9_]+"
        file = _inside(self.directory, raw.get("file"))
        if file is None:
            return None, "file must be a relative path inside the library"
        if not file.is_file():
            return None, f"file {raw['file']!r} is missing"
        if raw.get("kind") not in KINDS:
            return None, f"kind must be one of {KINDS}"
        if raw.get("blend_hint") not in BLEND_HINTS:
            return None, f"blend_hint must be one of {BLEND_HINTS}"
        if not isinstance(raw.get("license"), str) or not raw["license"]:
            return None, "license is required"
        size = raw.get("size")
        if not (isinstance(size, list) and len(size) == 2 and all(isinstance(v, int) and v > 0 for v in size)):
            return None, "size must be [width, height]"
        try:
            with PILImage.open(file) as image:  # reads the header only
                actual = image.size
        except OSError as error:
            return None, f"cannot open {raw['file']!r}: {error}"
        if tuple(size) != actual:
            return None, f"size says {size[0]}x{size[1]} but the file is {actual[0]}x{actual[1]}"
        achieved = raw.get("achieved") if isinstance(raw.get("achieved"), dict) else {}
        svg = achieved.get("svg")
        if svg is not None and (_inside(self.directory, svg) is None or not (self.directory / svg).is_file()):
            return None, f"svg {svg!r} is missing or outside the library"
        return Asset(
            id=asset_id, file=raw["file"], kind=raw["kind"], width=size[0], height=size[1],
            blend_hint=raw["blend_hint"], tileable=bool(raw.get("tileable")), license=raw["license"],
            notes=str(raw.get("notes") or ""), params=dict(raw.get("params") or {}), achieved=dict(achieved), svg=svg,
        ), None

    # ---------------------------------------------------------------- access

    def get(self, asset_id: str) -> Asset:
        key = asset_id[len(ASSET_PREFIX):] if asset_id.startswith(ASSET_PREFIX) else asset_id
        try:
            return self.assets[key]
        except KeyError as error:
            raise KeyError(f"no asset {asset_id!r} in {self.directory}") from error

    def of_kind(self, kind: str) -> list[Asset]:
        return [a for _, a in sorted(self.assets.items()) if a.kind == kind]

    def pixels(self, asset_id: str) -> Image:
        """The asset as float 0..1: (H, W) for grey, (H, W, 3|4) otherwise. Cached; do not modify."""
        asset = self.get(asset_id)
        with self._lock:
            cached = self._pixels.get(asset.id)
            if cached is None:
                with PILImage.open(self.directory / asset.file) as image:
                    image.load()
                    if image.mode not in ("L", "RGB", "RGBA"):
                        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                    cached = np.asarray(image, dtype=np.float32) / 255.0
                cached.setflags(write=False)
                self._pixels[asset.id] = cached
            return cached

    def texture(self, asset_id: str, size: tuple[int, int], scale: float = 1.0, offset: tuple[int, int] = (0, 0), keep_alpha: bool = False) -> Image:
        """The asset covering ``size = (width, height)``.

        Tileable assets repeat at ``scale`` x their native pixel size, starting at
        ``offset`` (x, y) into the tile; others are fitted to cover and centre cropped.
        Grey assets come back grey (H, W); colour ones RGB, or RGBA with ``keep_alpha``.
        """
        asset = self.get(asset_id)
        source = self.pixels(asset.id)
        if source.ndim == 3 and not keep_alpha:
            source = source[..., :3]
        w, h = size
        if asset.tileable:
            out = _tile(source, w, h, max(scale, 1e-3), offset)
        else:
            out = _cover(source, w, h)
        return np.ascontiguousarray(out, dtype=np.float32)


def _tile(source: Image, w: int, h: int, scale: float, offset: tuple[int, int]) -> Image:
    # The patch of the repeating pattern that maps onto the canvas, at native scale.
    sw, sh = max(int(math.ceil(w / scale)) + 1, 1), max(int(math.ceil(h / scale)) + 1, 1)
    th, tw = source.shape[:2]
    ox, oy = offset[0] % tw, offset[1] % th
    reps = (math.ceil((sh + oy) / th), math.ceil((sw + ox) / tw)) + ((1,) if source.ndim == 3 else ())
    patch = np.tile(source, reps)[oy : oy + sh, ox : ox + sw]
    if abs(scale - 1.0) < 1e-6:
        return patch[:h, :w]
    resized = cv2.resize(patch, (int(round(sw * scale)), int(round(sh * scale))), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    return resized[:h, :w]


def _cover(source: Image, w: int, h: int) -> Image:
    s = max(w / source.shape[1], h / source.shape[0])
    nw, nh = max(int(math.ceil(source.shape[1] * s)), w), max(int(math.ceil(source.shape[0] * s)), h)
    resized = cv2.resize(source, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    x0, y0 = (nw - w) // 2, (nh - h) // 2
    return np.clip(resized[y0 : y0 + h, x0 : x0 + w], 0.0, 1.0)


_default: AssetLibrary | None = None
_default_lock = threading.Lock()


def default_library() -> AssetLibrary:
    """The library in ``curio/assets`` (or ``$CURIO_ASSETS_DIR``), loaded once."""
    global _default
    with _default_lock:
        if _default is None:
            _default = AssetLibrary()
        return _default


def is_asset_reference(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(ASSET_PREFIX)

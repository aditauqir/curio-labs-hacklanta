#!/usr/bin/env python3
"""
Bakes the curio/assets textures used by the web reference looks (lib/reference-looks.ts)
into public/looks/, at the poster's 1080 x 1350 reference size.

Usage: python scripts/build-look-assets.py <curio/assets dir> [out dir]

The engine's rule is that assets are tiled at their reference pixel size, never stretched
(curio/assets/README.md). Baking the reference-size crop here means the browser draws each
file 1:1 on the 1080 x 1350 poster and never tiles or resamples a halftone screen. Larger
export sizes scale the finished poster, which is the same "resample by the same factor"
rule the engine follows.

Halftone threshold maps stay lossless PNG so dot edges stay exact. Grain, paper and
overlays are low-contrast textures and are stored as WebP.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

W, H = 1080, 1350

# Keep in sync with the asset ids referenced in lib/reference-looks.ts.
HALFTONES = [
    "ht_am_round_p7p8_a51",
    "ht_line_p13p8_h",
    "ht_dotgrain_p9p8_a0",
    "ht_ellipse_p14p4_a29",
    "ht_square_p15p3_a0",
]
TEXTURES = [
    "paper_uncoated_r4",
    "paper_aged_r5",
    "paper_ivory_r4",
    "grain_film_mono_std8",
    "grain_film_mono_std10",
    "grain_silver_gelatin_std12",
    "grain_silver_gelatin_std14",
    "grain_toner_grit_std8",
    "grain_chroma_std14p7",
    "grain_airbrush_halation_std10",
    "overlay_photocopy_creases_2",
    "overlay_photocopy_edge_blotch",
    "overlay_cloud_smoke_s41",
    "pattern_scanlines_crt_p4",
    "pattern_interference_rings_p5",
    "vec_wireframe_coordinate_grid",
]


def tile_to(a, h, w):
    reps = (-(-h // a.shape[0]), -(-w // a.shape[1])) + ((1,) if a.ndim == 3 else ())
    return np.tile(a, reps)[:h, :w]


def fit(im, h, w):
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x0, y0 = (im.width - w) // 2, (im.height - h) // 2
    return np.asarray(im.crop((x0, y0, x0 + w, y0 + h)))


def bake(root, by_id, asset_id):
    meta = by_id[asset_id]
    im = Image.open(root / meta["file"])
    if im.mode not in ("L", "RGB"):
        im = im.convert("L")
    arr = tile_to(np.asarray(im), H, W) if meta["tileable"] else fit(im, H, W)
    return Image.fromarray(arr), meta


def main():
    root = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "public" / "looks"
    out.mkdir(parents=True, exist_ok=True)
    by_id = {a["id"]: a for a in json.loads((root / "assets_manifest.json").read_text())["assets"]}

    record = []
    for asset_id in HALFTONES:
        im, meta = bake(root, by_id, asset_id)
        im.save(out / f"{asset_id}.png", optimize=True)
        record.append({"id": asset_id, "file": f"{asset_id}.png", "kind": meta["kind"], "license": meta.get("license", "CC0-1.0")})
    for asset_id in TEXTURES:
        im, meta = bake(root, by_id, asset_id)
        im.save(out / f"{asset_id}.webp", quality=82, method=6)
        record.append({"id": asset_id, "file": f"{asset_id}.webp", "kind": meta["kind"], "license": meta.get("license", "CC0-1.0")})

    (out / "manifest.json").write_text(
        json.dumps(
            {
                "note": "Baked from curio/assets by scripts/build-look-assets.py at the 1080x1350 reference size. Original procedural output, CC0-1.0.",
                "width": W,
                "height": H,
                "assets": record,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {len(record)} assets to {out}")


if __name__ == "__main__":
    main()

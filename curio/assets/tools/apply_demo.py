#!/usr/bin/env python3
"""
Reference implementations of how the backend should consume these assets, plus two preview renders:
  previews/contact_sheet.png   every asset at a glance (halftones shown on a tone ramp)
  previews/demo_styles.png     six recipe-style looks applied to a synthetic stand-in subject
The stand-in is a procedurally shaded bust: no real photo or person is used.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
MAN = json.loads((ROOT / "assets_manifest.json").read_text())
BY_ID = {a["id"]: a for a in MAN["assets"]}


# ------------------------------------------------------------------ consumption helpers (backend-ready)
def load(asset_id):
    a = np.asarray(Image.open(ROOT / BY_ID[asset_id]["file"]), dtype=np.float64)
    return a


def tile_to(m, h, w, offset=(0, 0)):
    """Tile (or crop) a map to (h, w). Works for any canvas size because tileable assets wrap seamlessly."""
    reps_y = -(-(h + offset[0]) // m.shape[0])
    reps_x = -(-(w + offset[1]) // m.shape[1])
    t = np.tile(m, (reps_y, reps_x) + ((1,) if m.ndim == 3 else ()))
    return t[offset[0]:offset[0] + h, offset[1]:offset[1] + w]


def halftone_apply(lum, asset_id, softness=1.5, offset=(0, 0)):
    """lum: 0..255 float (H,W). Returns light coverage 0..1 (1 = paper/light, 0 = ink)."""
    m = tile_to(load(asset_id), *lum.shape, offset=offset)
    return np.clip((lum - m) / softness + 0.5, 0.0, 1.0)


def fit(a, h, w):
    """Resize a non-tileable overlay to the canvas (cover)."""
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    s = max(w / im.width, h / im.height)
    im = im.resize((int(round(im.width * s)), int(round(im.height * s))), Image.LANCZOS)
    x0, y0 = (im.width - w) // 2, (im.height - h) // 2
    return np.asarray(im.crop((x0, y0, x0 + w, y0 + h)), dtype=np.float64)


def layer(asset_id, h, w):
    a = load(asset_id)
    return tile_to(a, h, w) if BY_ID[asset_id]["tileable"] else fit(a, h, w)


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64) / 255.0


def gradient_map(t, stops):
    """t 0..1 (H,W); stops [(pos, '#hex'), ...] -> (H,W,3) 0..1"""
    pos = np.array([s[0] for s in stops])
    cols = np.stack([hexrgb(s[1]) for s in stops])
    return np.stack([np.interp(t, pos, cols[:, c]) for c in range(3)], axis=-1)


def _rgb(x):
    return x[..., None] if x.ndim == 2 else x


def blend(base, top, mode, opacity):
    """base, top: float 0..1 (H,W,3) or top (H,W). Standard separable blend modes."""
    top = _rgb(top) if top.ndim == 2 else top
    if mode == "multiply":
        r = base * top
    elif mode == "screen":
        r = 1 - (1 - base) * (1 - top)
    elif mode == "overlay":
        r = np.where(base < 0.5, 2 * base * top, 1 - 2 * (1 - base) * (1 - top))
    elif mode == "soft_light":
        r = (1 - 2 * top) * base ** 2 + 2 * top * base
    else:
        r = top
    return base + (r - base) * opacity


def n01(a):
    return _rgb(a) / 255.0


# ------------------------------------------------------------------ stand-in subject
def stand_in(h=1280, w=1024):
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    cx, cy = w * 0.58, h * 0.46
    # head (ellipsoid) lit from upper-left
    rx, ry = w * 0.25, h * 0.27
    nx, ny = (x - cx) / rx, (y - cy) / ry
    r2 = nx ** 2 + ny ** 2
    head = r2 < 1
    nz = np.sqrt(np.clip(1 - r2, 0, 1))
    L = np.array([-0.55, -0.6, 0.58])
    L /= np.linalg.norm(L)
    lam = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    lum = np.full((h, w), 0.0)
    # background soft gradient
    lum = 0.30 + 0.35 * (1 - np.hypot((x - w * 0.3) / w, (y - h * 0.2) / h))
    # shoulders
    sh = ((x - cx) / (w * 0.52)) ** 2 + ((y - (cy + h * 0.55)) / (h * 0.30)) ** 2 < 1
    shl = 0.18 + 0.30 * np.clip(1 - np.hypot((x - w * 0.45) / (w * 0.5), (y - h * 0.82) / (h * 0.3)), 0, 1)
    lum = np.where(sh, shl, lum)
    # neck
    neck = (np.abs(x - cx) < w * 0.09) & (y > cy) & (y < cy + h * 0.38)
    lum = np.where(neck, 0.22 + 0.18 * (1 - (x - (cx - w * 0.09)) / (w * 0.18)), lum)
    lum = np.where(head, 0.12 + 0.88 * lam ** 0.9, lum)
    # eyes/mouth hints so the halftone has fine detail to chew on
    for ex in (-0.38, 0.38):
        e = ((x - (cx + ex * rx)) / (rx * 0.16)) ** 2 + ((y - (cy - 0.12 * ry)) / (ry * 0.05)) ** 2 < 1
        lum = np.where(e & head, 0.05, lum)
    m = ((x - cx) / (rx * 0.30)) ** 2 + ((y - (cy + 0.42 * ry)) / (ry * 0.045)) ** 2 < 1
    lum = np.where(m & head, 0.10, lum)
    lum = ndi.gaussian_filter(lum, 1.2)
    return np.clip(lum * 255.0, 0, 255)


# ------------------------------------------------------------------ looks (each follows its recipe's numbers)
def look_brat(lum):
    h, w = lum.shape
    t = np.clip((lum - 20) / 200.0, 0, 1) * 255
    light = halftone_apply(t, "ht_am_round_p7p8_a51")
    img = gradient_map(light, [(0, "#020602"), (1, "#90e908")])
    return blend(img, n01(layer("grain_film_mono_std8", h, w)), "overlay", 0.18)


def look_newsprint(lum):
    h, w = lum.shape
    light = halftone_apply(np.clip((lum - 10) * 1.1, 0, 255), "ht_line_p13p8_h", softness=2.5)
    img = gradient_map(light, [(0, "#080806"), (1, "#e0ded6")])
    img = blend(img, n01(layer("paper_newsprint_r5", h, w)), "multiply", 0.15)
    return blend(img, n01(layer("grain_silver_gelatin_std12", h, w)), "overlay", 0.22)


def look_crimson(lum):
    h, w = lum.shape
    light = halftone_apply(np.clip((lum - 15) * 1.15, 0, 255), "ht_ellipse_p14p4_a29", softness=2.0)
    img = gradient_map(light, [(0, "#101010"), (1, "#f81144")])
    img = blend(img, n01(layer("overlay_photocopy_creases_2", h, w)), "screen", 0.35)
    img = blend(img, n01(layer("overlay_photocopy_edge_blotch", h, w)), "multiply", 0.8)
    return blend(img, n01(layer("grain_toner_grit_std8", h, w)), "overlay", 0.20)


def look_amber_crt(lum):
    h, w = lum.shape
    t = np.clip((lum - 10) / 230.0, 0, 1)
    img = gradient_map(t, [(0, "#191818"), (0.35, "#a42d15"), (0.7, "#c45b13"), (1.0, "#f19614")])
    img = blend(img, n01(layer("pattern_scanlines_crt_p4", h, w)), "multiply", 1.0)
    img = blend(img, n01(layer("vec_wireframe_coordinate_grid", h, w)), "screen", 0.35)
    return blend(img, n01(layer("grain_film_mono_std8", h, w)), "overlay", 0.18)


def look_cobalt(lum):
    h, w = lum.shape
    t = np.clip((lum - 10) / 230.0, 0, 1)
    img = gradient_map(t, [(0, "#17364e"), (0.4, "#134fa4"), (0.75, "#a5586d"), (1.0, "#ebeef2")])
    img = blend(img, n01(layer("overlay_cloud_smoke_s41", h, w)), "soft_light", 0.45)
    return blend(img, n01(layer("grain_airbrush_halation_std10", h, w)), "overlay", 0.22)


def look_thermal(lum):
    h, w = lum.shape
    t = np.clip((lum - 10) / 230.0, 0, 1)
    img = gradient_map(t, [(0, "#101817"), (0.35, "#2c383c"), (0.6, "#0e7f96"), (0.85, "#bd2532"), (1.0, "#9d9d8e")])
    img = blend(img, n01(layer("pattern_interference_rings_p5", h, w)), "overlay", 0.30)
    img = blend(img, n01(layer("vec_sacred_flower_of_life", h, w)), "screen", 0.40)
    return blend(img, layer("grain_chroma_std14p7", h, w) / 255.0, "overlay", 0.30)


LOOKS = [
    ("brat duotone | ht_am_round 7.8px @ 51 deg", look_brat),
    ("newsprint | line screen 13.8px + paper + silver grain", look_newsprint),
    ("crimson photocopy | ellipse screen + creases + blotch", look_crimson),
    ("amber CRT | scanlines + HUD grid + grain", look_amber_crt),
    ("cosmic cobalt | cloud smoke + airbrush grain", look_cobalt),
    ("thermal rings | moire + flower of life + chroma noise", look_thermal),
]


def font(sz):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def to_img(x, dither=True, seed=0):
    """Final float(0..1) -> 8-bit. Triangular dither (+-1 LSB) removes gradient banding; always do this last."""
    v = x * 255.0
    if dither:
        rng = np.random.default_rng(seed)
        v = v + (rng.random(v.shape) - rng.random(v.shape))
    return Image.fromarray(np.clip(np.rint(v), 0, 255).astype(np.uint8))


def demo_sheet():
    lum = stand_in()
    tiles = []
    for name, fn in LOOKS:
        im = to_img(fn(lum))
        tiles.append((name, im))
    cw, ch, pad, lab = 640, 800, 20, 34
    cols = 3
    rows = 2
    sheet = Image.new("RGB", (cols * cw + (cols + 1) * pad, rows * (ch + lab) + (rows + 1) * pad), (24, 24, 24))
    dr = ImageDraw.Draw(sheet)
    f = font(15)
    for i, (name, im) in enumerate(tiles):
        r, c = divmod(i, cols)
        x = pad + c * (cw + pad)
        y = pad + r * (ch + lab + pad)
        sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
        dr.text((x, y + ch + 8), name, fill=(235, 235, 235), font=f)
    out = ROOT / "previews"
    out.mkdir(exist_ok=True)
    sheet.save(out / "demo_styles.png", optimize=True)
    # also the stand-in itself, for reference
    Image.fromarray(lum.astype(np.uint8)).save(out / "stand_in_subject.png", optimize=True)
    print("wrote previews/demo_styles.png")


def contact_sheet():
    tw, th, lab, pad, cols = 300, 240, 36, 16, 6
    items = MAN["assets"]
    rows = -(-len(items) // cols)
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * pad, rows * (th + lab) + (rows + 1) * pad), (24, 24, 24))
    dr = ImageDraw.Draw(sheet)
    f = font(12)
    ramp = np.tile(np.linspace(0, 255, tw)[None, :], (th, 1))
    for i, a in enumerate(items):
        r, c = divmod(i, cols)
        x = pad + c * (tw + pad)
        y = pad + r * (th + lab + pad)
        arr = load(a["id"])
        k = a["kind"]
        if k == "halftone_threshold":
            m = arr[:th, :tw]
            tile = np.clip((ramp - m) / 1.5 + 0.5, 0, 1) * 255          # tone ramp 0 -> 255 through the map
        elif k == "grain":
            x0 = arr[:th, :tw]
            tile = np.clip(128 + (x0 - 128) * 6, 0, 255)                # stretch contrast so grain is visible
        elif k == "paper":
            tile = np.clip((arr[:th, :tw] - 215) / (255 - 215) * 255, 0, 255)
        elif k == "pattern":
            cy, cx = arr.shape[0] // 2, arr.shape[1] // 2          # 1:1 centre crop (fine moire would average to grey if downscaled)
            tile = arr[cy:cy + th, cx:cx + tw]
        else:                                                           # non-tileable overlays / vectors: whole image, fitted
            im = Image.fromarray(np.clip(arr if arr.ndim == 2 else arr[..., :3].mean(-1) if arr.shape[-1] == 3 else arr[..., 3], 0, 255).astype(np.uint8))
            s = min(tw / im.width, th / im.height)
            im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
            canvas = Image.new("L", (tw, th), 12)
            canvas.paste(im, ((tw - im.width) // 2, (th - im.height) // 2))
            tile = np.asarray(canvas, dtype=np.float64)
        if tile.ndim == 3:
            tile = tile.mean(-1)
        if arr.ndim == 3 and k == "grain":
            tile = np.clip(128 + (arr[:th, :tw] - 128) * 6, 0, 255)
            img = Image.fromarray(tile.astype(np.uint8))
        else:
            img = Image.fromarray(np.clip(tile, 0, 255).astype(np.uint8)).convert("RGB")
        sheet.paste(img, (x, y))
        dr.text((x, y + th + 4), a["id"], fill=(235, 235, 235), font=f)
        dr.text((x, y + th + 18), "%s  |  %s" % (k, a["blend_hint"]), fill=(150, 150, 150), font=f)
    out = ROOT / "previews"
    out.mkdir(exist_ok=True)
    sheet.save(out / "contact_sheet.png", optimize=True)
    print("wrote previews/contact_sheet.png")


if __name__ == "__main__":
    contact_sheet()
    demo_sheet()

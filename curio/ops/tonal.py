"""Tonal and colour ops."""

from __future__ import annotations

import numpy as np
from scipy.interpolate import PchipInterpolator

from curio.core.color import hsv_to_rgb, linear_to_srgb, luma, rgb_to_hsv, srgb_to_linear
from curio.ops import Bool, Choice, Color, ColorList, Float, FloatList, Int, register_op
from curio.ops._util import gradient_lut, grey_rgb, hex_array, map_through_lut, smoothstep

_CH = {"r": 0, "g": 1, "b": 2}


def _channels(img: np.ndarray, which: str, fn) -> np.ndarray:
    """Applies ``fn`` to all channels, or to one."""
    if which == "rgb":
        return fn(img)
    out = img.copy()
    out[..., _CH[which]] = fn(img[..., _CH[which]])
    return out


@register_op(
    "levels",
    category="tonal",
    params=[
        Float("black", 0.0, 0.0, 0.99, "input black point"),
        Float("white", 1.0, 0.01, 1.0, "input white point"),
        Float("gamma", 1.0, 0.1, 5.0, "midtone gamma; above 1 brightens"),
        Float("out_black", 0.0, 0.0, 1.0),
        Float("out_white", 1.0, 0.0, 1.0),
        Choice("channel", "rgb", ["rgb", "r", "g", "b"]),
    ],
)
def levels(img, p, seed):
    """Input and output levels with a midtone gamma."""
    span = max(p.white - p.black, 1e-4)

    def fn(x):
        x = np.clip((x - p.black) / span, 0.0, 1.0) ** (1.0 / p.gamma)
        return p.out_black + x * (p.out_white - p.out_black)

    return _channels(img, p.channel, fn)


@register_op(
    "curves",
    category="tonal",
    params=[
        FloatList("points", [0.0, 0.0, 1.0, 1.0], 0.0, 1.0, min_items=4, max_items=32, doc="flat x,y pairs"),
        Choice("channel", "rgb", ["rgb", "r", "g", "b", "luma"]),
    ],
)
def curves(img, p, seed):
    """A smooth tone curve through control points (monotone cubic)."""
    pts = np.array(p.points, dtype=np.float64).reshape(-1, 2)
    pts = pts[np.argsort(pts[:, 0], kind="stable")]
    _, keep = np.unique(pts[:, 0], return_index=True)
    pts = pts[np.sort(keep)]
    if len(pts) < 2:
        return img
    grid = np.linspace(0.0, 1.0, 1024)
    table = np.clip(PchipInterpolator(pts[:, 0], pts[:, 1], extrapolate=True)(grid), 0.0, 1.0).astype(np.float32)

    def curve(x):
        return np.interp(np.clip(x, 0.0, 1.0), grid, table).astype(np.float32)

    if p.channel == "luma":
        y = luma(img)
        return img + (curve(y) - y)[..., None]
    return _channels(img, p.channel, curve)


@register_op(
    "brightness_contrast",
    category="tonal",
    params=[Float("brightness", 0.0, -1.0, 1.0), Float("contrast", 0.0, -1.0, 0.99)],
)
def brightness_contrast(img, p, seed):
    """Additive brightness and a contrast slope about mid grey."""
    slope = 1.0 / (1.0 - p.contrast) if p.contrast >= 0 else 1.0 + p.contrast
    return (img - 0.5) * slope + 0.5 + p.brightness


@register_op(
    "exposure",
    category="tonal",
    params=[Float("stops", 0.0, -4.0, 4.0), Float("offset", 0.0, -0.5, 0.5), Float("gamma", 1.0, 0.1, 5.0)],
)
def exposure(img, p, seed):
    """Exposure in stops, applied in linear light."""
    linear = srgb_to_linear(img) * (2.0 ** p.stops) + p.offset
    return np.clip(linear_to_srgb(np.clip(linear, 0.0, None)), 0.0, 1.0) ** (1.0 / p.gamma)


@register_op("hue_shift", category="tonal", params=[Float("degrees", 0.0, -180.0, 180.0)])
def hue_shift(img, p, seed):
    """Rotates hue."""
    hsv = rgb_to_hsv(img)
    hsv[..., 0] = (hsv[..., 0] + p.degrees / 360.0) % 1.0
    return hsv_to_rgb(hsv)


@register_op("saturation", category="tonal", params=[Float("amount", 0.0, -1.0, 3.0, "-1 greyscale, 0 unchanged")])
def saturation(img, p, seed):
    """Scales distance from grey."""
    y = luma(img)[..., None]
    return y + (img - y) * (1.0 + p.amount)


@register_op("vibrance", category="tonal", params=[Float("amount", 0.0, -1.0, 2.0)])
def vibrance(img, p, seed):
    """Saturation that favours muted colours and protects saturated ones."""
    s = rgb_to_hsv(img)[..., 1:2]
    y = luma(img)[..., None]
    return y + (img - y) * (1.0 + p.amount * (1.0 - s))


@register_op(
    "color_balance",
    category="tonal",
    params=[
        FloatList("shadows", [0.0, 0.0, 0.0], -1.0, 1.0, min_items=3, max_items=3, doc="r,g,b shift"),
        FloatList("midtones", [0.0, 0.0, 0.0], -1.0, 1.0, min_items=3, max_items=3),
        FloatList("highlights", [0.0, 0.0, 0.0], -1.0, 1.0, min_items=3, max_items=3),
    ],
)
def color_balance(img, p, seed):
    """Tints shadows, midtones and highlights independently."""
    y = luma(img)[..., None]
    w_shadow, w_high = (1.0 - y) ** 2, y**2
    w_mid = np.clip(4.0 * y * (1.0 - y), 0.0, 1.0)
    shift = (
        w_shadow * np.array(p.shadows, np.float32)
        + w_mid * np.array(p.midtones, np.float32)
        + w_high * np.array(p.highlights, np.float32)
    )
    return img + 0.25 * shift


@register_op(
    "desaturate",
    category="tonal",
    params=[
        Choice("method", "luma", ["luma", "average", "lightness", "red", "green", "blue"]),
        Float("amount", 1.0, 0.0, 1.0),
    ],
)
def desaturate(img, p, seed):
    """Greyscale with a choice of conversion."""
    if p.method == "luma":
        gray = luma(img)
    elif p.method == "average":
        gray = img.mean(axis=2)
    elif p.method == "lightness":
        gray = (img.max(axis=2) + img.min(axis=2)) / 2.0
    else:
        gray = img[..., _CH[p.method[0]]]
    return img + (grey_rgb(gray) - img) * p.amount


@register_op(
    "threshold",
    category="tonal",
    params=[
        Float("cutoff", 0.5, 0.0, 1.0),
        Float("softness", 0.0, 0.0, 0.5, "edge width; 0 is a hard cut"),
        Bool("invert", False),
        Color("dark", "#000000"),
        Color("light", "#FFFFFF"),
    ],
)
def threshold(img, p, seed):
    """Reduces the image to two colours at a luminance cutoff."""
    y = luma(img)
    t = smoothstep(p.cutoff - p.softness, p.cutoff + p.softness, y) if p.softness > 0 else (y >= p.cutoff).astype(np.float32)
    if p.invert:
        t = 1.0 - t
    dark, light = hex_array([p.dark, p.light])
    return dark + (light - dark) * t[..., None]


@register_op("posterize", category="tonal", params=[Int("levels", 4, 2, 64)])
def posterize(img, p, seed):
    """Quantises each channel to a number of levels."""
    n = p.levels - 1
    return np.round(img * n) / n


@register_op(
    "gradient_map",
    category="tonal",
    params=[
        ColorList("stops", ["#000000", "#FFFFFF"], 2, 16, "shadow to highlight"),
        FloatList("positions", [], 0.0, 1.0, min_items=0, max_items=16, doc="optional, one per stop"),
        Float("strength", 1.0, 0.0, 1.0),
    ],
)
def gradient_map(img, p, seed):
    """Maps luminance through a colour ramp."""
    mapped = map_through_lut(luma(img), gradient_lut(p.stops, p.positions))
    return img + (mapped - img) * p.strength


@register_op(
    "duotone",
    category="tonal",
    params=[
        Color("shadow", "#1B1340"),
        Color("highlight", "#FFB36B"),
        Float("contrast", 0.0, -0.9, 0.9),
        Float("midpoint", 0.5, 0.05, 0.95, "where the mid tone sits"),
    ],
)
def duotone(img, p, seed):
    """Two-colour tone mapping of luminance."""
    y = luma(img)
    gamma = np.log(0.5) / np.log(p.midpoint)
    y = np.clip(y, 0.0, 1.0) ** gamma
    slope = 1.0 / (1.0 - p.contrast) if p.contrast >= 0 else 1.0 + p.contrast
    y = np.clip((y - 0.5) * slope + 0.5, 0.0, 1.0)
    return map_through_lut(y, gradient_lut([p.shadow, p.highlight]))


@register_op(
    "tritone",
    category="tonal",
    params=[
        Color("shadow", "#101820"),
        Color("midtone", "#D8784C"),
        Color("highlight", "#F6E7CB"),
        Float("mid_position", 0.5, 0.1, 0.9),
    ],
)
def tritone(img, p, seed):
    """Three-colour tone mapping of luminance."""
    lut = gradient_lut([p.shadow, p.midtone, p.highlight], [0.0, p.mid_position, 1.0])
    return map_through_lut(luma(img), lut)


@register_op(
    "channel_mixer",
    category="tonal",
    params=[
        FloatList("matrix", [1, 0, 0, 0, 1, 0, 0, 0, 1], -2.0, 2.0, min_items=9, max_items=9, doc="rows: out R, G, B"),
        Bool("monochrome", False),
    ],
)
def channel_mixer(img, p, seed):
    """Mixes input channels into each output channel."""
    m = np.array(p.matrix, dtype=np.float32).reshape(3, 3)
    out = img @ m.T
    if p.monochrome:
        out = grey_rgb(out[..., 0])
    return out


@register_op("invert", category="tonal", params=[Choice("channel", "rgb", ["rgb", "r", "g", "b"])])
def invert(img, p, seed):
    """Inverts all channels, or one."""
    return _channels(img, p.channel, lambda x: 1.0 - x)

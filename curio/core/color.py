"""Colour utilities: hex, luminance, HSV, CIELAB, WCAG contrast.

All array functions are vectorised and accept ``(..., 3)`` float arrays in the
sRGB encoding unless the name says ``linear``.
"""

from __future__ import annotations

import re

import numpy as np

_HEX = re.compile(r"^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")

LUMA_WEIGHTS = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def parse_hex(value: str) -> tuple[float, float, float]:
    """``#RRGGBB`` or ``#RGB`` to floats in [0, 1]. Raises ValueError otherwise."""
    match = _HEX.match(value.strip()) if isinstance(value, str) else None
    if not match:
        raise ValueError(f"not a hex colour: {value!r}")
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    return tuple(int(digits[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def to_hex(rgb: tuple[float, float, float] | np.ndarray) -> str:
    values = [int(round(min(max(float(v), 0.0), 1.0) * 255)) for v in rgb[:3]]
    return "#{:02X}{:02X}{:02X}".format(*values)


def is_hex(value: object) -> bool:
    return isinstance(value, str) and bool(_HEX.match(value.strip()))


def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float32)
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb(rgb: np.ndarray) -> np.ndarray:
    rgb = np.clip(np.asarray(rgb, dtype=np.float32), 0.0, None)
    return np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055).astype(np.float32)


def luma(rgb: np.ndarray) -> np.ndarray:
    """Perceptual brightness of encoded sRGB, as used by tonal operations."""
    return (np.asarray(rgb, dtype=np.float32)[..., :3] @ LUMA_WEIGHTS).astype(np.float32)


def relative_luminance(rgb: np.ndarray) -> np.ndarray:
    """WCAG relative luminance (computed in linear light)."""
    return (srgb_to_linear(np.asarray(rgb)[..., :3]) @ LUMA_WEIGHTS).astype(np.float32)


def contrast_ratio(a: np.ndarray | tuple[float, float, float], b: np.ndarray | tuple[float, float, float]) -> float | np.ndarray:
    """WCAG contrast ratio between two colours, 1 (none) to 21 (black on white)."""
    la = relative_luminance(np.asarray(a, dtype=np.float32))
    lb = relative_luminance(np.asarray(b, dtype=np.float32))
    hi, lo = np.maximum(la, lb), np.minimum(la, lb)
    ratio = (hi + 0.05) / (lo + 0.05)
    return float(ratio) if np.ndim(ratio) == 0 else ratio


def rgb_to_hsv(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    maxc = np.max(rgb[..., :3], axis=-1)
    minc = np.min(rgb[..., :3], axis=-1)
    delta = maxc - minc
    safe = np.where(delta == 0, 1.0, delta)

    h = np.zeros_like(maxc)
    h = np.where(maxc == r, ((g - b) / safe) % 6.0, h)
    h = np.where(maxc == g, (b - r) / safe + 2.0, h)
    h = np.where(maxc == b, (r - g) / safe + 4.0, h)
    h = np.where(delta == 0, 0.0, h) / 6.0
    s = np.where(maxc == 0, 0.0, delta / np.where(maxc == 0, 1.0, maxc))
    return np.stack([h % 1.0, s, maxc], axis=-1).astype(np.float32)


def hsv_to_rgb(hsv: np.ndarray) -> np.ndarray:
    hsv = np.asarray(hsv, dtype=np.float32)
    h, s, v = hsv[..., 0] % 1.0, np.clip(hsv[..., 1], 0, 1), np.clip(hsv[..., 2], 0, 1)
    i = np.floor(h * 6.0).astype(np.int32)
    f = h * 6.0 - i
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    i = i % 6
    conditions = [i == 0, i == 1, i == 2, i == 3, i == 4, i == 5]
    r = np.select(conditions, [v, q, p, p, t, v])
    g = np.select(conditions, [t, v, v, q, p, p])
    b = np.select(conditions, [p, p, t, v, v, q])
    return np.stack([r, g, b], axis=-1).astype(np.float32)


_M_RGB_TO_XYZ = np.array(
    [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]],
    dtype=np.float64,
)
_M_XYZ_TO_RGB = np.linalg.inv(_M_RGB_TO_XYZ)
_WHITE_D65 = np.array([0.95047, 1.0, 1.08883], dtype=np.float64)
_EPS, _KAPPA = 216 / 24389, 24389 / 27


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB [0,1] to CIELAB (D65). Used for palette distance."""
    linear = srgb_to_linear(np.asarray(rgb)[..., :3]).astype(np.float64)
    xyz = (linear @ _M_RGB_TO_XYZ.T) / _WHITE_D65
    f = np.where(xyz > _EPS, np.cbrt(xyz), (_KAPPA * xyz + 16) / 116)
    lab = np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)
    return lab.astype(np.float32)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    lab = np.asarray(lab, dtype=np.float64)
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f**3 > _EPS, f**3, (116 * f - 16) / _KAPPA) * _WHITE_D65
    linear = xyz @ _M_XYZ_TO_RGB.T
    return np.clip(linear_to_srgb(np.clip(linear, 0, 1)), 0, 1).astype(np.float32)


def delta_e_2000(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """CIEDE2000 colour difference (Sharma, Wu, Dalal 2005), vectorised."""
    lab1 = np.asarray(lab1, dtype=np.float64)
    lab2 = np.asarray(lab2, dtype=np.float64)
    l1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    l2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]

    c1, c2 = np.hypot(a1, b1), np.hypot(a2, b2)
    c_bar = (c1 + c2) / 2
    g = 0.5 * (1 - np.sqrt(c_bar**7 / (c_bar**7 + 25**7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360

    dlp = l2 - l1
    dcp = c2p - c1p
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh))
    dh = np.where(c1p * c2p == 0, 0, dh)
    dhp = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh) / 2)

    lp = (l1 + l2) / 2
    cp = (c1p + c2p) / 2
    hsum = h1p + h2p
    hp = np.where(
        c1p * c2p == 0,
        hsum,
        np.where(np.abs(h1p - h2p) <= 180, hsum / 2, np.where(hsum < 360, (hsum + 360) / 2, (hsum - 360) / 2)),
    )
    t = (
        1
        - 0.17 * np.cos(np.radians(hp - 30))
        + 0.24 * np.cos(np.radians(2 * hp))
        + 0.32 * np.cos(np.radians(3 * hp + 6))
        - 0.20 * np.cos(np.radians(4 * hp - 63))
    )
    sl = 1 + 0.015 * (lp - 50) ** 2 / np.sqrt(20 + (lp - 50) ** 2)
    sc = 1 + 0.045 * cp
    sh = 1 + 0.015 * cp * t
    d_theta = 30 * np.exp(-(((hp - 275) / 25) ** 2))
    rc = 2 * np.sqrt(cp**7 / (cp**7 + 25**7))
    rt = -np.sin(np.radians(2 * d_theta)) * rc
    return np.sqrt((dlp / sl) ** 2 + (dcp / sc) ** 2 + (dhp / sh) ** 2 + rt * (dcp / sc) * (dhp / sh)).astype(np.float32)

"""Detail and screening ops: halftone, dithering, sharpening, blur, edges."""

from __future__ import annotations

import cv2
import numpy as np

from curio.core.color import luma
from curio.core.seed import rng
from curio.ops import Bool, Choice, Color, Float, Int, register_op
from curio.ops._util import grey_rgb, hex_array, odd, smoothstep

# ------------------------------------------------------------------ halftone

_R_GRID = np.linspace(0.0, np.sqrt(2.0) / 2.0, 2048, dtype=np.float64)


def _circle_area_in_unit_cell(r: np.ndarray) -> np.ndarray:
    """Area of a circle of radius r centred in a unit square, clipped to the square."""
    inside = np.pi * r**2
    over = r > 0.5
    rr = np.where(over, r, 0.5)
    segments = 4.0 * (rr**2 * np.arccos(0.5 / rr) - 0.5 * np.sqrt(np.maximum(rr**2 - 0.25, 0.0)))
    return np.where(over, inside - segments, inside)


_AREA_GRID = _circle_area_in_unit_cell(_R_GRID)

_PLATES = {  # ink colours for the four process plates, with their screen angles
    "c": ((0.0, 0.68, 0.94), 15.0),
    "m": ((0.93, 0.0, 0.55), 75.0),
    "y": ((1.0, 0.95, 0.0), 0.0),
    "k": ((0.0, 0.0, 0.0), 45.0),
}


def _spot(shape: str, fu: np.ndarray, fv: np.ndarray) -> np.ndarray:
    """Spot function in [0, 1]: a pixel is inked once tone coverage exceeds it."""
    if shape == "square":
        return (2.0 * np.maximum(np.abs(fu), np.abs(fv))) ** 2
    if shape == "line":
        return 2.0 * np.abs(fv)
    r = np.sqrt(fu**2 + ((fv * 1.5) ** 2 if shape == "ellipse" else fv**2))
    return np.interp(np.minimum(r, _R_GRID[-1]), _R_GRID, _AREA_GRID)


def _screen_plate(coverage: np.ndarray, shape: str, pitch: float, angle_deg: float, dot_gain: float, antialias: bool) -> np.ndarray:
    """Returns the ink coverage (0..1) of one halftone plate."""
    h, w = coverage.shape
    sigma = max(pitch * 0.4, 0.5)
    tone = cv2.GaussianBlur(coverage, (0, 0), sigma)
    tone = np.clip(tone + dot_gain * 4.0 * tone * (1.0 - tone), 0.0, 1.0)

    theta = np.radians(angle_deg)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u = (np.cos(theta) * xs + np.sin(theta) * ys) / pitch
    v = (-np.sin(theta) * xs + np.cos(theta) * ys) / pitch
    fu, fv = u - np.round(u), v - np.round(v)

    spot = _spot(shape, fu, fv).astype(np.float32)
    if antialias:
        return smoothstep(-1.2 / pitch, 1.2 / pitch, tone - spot)
    return (tone >= spot).astype(np.float32)


@register_op(
    "halftone_screen",
    category="screening",
    params=[
        Choice("shape", "round", ["round", "square", "ellipse", "line"]),
        Float("pitch_px", 8.0, 2.0, 200.0, "distance between dot centres"),
        Float("angle_deg", 45.0, -90.0, 90.0),
        Float("dot_gain", 0.1, 0.0, 0.5, "extra coverage in the mid tones"),
        Choice("mode", "mono", ["mono", "cmyk"]),
        Color("ink", "#000000"),
        Color("paper", "#FFFFFF"),
        Bool("antialias", True),
    ],
)
def halftone_screen(img, p, seed):
    """AM halftone: a regular screen whose dot size follows tone. Multi-angle in CMYK mode."""
    paper = np.array(hex_array([p.paper])[0], dtype=np.float32)

    if p.mode == "mono":
        coverage = 1.0 - luma(img)
        ink = hex_array([p.ink])[0]
        plate = _screen_plate(coverage, p.shape, p.pitch_px, p.angle_deg, p.dot_gain, p.antialias)
        return paper + (ink - paper) * plate[..., None]

    k = 1.0 - img.max(axis=2)
    denom = np.maximum(1.0 - k, 1e-4)
    channels = {
        "c": (1.0 - img[..., 0] - k) / denom,
        "m": (1.0 - img[..., 1] - k) / denom,
        "y": (1.0 - img[..., 2] - k) / denom,
        "k": k,
    }
    out = np.broadcast_to(paper, img.shape).copy()
    offset = p.angle_deg - 45.0
    for name, (ink_rgb, base_angle) in _PLATES.items():
        plate = _screen_plate(np.clip(channels[name], 0.0, 1.0), p.shape, p.pitch_px, base_angle + offset, p.dot_gain, p.antialias)
        out *= 1.0 - plate[..., None] * (1.0 - np.array(ink_rgb, dtype=np.float32))
    return out


# ----------------------------------------------------------------- dithering


def _bayer(n: int) -> np.ndarray:
    m = np.array([[0, 2], [3, 1]], dtype=np.float32)
    while m.shape[0] < n:
        m = np.block([[4 * m, 4 * m + 2], [4 * m + 3, 4 * m + 1]])
    return (m + 0.5) / (n * n)


def _quantise(img: np.ndarray, levels: int, threshold_map: np.ndarray) -> np.ndarray:
    scaled = img * (levels - 1)
    base = np.floor(scaled)
    return np.clip((base + ((scaled - base) > threshold_map[..., None])) / (levels - 1), 0.0, 1.0)


@register_op(
    "ordered_dither",
    category="screening",
    params=[
        Choice("matrix", "bayer4", ["bayer2", "bayer4", "bayer8"]),
        Int("levels", 2, 2, 16, "output levels per channel"),
        Choice("mode", "mono", ["mono", "color"]),
        Color("ink", "#000000"),
        Color("paper", "#FFFFFF"),
    ],
)
def ordered_dither(img, p, seed):
    """Bayer-matrix dithering."""
    h, w = img.shape[:2]
    n = int(p.matrix[-1])
    tile = np.tile(_bayer(n), (h // n + 1, w // n + 1))[:h, :w]
    if p.mode == "color":
        return _quantise(img, p.levels, tile)
    steps = _quantise(grey_rgb(luma(img)), p.levels, tile)[..., 0]
    ink, paper = hex_array([p.ink, p.paper])
    return ink + (paper - ink) * steps[..., None]


@register_op(
    "stochastic_dither",
    category="screening",
    stochastic=True,
    params=[
        Float("amount", 1.0, 0.0, 1.0, "0 is a hard threshold, 1 is fully random"),
        Int("levels", 2, 2, 16),
        Choice("mode", "mono", ["mono", "color"]),
        Color("ink", "#000000"),
        Color("paper", "#FFFFFF"),
    ],
)
def stochastic_dither(img, p, seed):
    """Dithering against seeded random thresholds."""
    h, w = img.shape[:2]
    noise = rng(seed, "stochastic_dither").random((h, w), dtype=np.float32)
    thresholds = 0.5 + (noise - 0.5) * p.amount
    if p.mode == "color":
        return _quantise(img, p.levels, thresholds)
    steps = _quantise(grey_rgb(luma(img)), p.levels, thresholds)[..., 0]
    ink, paper = hex_array([p.ink, p.paper])
    return ink + (paper - ink) * steps[..., None]


@register_op(
    "bitmap_threshold",
    category="screening",
    params=[
        Choice("method", "global", ["global", "adaptive"]),
        Float("cutoff", 0.5, 0.0, 1.0),
        Int("block_size", 31, 3, 301, "adaptive: neighbourhood size"),
        Float("offset", 0.05, -0.5, 0.5, "adaptive: bias against the local mean"),
        Color("ink", "#000000"),
        Color("paper", "#FFFFFF"),
    ],
)
def bitmap_threshold(img, p, seed):
    """Two-colour bitmap, with a global or locally adaptive cutoff."""
    y = luma(img)
    if p.method == "global":
        bits = (y >= p.cutoff).astype(np.float32)
    else:
        gray = np.ascontiguousarray(np.clip(y * 255.0, 0, 255).astype(np.uint8))
        bits = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, odd(p.block_size, 3), p.offset * 255.0).astype(np.float32) / 255.0
    ink, paper = hex_array([p.ink, p.paper])
    return ink + (paper - ink) * bits[..., None]


# ----------------------------------------------------------- sharpen and blur


@register_op("sharpen", category="screening", params=[Float("amount", 1.0, 0.0, 3.0)])
def sharpen(img, p, seed):
    """A 3x3 sharpen kernel scaled by ``amount``."""
    k = np.array([[0, -1, 0], [-1, 4, -1], [0, -1, 0]], dtype=np.float32) * p.amount
    k[1, 1] += 1.0
    return cv2.filter2D(img, -1, k, borderType=cv2.BORDER_REFLECT)


@register_op(
    "unsharp_mask",
    category="screening",
    params=[Float("amount", 1.0, 0.0, 5.0), Float("radius", 2.0, 0.1, 50.0), Float("threshold", 0.0, 0.0, 0.5)],
)
def unsharp_mask(img, p, seed):
    """Sharpens by adding back the difference from a blurred copy."""
    blurred = cv2.GaussianBlur(img, (0, 0), p.radius)
    diff = img - blurred
    if p.threshold > 0:
        diff = np.where(np.abs(diff) >= p.threshold, diff, 0.0)
    return img + diff * p.amount


@register_op(
    "blur",
    category="screening",
    params=[
        Choice("kind", "gaussian", ["gaussian", "motion"]),
        Float("radius", 2.0, 0.0, 100.0, "gaussian sigma, or half the motion length, in pixels"),
        Float("angle_deg", 0.0, -180.0, 180.0, "motion direction"),
    ],
)
def blur(img, p, seed):
    """Gaussian or motion blur."""
    if p.radius <= 0:
        return img
    if p.kind == "gaussian":
        return cv2.GaussianBlur(img, (0, 0), p.radius)
    size = odd(p.radius * 2.0 + 1.0, 3)
    kernel = np.zeros((size, size), dtype=np.float32)
    c = size // 2
    dx, dy = np.cos(np.radians(p.angle_deg)), -np.sin(np.radians(p.angle_deg))
    cv2.line(kernel, (int(round(c - dx * c)), int(round(c - dy * c))), (int(round(c + dx * c)), int(round(c + dy * c))), 1.0, 1, cv2.LINE_AA)
    kernel /= max(float(kernel.sum()), 1e-6)
    return cv2.filter2D(img, -1, kernel, borderType=cv2.BORDER_REFLECT)


@register_op(
    "edge_detect",
    category="screening",
    params=[
        Choice("method", "sobel", ["sobel", "laplacian", "canny"]),
        Float("strength", 1.0, 0.0, 4.0),
        Float("low", 0.1, 0.0, 1.0, "canny low threshold"),
        Float("high", 0.3, 0.0, 1.0, "canny high threshold"),
        Choice("output", "edges", ["edges", "overlay"]),
        Bool("invert", False),
    ],
)
def edge_detect(img, p, seed):
    """Edge map as white lines on black, or dark lines laid over the image."""
    y = np.ascontiguousarray(luma(img))
    if p.method == "sobel":
        edges = np.hypot(cv2.Sobel(y, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(y, cv2.CV_32F, 0, 1, ksize=3)) / 4.0
    elif p.method == "laplacian":
        edges = np.abs(cv2.Laplacian(y, cv2.CV_32F, ksize=3)) / 4.0
    else:
        gray = np.clip(y * 255.0, 0, 255).astype(np.uint8)
        edges = cv2.Canny(gray, p.low * 255.0, p.high * 255.0).astype(np.float32) / 255.0
    edges = np.clip(edges * p.strength, 0.0, 1.0)

    if p.output == "edges":
        plane = 1.0 - edges if p.invert else edges
        return grey_rgb(plane)
    lines = edges[..., None]
    return img + (1.0 - img) * lines if p.invert else img * (1.0 - lines)

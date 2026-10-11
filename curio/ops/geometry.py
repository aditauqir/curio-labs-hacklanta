"""Geometry and masking ops: crop, resize, rotate, flip, perspective, mask,
feather, stroke, drop shadow."""

from __future__ import annotations

import cv2
import numpy as np

from curio.core.color import luma, rgb_to_lab
from curio.ops import Bool, Choice, Color, Float, FloatList, Int, register_op
from curio.ops._util import hex_array, odd, smoothstep

_INTERP = {
    "lanczos": cv2.INTER_LANCZOS4,
    "cubic": cv2.INTER_CUBIC,
    "linear": cv2.INTER_LINEAR,
    "area": cv2.INTER_AREA,
    "nearest": cv2.INTER_NEAREST,
}


def _with_alpha(img: np.ndarray) -> np.ndarray:
    if img.shape[2] == 4:
        return img
    return np.concatenate([img, np.ones(img.shape[:2] + (1,), np.float32)], axis=2)


def _premultiply(img: np.ndarray) -> np.ndarray:
    out = img.copy()
    if img.shape[2] == 4:
        out[..., :3] *= out[..., 3:4]
    return out


def _unpremultiply(img: np.ndarray) -> np.ndarray:
    if img.shape[2] != 4:
        return img
    out = img.copy()
    a = np.maximum(out[..., 3:4], 1e-6)
    out[..., :3] = np.where(out[..., 3:4] > 1e-6, out[..., :3] / a, 0.0)
    return out


def _resize(img: np.ndarray, width: int, height: int, interpolation: int) -> np.ndarray:
    """Resizes with premultiplied alpha so edges do not pick up dark fringes."""
    out = cv2.resize(_premultiply(img), (max(width, 1), max(height, 1)), interpolation=interpolation)
    return np.clip(_unpremultiply(out), 0.0, 1.0)


# -------------------------------------------------------------------- crop


@register_op(
    "crop",
    category="geometry",
    changes_size=True,
    params=[
        Choice("mode", "rect", ["rect", "focus", "thirds"]),
        Float("x", 0.0, 0.0, 1.0, "rect: left edge, fraction of width"),
        Float("y", 0.0, 0.0, 1.0),
        Float("width", 1.0, 0.01, 1.0),
        Float("height", 1.0, 0.01, 1.0),
        Float("aspect", 0.8, 0.1, 10.0, "focus/thirds: output width over height"),
        Float("focus_x", 0.5, 0.0, 1.0, "focus/thirds: subject position, fraction of width"),
        Float("focus_y", 0.5, 0.0, 1.0),
        Float("zoom", 1.0, 1.0, 8.0, "focus/thirds: 1 is the largest window that fits"),
    ],
)
def crop(img, p, seed):
    """Crops to a rectangle, around a focus point, or with the subject on a thirds line."""
    h, w = img.shape[:2]

    if p.mode == "rect":
        x0, y0 = int(round(p.x * w)), int(round(p.y * h))
        x1, y1 = min(w, x0 + max(int(round(p.width * w)), 1)), min(h, y0 + max(int(round(p.height * h)), 1))
        return img[y0:y1, x0:x1]

    # Largest window of the requested aspect that fits, then shrunk by zoom.
    cw = min(w, h * p.aspect)
    ch = cw / p.aspect
    cw, ch = max(cw / p.zoom, 1.0), max(ch / p.zoom, 1.0)

    fx, fy = p.focus_x * w, p.focus_y * h
    if p.mode == "focus":
        x0, y0 = fx - cw / 2.0, fy - ch / 2.0
    else:
        tx = 1.0 / 3.0 if p.focus_x < 0.5 else 2.0 / 3.0
        ty = 1.0 / 3.0 if p.focus_y < 0.5 else 2.0 / 3.0
        x0, y0 = fx - tx * cw, fy - ty * ch

    x0 = int(round(min(max(x0, 0.0), w - cw)))
    y0 = int(round(min(max(y0, 0.0), h - ch)))
    return img[y0 : y0 + int(round(ch)), x0 : x0 + int(round(cw))]


# ------------------------------------------------------------------ resize


@register_op(
    "resize",
    category="geometry",
    changes_size=True,
    params=[
        Int("width", 0, 0, 32000, "0 means derive from the other settings"),
        Int("height", 0, 0, 32000),
        Float("scale", 1.0, 0.01, 16.0, "used when width and height are both 0"),
        Choice("fit", "stretch", ["stretch", "cover", "contain"], "when both width and height are set"),
        Choice("resample", "lanczos", list(_INTERP)),
        Color("fill", "#FFFFFF", "contain: padding colour for RGB images"),
    ],
)
def resize(img, p, seed):
    """Resizes by size, aspect-preserving width or height, or a scale factor."""
    h, w = img.shape[:2]
    interp = _INTERP[p.resample]

    if p.width and p.height:
        tw, th = p.width, p.height
        if p.fit == "stretch":
            return _resize(img, tw, th, interp)
        scale = max(tw / w, th / h) if p.fit == "cover" else min(tw / w, th / h)
        scaled = _resize(img, int(round(w * scale)), int(round(h * scale)), interp)
        sh, sw = scaled.shape[:2]
        if p.fit == "cover":
            x0, y0 = (sw - tw) // 2, (sh - th) // 2
            return scaled[y0 : y0 + th, x0 : x0 + tw]
        pad = np.zeros((th, tw, img.shape[2]), dtype=np.float32)
        if img.shape[2] == 3:
            pad[...] = hex_array([p.fill])[0]
        x0, y0 = (tw - sw) // 2, (th - sh) // 2
        pad[y0 : y0 + sh, x0 : x0 + sw] = scaled
        return pad
    if p.width:
        return _resize(img, p.width, int(round(h * p.width / w)), interp)
    if p.height:
        return _resize(img, int(round(w * p.height / h)), p.height, interp)
    return _resize(img, int(round(w * p.scale)), int(round(h * p.scale)), interp)


# ---------------------------------------------------------- rotate and flip


@register_op(
    "rotate",
    category="geometry",
    changes_size=True,
    params=[
        Float("angle_deg", 0.0, -180.0, 180.0, "counter-clockwise"),
        Bool("expand", True, "grow the canvas so nothing is cut off"),
        Color("fill", "#FFFFFF", "background for RGB images; RGBA images get transparency"),
    ],
)
def rotate(img, p, seed):
    """Rotates about the centre."""
    h, w = img.shape[:2]
    matrix = cv2.getRotationMatrix2D(((w - 1) / 2.0, (h - 1) / 2.0), p.angle_deg, 1.0)
    out_w, out_h = w, h
    if p.expand:
        cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
        # Round before ceil: cos(90 degrees) is ~6e-17, which would otherwise
        # push an exact 20.0 up to 21 and grow the canvas by a pixel.
        out_w, out_h = int(np.ceil(round(h * sin + w * cos, 6))), int(np.ceil(round(h * cos + w * sin, 6)))
        # Pixel centres sit at (n - 1) / 2; using n / 2 shifts the image half a pixel.
        matrix[0, 2] += (out_w - 1) / 2.0 - (w - 1) / 2.0
        matrix[1, 2] += (out_h - 1) / 2.0 - (h - 1) / 2.0

    has_alpha = img.shape[2] == 4
    src = _premultiply(img)
    border = (0.0, 0.0, 0.0, 0.0) if has_alpha else tuple(float(v) for v in hex_array([p.fill])[0])
    out = cv2.warpAffine(src, matrix, (out_w, out_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=border)
    return np.clip(_unpremultiply(out), 0.0, 1.0)


@register_op("flip", category="geometry", params=[Bool("horizontal", False), Bool("vertical", False)])
def flip(img, p, seed):
    """Mirrors the image."""
    out = img
    if p.horizontal:
        out = out[:, ::-1]
    if p.vertical:
        out = out[::-1]
    return np.ascontiguousarray(out)


@register_op(
    "perspective",
    category="geometry",
    uses_alpha=True,
    params=[
        FloatList(
            "corners",
            [0.0] * 8,
            -0.5,
            0.5,
            min_items=8,
            max_items=8,
            doc="dx,dy offsets as fractions of width/height for top-left, top-right, bottom-right, bottom-left",
        ),
        Color("fill", "#FFFFFF"),
    ],
)
def perspective(img, p, seed):
    """Moves the four corners to skew the image in perspective."""
    h, w = img.shape[:2]
    src = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    offsets = np.array(p.corners, dtype=np.float32).reshape(4, 2) * np.array([w, h], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(src, src + offsets)
    has_alpha = img.shape[2] == 4
    border = (0.0, 0.0, 0.0, 0.0) if has_alpha else tuple(float(v) for v in hex_array([p.fill])[0])
    out = cv2.warpPerspective(_premultiply(img), matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=border)
    return np.clip(_unpremultiply(out), 0.0, 1.0)


# --------------------------------------------------------- masks and edges


def _alpha_of(img: np.ndarray) -> np.ndarray:
    return img[..., 3] if img.shape[2] == 4 else np.ones(img.shape[:2], np.float32)


@register_op(
    "mask",
    category="masking",
    outputs_alpha=True,
    params=[
        Choice("kind", "luminance", ["luminance", "color_key", "ellipse", "rect", "linear_gradient"]),
        Float("low", 0.0, 0.0, 1.0, "luminance: bottom of the kept range"),
        Float("high", 0.5, 0.0, 1.0, "luminance: top of the kept range"),
        Color("key", "#00FF00", "color_key: colour to key"),
        Float("tolerance", 20.0, 0.0, 100.0, "color_key: CIELAB distance treated as a match"),
        Float("cx", 0.5, 0.0, 1.0, "ellipse/rect: centre"),
        Float("cy", 0.5, 0.0, 1.0),
        Float("width", 0.6, 0.01, 2.0, "ellipse/rect: size as a fraction of the image"),
        Float("height", 0.6, 0.01, 2.0),
        Float("angle_deg", 0.0, -180.0, 180.0, "gradient direction"),
        Float("feather_px", 0.0, 0.0, 200.0),
        Bool("invert", False),
        Choice("combine", "replace", ["replace", "multiply"], "how to treat existing alpha"),
    ],
)
def mask(img, p, seed):
    """Builds an alpha channel from luminance, a colour key, or a shape."""
    h, w = img.shape[:2]
    rgb = img[..., :3]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)

    if p.kind == "luminance":
        y = luma(rgb)
        soft = max(p.feather_px / max(min(h, w), 1), 1e-4)
        m = smoothstep(p.low - soft, p.low + soft, y) * (1.0 - smoothstep(p.high - soft, p.high + soft, y)) if p.high < 1.0 else smoothstep(p.low - soft, p.low + soft, y)
    elif p.kind == "color_key":
        key = np.array([hex_array([p.key])[0]])[None]
        distance = np.linalg.norm(rgb_to_lab(rgb) - rgb_to_lab(key), axis=-1)
        m = smoothstep(p.tolerance * 0.6, p.tolerance, distance)
    elif p.kind == "ellipse":
        m = (((xs / w - p.cx) / (p.width / 2.0)) ** 2 + ((ys / h - p.cy) / (p.height / 2.0)) ** 2 <= 1.0).astype(np.float32)
    elif p.kind == "rect":
        m = ((np.abs(xs / w - p.cx) <= p.width / 2.0) & (np.abs(ys / h - p.cy) <= p.height / 2.0)).astype(np.float32)
    else:
        theta = np.radians(p.angle_deg)
        t = ((xs - w / 2.0) * np.cos(theta) + (ys - h / 2.0) * np.sin(theta)) / max(np.hypot(w, h) / 2.0, 1.0)
        m = np.clip(0.5 + t * 0.5, 0.0, 1.0)

    if p.kind in ("ellipse", "rect") and p.feather_px > 0:
        m = cv2.GaussianBlur(m, (0, 0), p.feather_px / 2.0)
    if p.invert:
        m = 1.0 - m
    if p.combine == "multiply":
        m = m * _alpha_of(img)
    return np.concatenate([rgb, m[..., None]], axis=2)


@register_op("feather", category="masking", outputs_alpha=True, params=[Float("radius_px", 4.0, 0.0, 200.0), Float("shrink_px", 0.0, 0.0, 100.0)])
def feather(img, p, seed):
    """Softens the edge of the alpha channel, optionally shrinking it first."""
    img = _with_alpha(img)
    alpha = img[..., 3]
    if p.shrink_px > 0:
        size = odd(p.shrink_px * 2.0 + 1.0, 3)
        alpha = cv2.erode(alpha, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)))
    if p.radius_px > 0:
        alpha = cv2.GaussianBlur(alpha, (0, 0), p.radius_px / 2.0)
    return np.concatenate([img[..., :3], np.clip(alpha, 0.0, 1.0)[..., None]], axis=2)


@register_op(
    "stroke",
    category="masking",
    outputs_alpha=True,
    params=[
        Float("width_px", 4.0, 0.0, 100.0),
        Color("color", "#000000"),
        Choice("position", "outside", ["outside", "inside", "center"]),
    ],
)
def stroke(img, p, seed):
    """Outlines the opaque shape. An image with no transparency can only be stroked inside."""
    img = _with_alpha(img)
    alpha = img[..., 3]
    if p.width_px <= 0:
        return img

    def grow(a, px):
        size = odd(px * 2.0 + 1.0, 3)
        return cv2.dilate(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)))

    def shrink(a, px):
        size = odd(px * 2.0 + 1.0, 3)
        return cv2.erode(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)))

    if p.position == "outside":
        ring = np.clip(grow(alpha, p.width_px) - alpha, 0.0, 1.0)
    elif p.position == "inside":
        ring = np.clip(alpha - shrink(alpha, p.width_px), 0.0, 1.0)
    else:
        ring = np.clip(grow(alpha, p.width_px / 2.0) - shrink(alpha, p.width_px / 2.0), 0.0, 1.0)

    colour = hex_array([p.color])[0]
    out_a = np.clip(np.maximum(alpha, ring), 0.0, 1.0)
    rgb = img[..., :3] * (1.0 - ring[..., None]) + colour * ring[..., None]
    return np.concatenate([rgb, out_a[..., None]], axis=2)


@register_op(
    "drop_shadow",
    category="masking",
    outputs_alpha=True,
    params=[
        Float("dx", 6.0, -300.0, 300.0),
        Float("dy", 6.0, -300.0, 300.0),
        Float("blur_px", 8.0, 0.0, 100.0),
        Float("opacity", 0.5, 0.0, 1.0),
        Color("color", "#000000"),
    ],
)
def drop_shadow(img, p, seed):
    """Adds a soft shadow behind the opaque shape, clipped to the canvas."""
    img = _with_alpha(img)
    h, w = img.shape[:2]
    alpha = img[..., 3]
    shadow_alpha = cv2.warpAffine(alpha, np.array([[1, 0, p.dx], [0, 1, p.dy]], dtype=np.float32), (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    if p.blur_px > 0:
        shadow_alpha = cv2.GaussianBlur(shadow_alpha, (0, 0), p.blur_px / 2.0)
    shadow_alpha = np.clip(shadow_alpha, 0.0, 1.0) * p.opacity

    out_a = alpha + shadow_alpha * (1.0 - alpha)
    colour = hex_array([p.color])[0]
    weight = np.where(out_a > 1e-6, alpha / np.maximum(out_a, 1e-6), 0.0)[..., None]
    rgb = img[..., :3] * weight + colour * (1.0 - weight)
    return np.concatenate([np.clip(rgb, 0.0, 1.0), out_a[..., None]], axis=2)

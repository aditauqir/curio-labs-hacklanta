#!/usr/bin/env python3
"""
Independent check of the generated assets against the manifest / recipe targets.
 * halftone maps: render a 50% tone through the map, FFT it, and measure the real pitch and angle
 * grain: measured std dev vs target
 * paper / overlays / grain: wrap-seam continuity (tileability)
Writes verification.json next to the manifest and prints a summary.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
man = json.loads((ROOT / "assets_manifest.json").read_text())


def load(rel):
    return np.asarray(Image.open(ROOT / rel))


def fft_peak(binary):
    f = np.fft.fftshift(np.fft.fft2(binary - binary.mean()))
    mag = np.abs(f)
    H, W = mag.shape
    cy, cx = H // 2, W // 2
    mag[cy - 2:cy + 3, cx - 2:cx + 3] = 0
    iy, ix = np.unravel_index(np.argmax(mag), mag.shape)
    ky, kx = (iy - cy) / H, (ix - cx) / W
    freq = math.hypot(kx, ky)
    ang = math.degrees(math.atan2(ky, kx)) % 90.0
    if abs(ang - 90.0) < 1e-6:
        ang = 0.0
    return 1.0 / freq, ang


def seam_ratio(a):
    a = a.astype(np.float64)
    if a.ndim == 3:
        a = a.mean(axis=2)
    seam_x = np.abs(a[:, 0] - a[:, -1]).mean()
    seam_y = np.abs(a[0, :] - a[-1, :]).mean()
    int_x = np.abs(a[:, 1:] - a[:, :-1]).mean()
    int_y = np.abs(a[1:, :] - a[:-1, :]).mean()
    return max(seam_x / int_x, seam_y / int_y)


def seam_vs_max_step(a):
    """For flat/binary patterns: the wrap seam must be no harsher than the worst ordinary neighbour step."""
    a = a.astype(np.float64)
    sx = np.abs(a[:, 0] - a[:, -1]).mean()
    sy = np.abs(a[0, :] - a[-1, :]).mean()
    mx = np.abs(a[:, 1:] - a[:, :-1]).mean(axis=0).max()
    my = np.abs(a[1:, :] - a[:-1, :]).mean(axis=1).max()
    rx = sx / mx if mx > 1e-9 else 0.0
    ry = sy / my if my > 1e-9 else 0.0
    return max(rx, ry)


res = {}
bad = 0
for a in man["assets"]:
    arr = load(a["file"])
    r = {"kind": a["kind"]}
    ok = True
    if a["kind"] == "halftone_threshold" and a["params"].get("pitch_px"):
        tone = np.full(arr.shape, 127.5)
        binary = (tone > arr).astype(np.float64)
        cov = 1.0 - binary.mean()     # ink coverage at 50 % tone
        pitch, ang = fft_peak(binary)
        tgt = a["achieved"]
        is_line = a["params"]["shape"].startswith("line")
        d_ang = abs(((ang - tgt["angle_deg"] + 45.0) % 90.0) - 45.0)
        if is_line:
            # horizontal lines => FFT peak sits on the y axis (90 deg == 0 deg mod 90)
            d_ang = min(ang, 90.0 - ang)
        r.update(measured_pitch_px=round(pitch, 3), measured_angle_deg=round(ang, 2),
                 baked_pitch_px=tgt["pitch_px"], recipe_pitch_px=a["params"]["pitch_px"],
                 ink_coverage_at_50pct=round(cov, 3))
        ok = abs(pitch - tgt["pitch_px"]) / tgt["pitch_px"] < 0.01 and d_ang < 1.0 and abs(cov - 0.5) < 0.02
    elif a["kind"] == "halftone_threshold":
        tone = np.full(arr.shape, 127.5)
        cov = 1.0 - (tone > arr).mean()
        r.update(ink_coverage_at_50pct=round(cov, 3))
        ok = abs(cov - 0.5) < 0.02
    elif a["kind"] == "grain":
        x = arr.astype(np.float64)
        stds = [x[..., c].std() for c in range(x.shape[2])] if x.ndim == 3 else [x.std()]
        tgt = a["params"]["std_dev"]
        r.update(measured_std=[round(s, 2) for s in stds], target_std=tgt, mean=round(float(x.mean()), 1),
                 seam_ratio=round(seam_ratio(arr), 2))
        ok = all(abs(s - tgt) / tgt < 0.05 for s in stds) and r["seam_ratio"] < 1.3
    elif a["kind"] in ("paper",) or (a["kind"] == "overlay" and a["tileable"]):
        x = arr.astype(np.float64)
        r.update(mean=round(float(x.mean()), 1), std=round(float(x.std()), 2), seam_ratio=round(seam_ratio(arr), 2))
        ok = r["seam_ratio"] < 1.3
    elif a["kind"] == "pattern" and a["tileable"]:
        r.update(mean=round(float(arr.mean()), 1), seam_vs_max_step=round(float(seam_vs_max_step(arr)), 3))
        ok = r["seam_vs_max_step"] <= 1.05
    else:
        x = arr.astype(np.float64)
        r.update(mean=round(float(x.mean()), 1), size=list(arr.shape[1::-1]) if arr.ndim == 2 else list(arr.shape[1::-1]))
    r["ok"] = bool(ok)
    bad += (not ok)
    res[a["id"]] = r
    print("%-4s %-34s %s" % ("OK" if ok else "FAIL", a["id"], {k: v for k, v in r.items() if k not in ("kind", "ok")}))

(ROOT / "verification.json").write_text(json.dumps(res, indent=2))
print("\n%d assets checked, %d failed" % (len(res), bad))
sys.exit(1 if bad else 0)

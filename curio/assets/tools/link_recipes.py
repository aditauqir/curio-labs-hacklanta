#!/usr/bin/env python3
"""
Link every style recipe JSON (analysis/recipes/**.json) to the generated assets whose
parameters match its `halftone` and `texture_layers`, and write recipe_asset_map.json.

Rule-based on the recipe's own strings/numbers, so new recipes from Antigravity are matched
automatically on re-run.  Anything it cannot match is listed under `unmatched` (never guessed).

Usage: python link_recipes.py <recipes_dir> <assets_dir>
"""
import json
import sys
from pathlib import Path

recipes_dir = Path(sys.argv[1])
assets_dir = Path(sys.argv[2])
man = json.loads((assets_dir / "assets_manifest.json").read_text())
A = {a["id"]: a for a in man["assets"]}


def nearest(ids, key, val):
    ids = [i for i in ids if i in A]
    return min(ids, key=lambda i: abs(A[i]["params"].get(key, 0) - val)) if ids else None


def match_halftone(h):
    t = ("%s %s" % (h.get("type", ""), h.get("shape", ""))).lower()
    pitch = float(h.get("pitch_px") or 0)
    if "none" in t and "ring" not in t and "diffuse" not in t and "continuous_tone" in t and pitch == 0:
        return None, "recipe declares no halftone (continuous tone)"
    if "ring" in t or "interference" in t:
        return "pattern_interference_rings_p5", "sinusoidal interference rings"
    if "checker" in t or "barcode" in t or "square" in t:
        return "ht_square_p15p3_a0", "square matrix; also see pattern_checker_p15"
    if "crt" in t or ("scanline" in t and pitch <= 6):
        return "ht_line_p4_h", "CRT scanlines; also see pattern_scanlines_crt_p4"
    if "line" in t or "scanline" in t:
        return nearest(["ht_line_p13p8_h", "ht_line_p4_h"], "pitch_px", pitch), "line screen, nearest pitch"
    if "diffus" in t or "airbrush" in t:
        return None, "airbrush diffusion: no screen; use soft-light cloud + airbrush grain"
    if "am dot" in t and "round" in t:
        return "ht_am_round_p7p8_a51", "AM round dot"
    if "dot" in t and "grain" in t:
        return "ht_dotgrain_p9p8_a0", "dot/grain mix"
    if "litho" in t or "plate" in t:
        return "ht_ellipse_p14p4_a29", "litho/plate screen (elliptical)"
    if "continuous" in t or "fine grain" in t:
        return "ht_fine_p4p5_a0", "fine grain / near-continuous tone"
    if pitch:
        return nearest([i for i, a in A.items() if a["kind"] == "halftone_threshold" and a["params"].get("pitch_px")], "pitch_px", pitch), "nearest pitch fallback"
    return None, "no match"


def match_texture(tl):
    t = tl.get("type", "").lower()
    p = tl.get("params", {})
    std = p.get("std_dev")
    if "crease" in t:
        c = int(p.get("crease_count", 2))
        return "overlay_photocopy_creases_%d" % min(max(c, 1), 3)
    if "wireframe" in t:
        return "vec_wireframe_coordinate_grid"
    if "cloud" in t or "smoke" in t:
        return "overlay_cloud_smoke_s41"
    if "chromatic" in t or "color_noise" in t:
        return "grain_chroma_std14p7"
    if "paper" in t or "stock" in t or "newsprint" in t or "ivory" in t:
        if "aged" in t:
            return "paper_aged_r5"
        if "ivory" in t:
            return "paper_ivory_r4"
        if "newsprint" in t:
            return "paper_newsprint_r5"
        return "paper_uncoated_r4"
    if "grain" in t or "halation" in t:
        if "silver" in t or "gelatin" in t:
            return nearest(["grain_silver_gelatin_std12", "grain_silver_gelatin_std14"], "std_dev", std or 12)
        if "toner" in t or "grit" in t:
            return "grain_toner_grit_std8"
        if "airbrush" in t or "halation" in t:
            return "grain_airbrush_halation_std10"
        return nearest(["grain_film_mono_std8", "grain_film_mono_std10", "grain_film_mono_std12"], "std_dev", std or 10)
    return None


out = {"schema_version": "1.0", "recipes": {}, "unmatched": []}
for f in sorted(recipes_dir.rglob("*.json")):
    try:
        d = json.loads(f.read_text())
    except Exception as e:
        out["unmatched"].append({"file": str(f.relative_to(recipes_dir)), "reason": "unreadable: %s" % e})
        continue
    if "halftone" not in d and "texture_layers" not in d:
        continue
    key = str(f.relative_to(recipes_dir)).replace("\\", "/")
    h = d.get("halftone") or {}
    hid, hnote = match_halftone(h) if h else (None, "no halftone block")
    entry = {
        "poster_id": d.get("poster_id"),
        "style_tags": d.get("style_tags", []),
        "halftone": {"recipe": h, "asset": hid, "note": hnote,
                     "baked": A[hid]["achieved"] if hid in A else None},
        "texture_layers": [],
    }
    for tl in d.get("texture_layers", []):
        tid = match_texture(tl)
        item = {"type": tl.get("type"), "blend": tl.get("blend"), "opacity": tl.get("opacity"),
                "params": tl.get("params"), "asset": tid,
                "file": A[tid]["file"] if tid in A else None}
        if tid is None:
            out["unmatched"].append({"file": key, "layer": tl.get("type"), "reason": "no matching asset"})
        entry["texture_layers"].append(item)
    out["recipes"][key] = entry

(assets_dir / "recipe_asset_map.json").write_text(json.dumps(out, indent=2))
print("linked %d recipes, %d unmatched layers" % (len(out["recipes"]), len(out["unmatched"])))
for k, e in out["recipes"].items():
    print("\n%s" % k)
    print("   halftone:", e["halftone"]["asset"], "-", e["halftone"]["note"])
    for t in e["texture_layers"]:
        print("   %-34s -> %s  (%s %.2f)" % (t["type"], t["asset"], t["blend"], t["opacity"] or 0))

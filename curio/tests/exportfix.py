"""Builds a small, valid, synthetic model export for tests.

Three made-up families, three posters each, deterministic ids and hashes. The
numbers are invented for testing; they are not measurements of anything.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

GENERATED = {"tool": "test-fixture", "tool_version": "0", "date": "2026-10-11", "random_seed": 1, "dataset_hash": "0" * 64}

VOCAB = {
    "schema_version": "1.0",
    "moods": ["raw", "stark", "archival", "tactile", "playful", "cold"],
    "genres": ["club", "fashion", "cinema", "indie", "festival"],
    "subject_types": ["portrait", "scene", "object"],
}

FONTS = {
    "schema_version": "1.0",
    "fonts": [
        {"family": "Impact", "category": "display", "license": "proprietary (system font)", "free_alternatives": ["Anton"]},
        {"family": "Anton", "category": "display", "license": "SIL Open Font License 1.1"},
        {"family": "Playfair Display", "category": "serif", "license": "SIL Open Font License 1.1"},
        {"family": "Arial", "category": "sans-serif", "license": "proprietary (system font)", "free_alternatives": ["Inter"]},
    ],
}


def pid(family: str, i: int) -> str:
    return "r_" + hashlib.sha256(f"{family}:{i}".encode()).hexdigest()[:12]


def rng(median: float, lo: float, hi: float, n: int = 3) -> dict[str, Any]:
    return {"median": median, "min": lo, "max": hi, "n": n}


def param(unit: str, median: float, lo: float, hi: float, role: str, n: int = 3, source: str = "measured", spread: str = "low") -> dict[str, Any]:
    return {"unit": unit, **rng(median, lo, hi, n), "spread": spread, "role": role, "source": source}


def region(rid: str, role: str, content: str, x: tuple, y: tuple, w: tuple, h: tuple, z: int = 0, bleed: list | None = None, n: int = 3) -> dict[str, Any]:
    return {"id": rid, "role": role, "content": content, "x": rng(*x, n), "y": rng(*y, n), "w": rng(*w, n), "h": rng(*h, n), "bleed": bleed or [], "z": z}


def type_role(role: str, category: str, case: str, tracking: tuple, size: tuple, fonts: list[tuple[str, float]], **extra) -> dict[str, Any]:
    return {"role": role, "category": category, "case": case, "tracking": rng(*tracking, 3), "size_rel": rng(*size, 3), "font_matches": [{"name": n, "confidence": c} for n, c in fonts], **extra}


def selection(moods: list[str], genres: list[str], subjects: list[str], avoid: str, notes: str) -> dict[str, Any]:
    return {
        "moods": moods,
        "genres": genres,
        "subject_types": subjects,
        "avoid_when": [avoid],
        "director_notes": notes,
        "example_briefs": [f"Poster for a {genres[0]} night.", f"Announcement for a {genres[-1]} event."],
    }


def recipe(family: str, i: int, steps: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "poster_id": pid(family, i),
        "generated": GENERATED,
        "measurement_context": {"width_px": 1080, "height_px": 1350, "source_kind": "digital", "resized": False, "jpeg_quality_estimate": 85, "engine_reference_short_edge_px": 1080},
        "style_tags": ["synthetic"],
        "canvas": {"aspect": "4:5", "margins": {"top": 0.05, "right": 0.05, "bottom": 0.05, "left": 0.05}},
        "palette": [{"hex": "#E8E4DC", "role": "paper", "area_pct": 60}, {"hex": "#101010", "role": "ink", "area_pct": 40}],
        "color_scheme": "duotone",
        "typography": [{"role": "headline", "category": "display", "weight": "black", "case": "upper", "tracking": -0.01, "rotation_deg": 0, "size_rel": 0.12, "font_matches": [{"name": "Impact", "confidence": 0.7}]}],
        "photo_pipeline": steps,
        "halftone": {},
        "texture_layers": [{"type": "paper", "blend": "multiply", "opacity": 0.5, "params": {}}],
        "layer_order": ["paper", "photo", "type"],
        "essential_ops": [steps[0]["op"]],
        "optional_ops": [],
        "layout": {"regions": [{"id": "photo", "role": "photo", "content": "photo", "x": 0.0, "y": 0.0, "w": 1.0, "h": 0.6, "bleed": [], "z": 1}]},
        "measurements": [{"key": "grain.sigma", "value": 10.0, "unit": "levels_0_255", "method": "highpass", "confidence": 0.6}],
        "unsupported_by_engine": [],
        "confidence": 0.7,
    }


def cluster(cluster_id: str, title: str, members: list[str], pipeline: list[tuple[str, bool]], params: dict, colors: list[dict], layouts: list[dict], roles: list[dict], sel: dict, unsupported: list[str] | None = None) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "cluster_id": cluster_id,
        "generated": {**GENERATED, "rules": "defining if relative spread < 0.15"},
        "title": title,
        "support": len(members),
        "members": [{"poster_id": m, "weight": 0.9 - 0.05 * i, "also_near": {}} for i, m in enumerate(members)],
        "quality": {"silhouette": 0.6, "outliers": [], "notes": "synthetic"},
        "pipeline": [{"id": op, "op": op, "optional": optional, "used_by_fraction": 1.0} for op, optional in pipeline],
        "params": params,
        "measurements": {"grain.sigma": {"unit": "levels_0_255", **rng(10, 8, 12, 3), "spread": "low", "source": "measured"}},
        "colors": colors,
        "layout_clusters": layouts,
        "type_roles": roles,
        "texture_rules": [{"type": "paper", "blend": "multiply", "opacity": rng(0.5, 0.4, 0.6, 3), "probability": 1.0}],
        "selection": sel,
        "unsupported_by_engine": unsupported or [],
    }


def families() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}

    # Family A: line-screen newsprint, two layouts.
    ids = [pid("synth_newsprint", i) for i in range(3)]
    out["synth_newsprint"] = cluster(
        "synth_newsprint", "Synthetic newsprint", ids,
        [("levels", False), ("halftone_screen", False), ("grain", True)],
        {
            "levels.black": param("unitless_0_1", 0.06, 0.04, 0.08, "free"),
            "halftone_screen.pitch_px": param("frac_short_edge", 0.0102, 0.0091, 0.0128, "defining"),
            "halftone_screen.angle_deg": param("deg", 0.0, 0.0, 0.0, "defining"),
            "halftone_screen.shape": {"unit": "none", "values": {"line": 3}, "role": "defining", "source": "measured"},
            "grain.amount": param("unitless_0_1", 0.3, 0.2, 0.5, "free", spread="medium"),
        },
        [{"role": "paper", "center": "#E8E4DC", "max_delta_e": 4.0, "n": 3, "source": "measured"}, {"role": "ink", "center": "#101010", "max_delta_e": 3.0, "n": 3, "source": "measured"}],
        [
            {"layout_id": "inset_window", "members": ids[:2], "alignment": "center", "negative_space_pct": rng(0.41, 0.37, 0.45, 2), "aspects_seen": ["4:5"],
             "regions": [region("photo_window", "photo", "photo", (0.08, 0.07, 0.09), (0.18, 0.16, 0.20), (0.84, 0.82, 0.86), (0.42, 0.38, 0.45), 1, n=2),
                         region("headline", "type", "headline", (0.06, 0.05, 0.07), (0.64, 0.62, 0.66), (0.88, 0.86, 0.9), (0.14, 0.12, 0.16), 2, n=2),
                         region("kicker", "type", "kicker", (0.06, 0.05, 0.07), (0.10, 0.09, 0.11), (0.88, 0.86, 0.9), (0.05, 0.04, 0.06), 2, n=2),
                         region("tracklist", "type", "tracklist", (0.06, 0.05, 0.07), (0.84, 0.82, 0.86), (0.88, 0.86, 0.9), (0.10, 0.08, 0.12), 2, n=2)]},
            {"layout_id": "lower_partition", "members": ids[2:], "alignment": "left", "negative_space_pct": rng(0.3, 0.3, 0.3, 1), "aspects_seen": ["3:4"],
             "regions": [region("photo_block", "photo", "photo", (0.0, 0.0, 0.0), (0.5, 0.5, 0.5), (1.0, 1.0, 1.0), (0.5, 0.5, 0.5), 1, n=1),
                         region("headline", "type", "headline", (0.06, 0.06, 0.06), (0.1, 0.1, 0.1), (0.88, 0.88, 0.88), (0.3, 0.3, 0.3), 2, n=1)]},
        ],
        [type_role("headline", "display", "upper", (-0.01, -0.02, 0.0), (0.12, 0.10, 0.14), [("Impact", 0.7), ("Anton", 0.6)]),
         type_role("kicker", "serif", "none", (0.02, 0.0, 0.04), (0.025, 0.02, 0.03), [("Playfair Display", 0.6)], italic=True),
         type_role("tracklist", "sans-serif", "upper", (0.08, 0.06, 0.1), (0.014, 0.012, 0.016), [("Arial", 0.5)])],
        selection(["archival", "tactile"], ["cinema", "indie"], ["portrait"], "needs a neon colour", "Warm paper and one dark ink with a line-screen photo."),
    )

    # Family B: duotone with grain, one layout, one single-sample parameter.
    ids = [pid("synth_duotone", i) for i in range(3)]
    out["synth_duotone"] = cluster(
        "synth_duotone", "Synthetic duotone", ids,
        [("duotone", False), ("grain", False), ("vignette", True)],
        {
            "duotone.contrast": param("unitless_0_1", 0.15, 0.1, 0.2, "free"),
            "grain.amount": param("unitless_0_1", 0.35, 0.2, 0.5, "free", spread="medium"),
            "vignette.amount": param("unitless_0_1", 0.3, 0.3, 0.3, "free", n=1, source="assumed", spread="unknown"),
        },
        [{"role": "shadow", "center": "#1B1340", "max_delta_e": 5.0, "n": 3, "source": "measured"}, {"role": "highlight", "center": "#FFB36B", "max_delta_e": 6.0, "n": 3, "source": "measured"}],
        [{"layout_id": "full_bleed", "members": ids, "alignment": "center", "aspects_seen": ["4:5", "1:1"],
          "regions": [region("photo_full", "photo", "photo", (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (1.0, 1.0, 1.0), (1.0, 1.0, 1.0), 1),
                      region("headline", "type", "headline", (0.08, 0.06, 0.1), (0.7, 0.66, 0.74), (0.84, 0.8, 0.88), (0.16, 0.14, 0.18), 2)]}],
        [type_role("headline", "display", "lower", (0.0, -0.01, 0.01), (0.1, 0.08, 0.12), [("Arial", 0.8)])],
        selection(["raw", "playful"], ["club", "festival"], ["portrait", "scene"], "needs a restrained palette", "High contrast two-colour photo with grain."),
        ["subject isolation onto a flat colour ground"],
    )

    # Family C: photocopy, one layout.
    ids = [pid("synth_photocopy", i) for i in range(3)]
    out["synth_photocopy"] = cluster(
        "synth_photocopy", "Synthetic photocopy", ids,
        [("desaturate", False), ("brightness_contrast", False), ("threshold", False), ("ink_bleed", True)],
        {
            "brightness_contrast.contrast": param("unitless_0_1", 0.4, 0.35, 0.45, "free"),
            "threshold.cutoff": param("unitless_0_1", 0.5, 0.48, 0.52, "defining"),
            "ink_bleed.spread_px": param("frac_short_edge", 0.0014, 0.001, 0.002, "free", spread="medium"),
        },
        [{"role": "ink", "center": "#080806", "max_delta_e": 2.0, "n": 3, "source": "measured"}, {"role": "paper", "center": "#F0EBE4", "max_delta_e": 3.0, "n": 3, "source": "measured"}],
        [{"layout_id": "centered", "members": ids, "alignment": "center", "aspects_seen": ["4:5"],
          "regions": [region("photo", "photo", "photo", (0.1, 0.08, 0.12), (0.2, 0.18, 0.22), (0.8, 0.78, 0.82), (0.5, 0.48, 0.52), 1),
                      region("headline", "type", "headline", (0.1, 0.08, 0.12), (0.74, 0.72, 0.76), (0.8, 0.78, 0.82), (0.12, 0.1, 0.14), 2)]}],
        [type_role("headline", "display", "upper", (-0.02, -0.03, -0.01), (0.11, 0.09, 0.13), [("Impact", 0.7)])],
        selection(["raw", "stark"], ["club", "indie"], ["portrait", "object"], "needs a soft colour palette", "Hard black and white photocopy look."),
    )
    return out


def write_export(root: Path, mutate: dict[str, Any] | None = None) -> Path:
    """Writes the export, with a correct manifest. ``mutate`` can alter files first."""
    root.mkdir(parents=True, exist_ok=True)
    fams = families()
    files: dict[str, Any] = {"vocab.json": copy.deepcopy(VOCAB), "fonts.json": copy.deepcopy(FONTS)}
    steps_for = {
        "synth_newsprint": [{"step": 1, "op": "levels", "params": {"black": 0.06}, "range": {}}, {"step": 2, "op": "halftone_screen", "params": {"shape": "line"}, "range": {}}],
        "synth_duotone": [{"step": 1, "op": "duotone", "params": {}, "range": {}}, {"step": 2, "op": "grain", "params": {"amount": 0.3}, "range": {}}],
        "synth_photocopy": [{"step": 1, "op": "desaturate", "params": {}, "range": {}}, {"step": 2, "op": "threshold", "params": {"cutoff": 0.5}, "range": {}}],
    }
    for name, c in fams.items():
        files[f"clusters/{name}.json"] = c
        for i, m in enumerate(c["members"]):
            files[f"recipes/{m['poster_id']}.json"] = recipe(name, i, copy.deepcopy(steps_for[name]))
    for path, value in (mutate or {}).items():
        if value is None:
            files.pop(path, None)
        elif callable(value):
            value(files[path])  # mutators edit the document in place; their return value is ignored
        else:
            files[path] = value

    for rel, doc in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(doc if isinstance(doc, str) else json.dumps(doc, indent=2, sort_keys=True), encoding="utf-8")
    entries = [{"path": rel, "sha256": hashlib.sha256((root / rel).read_bytes()).hexdigest()} for rel in sorted(files)]
    manifest = {"schema_version": "1.0", "generated": GENERATED, "counts": {"recipes": 9, "clusters": 3}, "files": entries}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return root

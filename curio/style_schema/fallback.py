"""Fallback test presets.

These are the only styles that exist in code. They exist so the loader, tuning,
merging and the pipeline runner can be tested without any real style data. They
are deliberately generic and are never loaded unless a caller asks for them
(``StyleLibrary(include_fallbacks=True)``); real taste lives in ``styles/`` JSON.
"""

from __future__ import annotations

from typing import Any

from .preset import Preset
from .schema import IssueCollector
from .validate import validate_preset

FALLBACK_PRESETS: list[dict[str, Any]] = [
    {
        "schema_version": "1.0",
        "preset_id": "fallback_mono_halftone",
        "family": "fallback-halftone",
        "when_to_use": {"genres": ["test"], "moods": ["bold", "graphic"], "subject_types": ["portrait", "object"]},
        "defining_params": ["halftone_screen.shape", "halftone_screen.angle_deg", "halftone_screen.pitch_px"],
        "free_params": ["levels.black", "levels.white", "halftone_screen.dot_gain", "grain.amount"],
        "defaults": {
            "levels": {"black": 0.08, "white": 0.92},
            "halftone_screen": {"shape": "round", "pitch_px": 8.0, "angle_deg": 45.0, "dot_gain": 0.1, "ink": "#111111", "paper": "#F4EFE3"},
            "grain": {"amount": 0.2},
        },
        "ranges": {
            "levels": {"black": [0.0, 0.2], "white": [0.8, 1.0]},
            "halftone_screen": {"shape": {"choices": ["round"]}, "pitch_px": [6.0, 12.0], "angle_deg": [30.0, 60.0], "dot_gain": [0.0, 0.3]},
            "grain": {"amount": [0.0, 0.5]},
        },
        "pipeline": [
            {"op": "levels"},
            {"op": "halftone_screen"},
            {"op": "grain", "optional": True},
        ],
        "layout_rules": {"margin_pct": 6, "subject": "bleed_off_edge"},
        "type_rules": {"headline_case": "upper", "tracking": -0.02},
        "texture_rules": {"paper": True},
    },
    {
        "schema_version": "1.0",
        "preset_id": "fallback_duotone_grain",
        "family": "fallback-duotone",
        "when_to_use": {"genres": ["test"], "moods": ["moody", "cinematic"], "subject_types": ["portrait", "scene"]},
        "defining_params": ["duotone.shadow", "duotone.highlight"],
        "free_params": ["duotone.contrast", "grain.amount", "vignette.amount"],
        "defaults": {
            "levels": {"black": 0.06, "white": 0.94},
            "duotone": {"shadow": "#1B1340", "highlight": "#FFB36B", "contrast": 0.15},
            "grain": {"amount": 0.35, "size": 1.4},
            "vignette": {"amount": 0.3},
        },
        "ranges": {
            "duotone": {"shadow": {"choices": ["#1B1340", "#101A3A"]}, "highlight": {"choices": ["#FFB36B", "#FF9A5C"]}, "contrast": [-0.2, 0.5]},
            "grain": {"amount": [0.1, 0.7]},
            "vignette": {"amount": [0.0, 0.6]},
        },
        "pipeline": [
            {"op": "levels"},
            {"op": "duotone"},
            {"op": "grain"},
            {"op": "vignette", "optional": True},
        ],
        "layout_rules": {"margin_pct": 8},
        "type_rules": {"headline_case": "none"},
        "texture_rules": {"paper": False},
    },
    {
        "schema_version": "1.0",
        "preset_id": "fallback_photocopy",
        "family": "fallback-photocopy",
        "when_to_use": {"genres": ["test"], "moods": ["raw", "punk"], "subject_types": ["portrait", "object", "scene"]},
        "defining_params": ["threshold.cutoff"],
        "free_params": ["brightness_contrast.contrast", "ink_bleed.spread_px", "grain.amount"],
        "defaults": {
            "desaturate": {},
            "brightness_contrast": {"contrast": 0.4},
            "threshold": {"cutoff": 0.5},
            "ink_bleed": {"spread_px": 1.5},
            "grain": {"amount": 0.3},
        },
        "ranges": {
            "brightness_contrast": {"contrast": [0.0, 0.8]},
            "threshold": {"cutoff": [0.4, 0.6]},
            "ink_bleed": {"spread_px": [0.0, 4.0]},
            "grain": {"amount": [0.0, 0.6]},
        },
        "pipeline": [
            {"op": "desaturate"},
            {"op": "brightness_contrast"},
            {"op": "threshold"},
            {"op": "ink_bleed", "optional": True},
            {"op": "grain", "optional": True},
        ],
        "layout_rules": {"margin_pct": 4},
        "type_rules": {"headline_case": "upper"},
        "texture_rules": {"paper": True},
    },
]


def fallback_presets() -> list[Preset]:
    out: list[Preset] = []
    for raw in FALLBACK_PRESETS:
        collector = IssueCollector(f"<fallback {raw['preset_id']}>")
        doc = validate_preset(raw, collector.file, collector)
        if doc is None:  # a bug in this file, not in user data
            raise RuntimeError("invalid fallback preset: " + "; ".join(str(i) for i in collector.issues))
        out.append(Preset(doc))
    return out

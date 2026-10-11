"""Versioned style schema: validation, loading, tuning, merging."""

from .fallback import FALLBACK_PRESETS, fallback_presets
from .loader import ChangeSet, LoadReport, StyleLibrary, parse_style_text
from .preset import Preset, ResolvedPreset, ResolvedStep, TuneEvent, merge_presets
from .schema import CURRENT_VERSION, SUPPORTED_MAJOR, Issue, StyleDocument
from .validate import validate_preset, validate_recipe

__all__ = [
    "CURRENT_VERSION",
    "ChangeSet",
    "FALLBACK_PRESETS",
    "Issue",
    "LoadReport",
    "Preset",
    "ResolvedPreset",
    "ResolvedStep",
    "StyleDocument",
    "StyleLibrary",
    "SUPPORTED_MAJOR",
    "TuneEvent",
    "fallback_presets",
    "merge_presets",
    "parse_style_text",
    "validate_preset",
    "validate_recipe",
]

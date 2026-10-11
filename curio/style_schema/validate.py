"""Validation of style JSON.

Rules that apply to both kinds of file:

* Unknown fields are preserved and ignored, never rejected.
* Optional fields that are missing take defaults.
* Every problem is reported with the file and the exact field path.
* An error skips only that file; warnings let it load.

A *preset* must be runnable, so its pipeline is checked against the real op
library (unknown ops and out-of-range params are errors). A *recipe* is a
reverse-engineered description of one poster, so an op this build does not have
is only a warning: the recipe is still useful data.
"""

from __future__ import annotations

import copy
from typing import Any

from curio.core.blend import BLEND_MODES
import numpy as np

from curio.core.color import delta_e_2000, is_hex, parse_hex, rgb_to_lab
from curio.ops import get_op, has_op, validate_params
from curio.ops.registry import param_errors

from .schema import STEP_ID, IssueCollector, StyleDocument, check_version

PRESET_SECTIONS = ("layout_rules", "type_rules", "texture_rules")


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) != float("inf")


def flatten(mapping: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Turns nested dicts into dotted paths. Lists and scalars are leaves."""
    out: dict[str, Any] = {}
    for key, value in mapping.items():
        path = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict) and value:
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


# ---------------------------------------------------------------- field helpers


def _expect_dict(data: dict, key: str, c: IssueCollector, default: dict | None = None) -> dict:
    value = data.get(key, None)
    if value is None:
        return copy.deepcopy(default or {})
    if not isinstance(value, dict):
        c.at(key).error(f"must be an object, got {type(value).__name__}")
        return copy.deepcopy(default or {})
    return value


def _expect_list(data: dict, key: str, c: IssueCollector) -> list:
    value = data.get(key, None)
    if value is None:
        return []
    if not isinstance(value, list):
        c.at(key).error(f"must be a list, got {type(value).__name__}")
        return []
    return value


def _string_list(value: Any, c: IssueCollector) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        c.error("must be a list of strings")
        return []
    return list(value)


def _expect_str(data: dict, key: str, c: IssueCollector, default: str = "") -> str:
    value = data.get(key)
    if value is None:
        return default
    if not isinstance(value, str):
        c.at(key).error(f"must be text, got {type(value).__name__}")
        return default
    return value


def _expect_number(data: dict, key: str, c: IssueCollector, default: float = 0, lo: float | None = None, hi: float | None = None) -> float:
    value = data.get(key)
    if value is None:
        return default
    if not is_number(value):
        c.at(key).error(f"must be a number, got {value!r}")
        return default
    if (lo is not None and value < lo) or (hi is not None and value > hi):
        c.at(key).error(f"{value} is outside {lo}..{hi}")
    return value


# ------------------------------------------------------------------- ranges


def normalise_range(value: Any, c: IssueCollector) -> dict[str, Any] | None:
    """Accepts ``[min, max]``, ``{"min": a, "max": b}``, ``{"choices": [...]}`` or
    ``{"center": "#RRGGBB", "max_delta_e": n}`` (a colour within CIEDE2000 distance n)."""
    if isinstance(value, dict) and "center" in value:
        if not is_hex(value["center"]) or not is_number(value.get("max_delta_e")) or value["max_delta_e"] < 0:
            c.error('a colour range needs a #RRGGBB "center" and a non-negative "max_delta_e"')
            return None
        return {"center": value["center"].upper(), "max_delta_e": float(value["max_delta_e"])}
    if isinstance(value, (list, tuple)) and len(value) == 2 and all(is_number(v) for v in value):
        lo, hi = value
    elif isinstance(value, dict) and "choices" in value:
        choices = value["choices"]
        if not isinstance(choices, list) or not choices:
            c.error('"choices" must be a non-empty list')
            return None
        return {"choices": list(choices)}
    elif isinstance(value, dict) and is_number(value.get("min")) and is_number(value.get("max")):
        lo, hi = value["min"], value["max"]
    else:
        c.error('range must be [min, max], {"min", "max"}, {"choices": [...]} or {"center", "max_delta_e"}')
        return None
    if lo > hi:
        c.error(f"range minimum {lo} is greater than maximum {hi}")
        return None
    return {"min": lo, "max": hi}


def flatten_ranges(mapping: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Like :func:`flatten`, but a range object such as ``{"min": 1, "max": 5}`` is a leaf."""
    out: dict[str, Any] = {}
    for key, value in mapping.items():
        path = f"{prefix}.{key}" if prefix else str(key)
        is_spec = isinstance(value, dict) and ("choices" in value or "center" in value or ("min" in value and "max" in value))
        if isinstance(value, dict) and value and not is_spec:
            out.update(flatten_ranges(value, path))
        else:
            out[path] = value
    return out


def color_distance(a: str, b: str) -> float:
    """CIEDE2000 distance between two hex colours."""
    la = rgb_to_lab(np.array(parse_hex(a), dtype=np.float32))
    lb = rgb_to_lab(np.array(parse_hex(b), dtype=np.float32))
    return float(delta_e_2000(la, lb))


def in_range(value: Any, spec: dict[str, Any]) -> bool:
    if "center" in spec:
        return is_hex(value) and color_distance(value, spec["center"]) <= spec["max_delta_e"] + 1e-6
    if "choices" in spec:
        return value in spec["choices"]
    return is_number(value) and spec["min"] <= value <= spec["max"]


# ------------------------------------------------------------------- presets


def _assign_step_ids(steps: list[Any], c: IssueCollector) -> list[str | None]:
    """Step ids: the explicit ``id``, else the op name, else ``op_2``, ``op_3``..."""
    seen_ops: dict[str, int] = {}
    ids: list[str | None] = []
    used: set[str] = set()
    for index, step in enumerate(steps):
        if not isinstance(step, dict) or not isinstance(step.get("op"), str):
            ids.append(None)
            continue
        explicit = step.get("id")
        if explicit is not None:
            if not isinstance(explicit, str) or not STEP_ID.match(explicit):
                c.at(index).at("id").error(f"must match [A-Za-z0-9][A-Za-z0-9_-]*, got {explicit!r}")
                ids.append(None)
                continue
            step_id = explicit
        else:
            count = seen_ops.get(step["op"], 0) + 1
            seen_ops[step["op"]] = count
            step_id = step["op"] if count == 1 else f"{step['op']}_{count}"
        if step_id in used:
            c.at(index).at("id").error(f"duplicate step id {step_id!r}")
            ids.append(None)
            continue
        used.add(step_id)
        ids.append(step_id)
    return ids


def validate_preset(raw: Any, file: str, c: IssueCollector | None = None) -> StyleDocument | None:
    """Validates and normalises a style family preset. Returns ``None`` if it has errors."""
    c = c or IssueCollector(file)
    start = len(c.issues)

    if not isinstance(raw, dict):
        c.error("a preset must be a JSON object")
        return None

    data: dict[str, Any] = copy.deepcopy(raw)  # unknown fields stay exactly as written
    version = check_version(data, c)
    data["schema_version"] = version

    preset_id = data.get("preset_id")
    if not isinstance(preset_id, str) or not preset_id.strip():
        c.at("preset_id").error("is required and must be non-empty text")
        preset_id = ""
    data["preset_id"] = preset_id
    data["family"] = _expect_str(data, "family", c)

    when = _expect_dict(data, "when_to_use", c, {})
    for key in ("genres", "moods", "subject_types"):
        when[key] = _string_list(when.get(key), c.at("when_to_use").at(key))
    data["when_to_use"] = when

    for key in ("defining_params", "free_params", "essential_ops", "optional_ops"):
        data[key] = _string_list(data.get(key), c.at(key))
    for section in PRESET_SECTIONS:
        data[section] = _expect_dict(data, section, c, {})

    clash = sorted(set(data["defining_params"]) & set(data["free_params"]))
    for path in clash:
        c.at("free_params").error(f"{path!r} is listed as both defining and free")

    defaults_raw = _expect_dict(data, "defaults", c, {})
    defaults = flatten(defaults_raw)
    data["defaults"] = defaults_raw

    ranges_raw = _expect_dict(data, "ranges", c, {})
    ranges: dict[str, dict[str, Any]] = {}
    for path, spec in flatten_ranges(ranges_raw).items():
        normalised = normalise_range(spec, c.at("ranges").at(path))
        if normalised is not None:
            ranges[path] = normalised
    data["ranges"] = ranges_raw  # keep as written; normalised form is rebuilt by the Preset

    steps_raw = _expect_list(data, "pipeline", c)
    step_ids = _assign_step_ids(steps_raw, c.at("pipeline"))
    known_paths: set[str] = set()
    normal_steps: list[dict[str, Any]] = []

    for index, step in enumerate(steps_raw):
        sc = c.at("pipeline").at(index)
        step_id = step_ids[index]
        if not isinstance(step, dict):
            sc.error("a pipeline step must be an object")
            continue
        op = step.get("op")
        if not isinstance(op, str) or not op:
            sc.at("op").error("is required and must be text")
            continue
        if not has_op(op):
            sc.at("op").error(f"unknown op {op!r}")
            continue
        if step_id is None:
            continue

        params = step.get("params", {})
        if params is None:
            params = {}
        if not isinstance(params, dict):
            sc.at("params").error("must be an object")
            continue

        # The values the step would really run with: literals overlaid by defaults.
        effective = dict(params)
        for path, value in defaults.items():
            head, _, rest = path.partition(".")
            if head == step_id and rest:
                effective[rest] = value

        spec = get_op(op)
        # Check what is written in the step as well as what it would run with:
        # a bad literal is a data error even when a default happens to overlay it.
        reported: set[str] = set()
        for candidate in (params, effective):
            _, issues = validate_params(spec, candidate, on_range="error")
            for issue in param_errors(issues):
                if issue.param not in reported:
                    reported.add(issue.param)
                    sc.at("params").at(issue.param).error(issue.message)

        for name in spec.params:
            known_paths.add(f"{step_id}.{name}")
        normal_steps.append(
            {
                **step,
                "id": step_id,
                "op": op,
                "params": dict(params),
                "optional": bool(step.get("optional", False)),
                "enabled": bool(step.get("enabled", True)),
            }
        )
    data["pipeline"] = normal_steps

    # Cross-checks between ranges, defaults and the pipeline.
    step_by_id = {s["id"]: s for s in normal_steps}
    for path, spec in ranges.items():
        head, _, rest = path.partition(".")
        rc = c.at("ranges").at(path)
        if head in step_by_id:
            op_params = get_op(step_by_id[head]["op"]).params
            if rest not in op_params:
                rc.error(f"op {step_by_id[head]['op']!r} has no parameter {rest!r}")
                continue
            p = op_params[rest]
            if "min" in spec and p.min is not None and (spec["min"] < p.min or spec["max"] > p.max):
                rc.warn(f"extends beyond the op's own limits {p.min}..{p.max}; values will be clamped to them")
        elif head not in PRESET_SECTIONS:
            rc.warn("does not match any pipeline step or rules section")
        value = defaults.get(path)
        if value is None and head in step_by_id:
            value = step_by_id[head]["params"].get(rest)
            if value is None:
                p = get_op(step_by_id[head]["op"]).params.get(rest)
                value = p.default if p else None
        if value is not None and not in_range(value, spec):
            rc.error(f"default {value!r} is outside its own range")

    for key in ("defining_params", "free_params"):
        for path in data[key]:
            head = path.partition(".")[0]
            if path not in known_paths and head not in PRESET_SECTIONS:
                c.at(key).warn(f"{path!r} does not match any pipeline parameter")
    for path in data["defining_params"]:
        if path not in ranges:
            c.at("defining_params").warn(f"{path!r} has no range, so it can never be tuned")

    for path in defaults:
        head = path.partition(".")[0]
        if head not in step_by_id and head not in PRESET_SECTIONS:
            c.at("defaults").at(path).warn("does not match any pipeline step or rules section")

    if any(i.severity == "error" for i in c.issues[start:]):
        return None
    return StyleDocument("preset", preset_id, version, data, warnings=[i for i in c.issues[start:]])


# ------------------------------------------------------------------- recipes


def validate_recipe(raw: Any, file: str, c: IssueCollector | None = None) -> StyleDocument | None:
    """Validates a per-poster recipe (the training output)."""
    c = c or IssueCollector(file)
    start = len(c.issues)

    if not isinstance(raw, dict):
        c.error("a recipe must be a JSON object")
        return None

    data: dict[str, Any] = copy.deepcopy(raw)
    version = check_version(data, c)
    data["schema_version"] = version

    poster_id = data.get("poster_id")
    if not isinstance(poster_id, str) or not poster_id.strip():
        c.at("poster_id").error("is required and must be non-empty text")
        poster_id = ""
    data["poster_id"] = poster_id

    data["style_tags"] = _string_list(data.get("style_tags"), c.at("style_tags"))
    data["color_scheme"] = _expect_str(data, "color_scheme", c)

    canvas = _expect_dict(data, "canvas", c, {})
    canvas["aspect"] = _expect_str(canvas, "aspect", c.at("canvas"))
    canvas["margins"] = _expect_dict(canvas, "margins", c.at("canvas"), {})
    data["canvas"] = canvas

    palette = _expect_list(data, "palette", c)
    for i, entry in enumerate(palette):
        pc = c.at("palette").at(i)
        if not isinstance(entry, dict):
            pc.error("must be an object")
            continue
        if not is_hex(entry.get("hex")):
            pc.at("hex").error(f"must be a #RRGGBB colour, got {entry.get('hex')!r}")
        entry["role"] = _expect_str(entry, "role", pc)
        entry["area_pct"] = _expect_number(entry, "area_pct", pc, 0, 0, 100)
    data["palette"] = palette

    typography = _expect_list(data, "typography", c)
    for i, entry in enumerate(typography):
        tc = c.at("typography").at(i)
        if not isinstance(entry, dict):
            tc.error("must be an object")
            continue
        for key in ("role", "category", "weight", "case", "tracking"):
            value = entry.get(key)
            if value is not None and not isinstance(value, (str, int, float)) or isinstance(value, bool):
                tc.at(key).error(f"must be text or a number, got {value!r}")
        entry["rotation_deg"] = _expect_number(entry, "rotation_deg", tc, 0)
        entry["size_rel"] = _expect_number(entry, "size_rel", tc, 0, 0)
        matches = entry.get("font_matches")
        if matches is None:
            entry["font_matches"] = []
        elif not isinstance(matches, list):
            tc.at("font_matches").error("must be a list")
        else:
            for j, match in enumerate(matches):
                mc = tc.at("font_matches").at(j)
                if not isinstance(match, dict) or not isinstance(match.get("name"), str):
                    mc.error('must be an object with a text "name"')
                    continue
                match["confidence"] = _expect_number(match, "confidence", mc, 0, 0, 1)
    data["typography"] = typography

    pipeline = _expect_list(data, "photo_pipeline", c)
    for i, entry in enumerate(pipeline):
        pc = c.at("photo_pipeline").at(i)
        if not isinstance(entry, dict):
            pc.error("must be an object")
            continue
        entry["step"] = _expect_number(entry, "step", pc, i + 1)
        op = entry.get("op")
        if not isinstance(op, str) or not op:
            pc.at("op").error("is required and must be text")
        elif not has_op(op):
            pc.at("op").warn(f"op {op!r} is not in this build's op library; kept as data")
        entry["params"] = _expect_dict(entry, "params", pc, {})
        entry["range"] = _expect_dict(entry, "range", pc, {})
    data["photo_pipeline"] = pipeline

    halftone = _expect_dict(data, "halftone", c, {})
    for key in ("type", "shape"):
        halftone[key] = _expect_str(halftone, key, c.at("halftone"))
    for key in ("pitch_px", "angle_deg", "dot_gain"):
        halftone[key] = _expect_number(halftone, key, c.at("halftone"), 0)
    data["halftone"] = halftone

    layers = _expect_list(data, "texture_layers", c)
    for i, entry in enumerate(layers):
        lc = c.at("texture_layers").at(i)
        if not isinstance(entry, dict):
            lc.error("must be an object")
            continue
        entry["type"] = _expect_str(entry, "type", lc)
        blend = _expect_str(entry, "blend", lc)
        entry["blend"] = blend
        if blend and blend not in BLEND_MODES:
            lc.at("blend").warn(f"unknown blend mode {blend!r}")
        entry["opacity"] = _expect_number(entry, "opacity", lc, 0, 0, 1)
        entry["params"] = _expect_dict(entry, "params", lc, {})
    data["texture_layers"] = layers

    for key in ("layer_order", "essential_ops", "optional_ops"):
        data[key] = _string_list(data.get(key), c.at(key))

    if any(i.severity == "error" for i in c.issues[start:]):
        return None
    return StyleDocument("recipe", poster_id, version, data, warnings=[i for i in c.issues[start:]])

"""Compiles validated clusters into presets, layouts and templates.

Deterministic, plain code, no model. The same export and policy always produce
byte-identical files. The compiler is where observed statistics become tuning
ranges: the analysis model reports only measured minimums and maximums, and
**this** module adds the margins (policy below), so how generous a style is with
its parameters is a decision in one reviewable place.

Lengths: cluster files state lengths as fractions of the short edge. Presets
store them as pixels at the 1080 px reference size (see curio/ops/units.py), so
``frac * 1080`` here and the renderer scales back to the real output size.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from curio.layout.schema import REQUIRED_SLOTS, LayoutError, parse_layout
from curio.ops import get_op
from curio.ops.units import REFERENCE_SHORT_EDGE_PX
from curio.style_schema.preset import Preset
from curio.style_schema.schema import Issue, IssueCollector
from curio.style_schema.validate import validate_preset

from .validate_export import ExportBundle

#: Which op colour parameters a cluster colour role feeds, when the step exists.
ROLE_BINDINGS: dict[str, tuple[tuple[str, str], ...]] = {
    "ink": (("halftone_screen", "ink"), ("bitmap_threshold", "ink"), ("ordered_dither", "ink"), ("stochastic_dither", "ink"), ("threshold", "dark"), ("ink_bleed", "ink")),
    "paper": (("halftone_screen", "paper"), ("bitmap_threshold", "paper"), ("ordered_dither", "paper"), ("stochastic_dither", "paper"), ("threshold", "light"), ("distress", "paper")),
    "shadow": (("duotone", "shadow"), ("tritone", "shadow")),
    "highlight": (("duotone", "highlight"), ("tritone", "highlight")),
    "accent": (("tritone", "midtone"),),
}


@dataclass(frozen=True)
class CompilePolicy:
    """How generous the compiled ranges are. All margins are relative to the observed span."""

    margin_defining: float = 0.10  # extra range around a defining parameter, as a share of its span
    margin_free: float = 0.25
    floor_defining: float = 0.03  # minimum margin as a share of the median, for tight or single samples
    floor_free: float = 0.08
    sparse_support: int = 3  # below this many samples every margin is widened
    sparse_factor: float = 1.5
    color_margin_de: float = 2.0  # added to the observed max delta E for defining colours
    color_margin_free_de: float = 4.0
    color_defining_max_de: float = 8.0  # colours spread more than this are treated as free
    layout_margin: float = 0.10  # share of span, for layout bounds
    layout_floor: float = 0.01
    layout_floor_sparse: float = 0.02
    max_templates_per_cluster: int = 6
    min_template_distance: float = 0.35  # normalised; a variant must differ this much from every kept template
    variant_inset: float = 0.10  # variants sit this far inside the ends of a range


@dataclass
class CompileResult:
    presets: dict[str, dict[str, Any]] = field(default_factory=dict)
    layouts: dict[str, dict[str, Any]] = field(default_factory=dict)
    templates: dict[str, dict[str, Any]] = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def ok(self) -> bool:
        return not self.errors


def canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def content_hash(obj: dict[str, Any]) -> str:
    """SHA-256 of the canonical JSON, ignoring any ``content_hash`` field itself."""
    body = {k: v for k, v in obj.items() if k != "content_hash"}
    return hashlib.sha256(canonical(body).encode("utf-8")).hexdigest()


def _round(value: float) -> float:
    return round(float(value), 6)


# ------------------------------------------------------------------- presets


def expand_range(lo: float, hi: float, median: float, role: str, support: int, policy: CompilePolicy) -> tuple[float, float]:
    """Observed ``[lo, hi]`` widened by the policy margin."""
    span = hi - lo
    rel, floor = (policy.margin_defining, policy.floor_defining) if role == "defining" else (policy.margin_free, policy.floor_free)
    margin = max(rel * span, floor * abs(median))
    if support < policy.sparse_support:
        margin *= policy.sparse_factor
    return lo - margin, hi + margin


def _choice_value(spec, raw: str) -> Any:
    if spec.type == "bool":
        return raw.strip().lower() == "true"
    if spec.type in ("float", "int"):
        return float(raw) if spec.type == "float" else int(float(raw))
    return raw


def build_preset(cluster: dict[str, Any], policy: CompilePolicy, c: IssueCollector) -> dict[str, Any]:
    support = cluster["support"]
    steps = [{"id": s.get("id", s["op"]), "op": s["op"], "optional": bool(s["optional"])} for s in cluster["pipeline"]]
    ops = {s["id"]: s["op"] for s in steps}

    defaults: dict[str, Any] = {}
    ranges: dict[str, Any] = {}
    defining: list[str] = []
    free: list[str] = []

    for key in sorted(cluster["params"]):
        entry = cluster["params"][key]
        step_id, _, name = key.partition(".")
        spec = get_op(ops[step_id]).params[name]
        role = entry["role"]
        (defining if role == "defining" else free).append(key)

        if "values" in entry:
            values = entry["values"]
            top = sorted(values, key=lambda v: (-values[v], v))[0]
            defaults[key] = _choice_value(spec, top)
            ranges[key] = {"choices": [_choice_value(spec, v) for v in sorted(values)]}
            continue

        scale = REFERENCE_SHORT_EDGE_PX if spec.length else 1.0
        median, lo, hi = entry["median"] * scale, entry["min"] * scale, entry["max"] * scale
        lo, hi = expand_range(lo, hi, median, role, min(entry.get("n", support), support), policy)
        if spec.min is not None:
            lo, hi = max(lo, spec.min), min(hi, spec.max)
            median = min(max(median, spec.min), spec.max)
        lo, hi = min(lo, median), max(hi, median)
        if spec.type == "int":
            median, lo, hi = int(round(median)), int(lo), int(round(hi + 0.4999))
        defaults[key] = _round(median) if spec.type == "float" else median
        ranges[key] = [_round(lo), _round(hi)]

    # Colour roles feed the colour parameters of steps that exist. Explicit params win.
    for color in cluster["colors"]:
        for op_name, param in ROLE_BINDINGS.get(color["role"], ()):
            for step in steps:
                key = f"{step['id']}.{param}"
                if step["op"] != op_name or key in defaults:
                    continue
                observed = float(color["max_delta_e"])
                is_defining = observed <= policy.color_defining_max_de
                margin = policy.color_margin_de if is_defining else policy.color_margin_free_de
                defaults[key] = color["center"].upper()
                ranges[key] = {"center": color["center"].upper(), "max_delta_e": round(observed + margin, 4)}
                (defining if is_defining else free).append(key)

    selection = cluster["selection"]
    roles = {
        r["role"]: {
            "category": r["category"],
            "case": r["case"],
            "tracking": {"default": r["tracking"]["median"], "lo": r["tracking"]["min"], "hi": r["tracking"]["max"]},
            "size_rel": {"default": r["size_rel"]["median"], "lo": r["size_rel"]["min"], "hi": r["size_rel"]["max"]},
            **{k: r[k] for k in ("weight", "italic", "align", "outline", "rotation_deg") if k in r},
            "font_matches": r["font_matches"],
        }
        for r in cluster["type_roles"]
    }
    textures = [
        {
            "type": t["type"],
            "blend": t.get("blend", "normal"),
            "opacity": {"default": t["opacity"]["median"], "lo": t["opacity"]["min"], "hi": t["opacity"]["max"]},
            "probability": t["probability"],
            **({"asset": t["asset"]} if t.get("asset") else {}),
        }
        for t in cluster["texture_rules"]
        if "opacity" in t
    ]
    aspects = sorted({a for lay in cluster["layout_clusters"] for a in lay.get("aspects_seen", [])})

    preset = {
        "schema_version": "1.0",
        "preset_id": cluster["cluster_id"],
        "family": cluster["cluster_id"],
        "when_to_use": {k: list(selection[k]) for k in ("genres", "moods", "subject_types")},
        "defining_params": sorted(defining),
        "free_params": sorted(free),
        "defaults": defaults,
        "ranges": ranges,
        "pipeline": steps,
        "essential_ops": sorted({s["id"] for s in steps if not s["optional"]}),
        "optional_ops": sorted({s["id"] for s in steps if s["optional"]}),
        "layout_rules": {"layouts": [f"{cluster['cluster_id']}__{lay['layout_id']}" for lay in cluster["layout_clusters"]], "aspects_seen": aspects},
        "type_rules": {"roles": roles},
        "texture_rules": {"layers": textures},
        "palette": [{"role": col["role"], "color": col["center"].upper(), "max_delta_e": col["max_delta_e"]} for col in cluster["colors"]],
        "units": {"reference_short_edge_px": REFERENCE_SHORT_EDGE_PX},
        "selection": {k: selection[k] for k in ("avoid_when", "director_notes", "example_briefs")},
        "unsupported_by_engine": sorted(cluster["unsupported_by_engine"]),
        "source_cluster": {
            "cluster_id": cluster["cluster_id"],
            "support": support,
            "silhouette": cluster["quality"].get("silhouette"),
            "generated": cluster["generated"],
            "ranges_from_assumed": sorted(k for k, e in cluster["params"].items() if e.get("source") == "assumed"),
        },
    }
    preset["content_hash"] = content_hash(preset)
    return preset


# ------------------------------------------------------------------- layouts


def _bounds(r: dict[str, Any], support: int, policy: CompilePolicy, lo_limit: float, hi_limit: float) -> dict[str, float]:
    span = r["max"] - r["min"]
    floor = policy.layout_floor_sparse if r.get("n", support) < policy.sparse_support else policy.layout_floor
    margin = max(policy.layout_margin * span, floor)
    lo, hi = max(r["min"] - margin, lo_limit), min(r["max"] + margin, hi_limit)
    default = min(max(r["median"], lo), hi)
    return {"lo": _round(lo), "hi": _round(hi), "default": _round(default)}


def build_layouts(cluster: dict[str, Any], policy: CompilePolicy) -> dict[str, dict[str, Any]]:
    support, out = cluster["support"], {}
    for lay in cluster["layout_clusters"]:
        regions = []
        for r in lay["regions"]:
            bleed = list(r.get("bleed", []))
            hi_xy = 1.5 if bleed else 1.0
            region = {
                "id": r["id"],
                "role": r["role"],
                "content": r.get("content", ""),
                "x": _bounds(r["x"], support, policy, 0.0 if "left" not in bleed else -0.5, hi_xy),
                "y": _bounds(r["y"], support, policy, 0.0 if "top" not in bleed else -0.5, hi_xy),
                "w": _bounds(r["w"], support, policy, 0.0, 1.5 if bleed else 1.0),
                "h": _bounds(r["h"], support, policy, 0.0, 1.5 if bleed else 1.0),
                "z": int(r.get("z", 0)),
                "bleed": bleed,
                "optional": r["role"] == "type" and r.get("content") not in REQUIRED_SLOTS,
            }
            if r.get("aspect_ratio"):
                region["aspect_ratio"] = _bounds(r["aspect_ratio"], support, policy, 0.05, 20.0)
            if r.get("frame"):
                region["frame"] = r["frame"]
            regions.append(region)
        doc: dict[str, Any] = {
            "schema_version": "1.0",
            "layout_id": f"{cluster['cluster_id']}__{lay['layout_id']}",
            "cluster_id": cluster["cluster_id"],
            "alignment": lay.get("alignment", "left"),
            "aspects_seen": sorted(lay.get("aspects_seen", [])),
            "members": sorted(lay.get("members", [])),
            "regions": regions,
        }
        if lay.get("negative_space_pct"):
            doc["negative_space"] = _bounds(lay["negative_space_pct"], support, policy, 0.0, 1.0)
        doc["content_hash"] = content_hash(doc)
        out[doc["layout_id"]] = doc
    return out


# ----------------------------------------------------------------- templates


def _free_numeric(preset: Preset) -> dict[str, tuple[float, float, float]]:
    """Free parameters with a real numeric range: ``{path: (lo, hi, default)}``."""
    out = {}
    for path in preset.free:
        spec = preset.ranges.get(path)
        default = preset.defaults.get(path)
        if spec and "min" in spec and spec["max"] > spec["min"] and isinstance(default, (int, float)) and not isinstance(default, bool):
            out[path] = (spec["min"], spec["max"], float(default))
    return out


def template_distance(a: dict[str, Any], b: dict[str, Any], axes: dict[str, tuple[float, float, float]]) -> float:
    """0 (identical) to 1 (different layout, or every free parameter a full range apart).

    The mean over the free parameters, not the largest gap: moving one of three
    parameters to an extreme is a small change to the look, so it must not count
    as a different template. Only a coordinated change (several parameters, or a
    different layout) does.
    """
    if a["layout_id"] != b["layout_id"]:
        return 1.0
    if not axes:
        return 0.0
    total = 0.0
    for path, (lo, hi, default) in axes.items():
        va, vb = a["overrides"].get(path, default), b["overrides"].get(path, default)
        total += abs(va - vb) / (hi - lo)
    return total / len(axes)


def build_templates(cluster: dict[str, Any], preset_doc: dict[str, Any], layouts: dict[str, dict[str, Any]], policy: CompilePolicy, c: IssueCollector) -> dict[str, dict[str, Any]]:
    """One base template per layout, plus a few variants that differ meaningfully.

    The pool of candidates is each layout with each free parameter pushed toward
    the low or high end of its range. Variants are then kept greedily by
    farthest-point selection: a candidate is added only if it differs from every
    template already kept by at least ``min_template_distance``, so near-duplicates
    never enter the set.
    """
    preset = Preset(_as_document(preset_doc))
    axes = _free_numeric(preset)
    selection = cluster["selection"]
    base_meta = {
        "schema_version": "1.0",
        "preset_id": preset_doc["preset_id"],
        "tags": {k: list(selection[k]) for k in ("moods", "genres", "subject_types")},
        "selection": {k: selection[k] for k in ("avoid_when", "director_notes", "example_briefs")},
        "support": cluster["support"],
        "unsupported_by_engine": sorted(cluster["unsupported_by_engine"]),
    }

    def make(layout_id: str, overrides: dict[str, Any], kind: str, tag: str) -> dict[str, Any]:
        short = layout_id.split("__", 1)[1] if "__" in layout_id else layout_id
        template_id = f"{preset_doc['preset_id']}__{short}" + (f"__{tag}" if tag else "")
        return {**base_meta, "template_id": template_id, "layout_id": layout_id, "overrides": overrides, "derived": {"kind": kind, "axis": tag or None}, "aspects_seen": layouts[layout_id]["aspects_seen"]}

    kept = [make(lid, {}, "base", "") for lid in sorted(layouts)]

    def pushed(path: str, high: bool) -> Any:
        lo, hi, _ = axes[path]
        value = hi - policy.variant_inset * (hi - lo) if high else lo + policy.variant_inset * (hi - lo)
        return int(round(value)) if preset.ranges[path].get("min") is not None and isinstance(preset.defaults[path], int) else _round(value)

    candidates: list[dict[str, Any]] = []
    for lid in sorted(layouts):
        for path in sorted(axes):
            for high in (False, True):
                tag = f"{path.replace('.', '_')}_{'high' if high else 'low'}"
                candidates.append(make(lid, {path: pushed(path, high)}, "variant", tag))
        if len(axes) >= 2:
            for high in (False, True):
                candidates.append(make(lid, {p: pushed(p, high) for p in sorted(axes)}, "variant", f"all_{'high' if high else 'low'}"))

    # Drop candidates the preset would not accept (they would be rejected at render time).
    valid = []
    for cand in candidates:
        resolved = preset.resolve(cand["overrides"])
        if resolved.rejected():
            c.warn(f"variant {cand['template_id']} skipped: {resolved.rejected()[0].reason}")
        else:
            valid.append(cand)

    while len(kept) < policy.max_templates_per_cluster and valid:
        scored = [(min(template_distance(cand, k, axes) for k in kept), cand) for cand in valid]
        distance, best = sorted(scored, key=lambda t: (-t[0], t[1]["template_id"]))[0]
        if distance < policy.min_template_distance:
            break
        kept.append(best)
        valid = [v for v in valid if v is not best]

    out = {}
    for template in kept:
        template["content_hash"] = content_hash(template)
        out[template["template_id"]] = template
    return out


def _as_document(preset_doc: dict[str, Any]):
    collector = IssueCollector(f"<compiled {preset_doc['preset_id']}>")
    doc = validate_preset(copy.deepcopy(preset_doc), collector.file, collector)
    if doc is None:
        raise ValueError("compiled preset is invalid: " + "; ".join(str(i) for i in collector.issues if i.severity == "error"))
    return doc


# ------------------------------------------------------------------- driver


def compile_cluster(cluster: dict[str, Any], file: str, policy: CompilePolicy | None = None) -> tuple[CompileResult, list[Issue]]:
    """Compiles one cluster. Anything that fails validation is reported, not written."""
    policy = policy or CompilePolicy()
    c = IssueCollector(file)
    result = CompileResult()

    try:
        preset_doc = build_preset(cluster, policy, c)
        validated = validate_preset(copy.deepcopy(preset_doc), f"compiled/presets/{cluster['cluster_id']}.json", c)
        if validated is None:
            result.skipped.append(cluster["cluster_id"])
            return result, c.issues
        layouts = build_layouts(cluster, policy)
        for doc in layouts.values():
            parse_layout(doc)
        templates = build_templates(cluster, preset_doc, layouts, policy, c)
    except LayoutError as error:
        c.error(f"compiled layout is invalid: {error}")
        result.skipped.append(cluster["cluster_id"])
        return result, c.issues

    result.presets[preset_doc["preset_id"]] = preset_doc
    result.layouts.update(layouts)
    result.templates.update(templates)
    return result, c.issues


def compile_bundle(bundle: ExportBundle, policy: CompilePolicy | None = None) -> CompileResult:
    """Compiles every valid cluster in a loaded export."""
    result = CompileResult(issues=list(bundle.issues), skipped=list(bundle.skipped))
    for cluster_id in sorted(bundle.clusters):
        part, issues = compile_cluster(bundle.clusters[cluster_id], f"clusters/{cluster_id}.json", policy)
        result.issues.extend(issues)
        result.presets.update(part.presets)
        result.layouts.update(part.layouts)
        result.templates.update(part.templates)
        result.skipped.extend(part.skipped)
    return result


def write_compiled(result: CompileResult, out_dir: str | Path) -> list[Path]:
    """Writes compiled artifacts as canonical JSON. Returns the paths written."""
    out, written = Path(out_dir), []
    for folder, docs in (("presets", result.presets), ("layouts", result.layouts), ("templates", result.templates)):
        for doc_id, doc in sorted(docs.items()):
            path = out / folder / f"{doc_id}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(canonical(doc), encoding="utf-8")
            written.append(path)
    return written

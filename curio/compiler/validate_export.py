"""Strict validation of the analysis model's export (docs/MODEL_EXPORT_SPEC.md).

This is stricter than the engine's own recipe loader on purpose. The loader keeps
anything usable; an export is a deliverable, so a missing unit, an op the engine
does not have, a URL, or a dangling reference is reported against the exact file
and field, and that file is skipped. Every other file is still checked and kept.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from curio.core.blend import BLEND_MODES
from curio.layout.schema import EDGES, REGION_ROLES, SLOT_ROLES
from curio.ops import get_op, has_op
from curio.style_schema.schema import STEP_ID, Issue, IssueCollector, check_version
from curio.style_schema.validate import is_number, validate_recipe
from curio.typography.text import CASES

UNITS = ("frac_short_edge", "frac_width", "frac_height", "deg", "em", "ratio", "levels_0_255", "unitless_0_1", "count", "hex", "none")
COLOR_ROLES = ("ink", "paper", "highlight", "shadow", "accent", "ground", "text", "background")
FONT_CATEGORIES = ("sans-serif", "serif", "display", "monospace", "script", "symbol")
SPREADS = ("low", "medium", "high", "unknown")
ID = re.compile(r"^[a-z0-9_]+$")
POSTER_ID = re.compile(r"^r_[0-9a-f]{12}$")
REQUIRED_GENERATED = ("tool", "tool_version", "date", "random_seed", "dataset_hash")

_URL = re.compile(r"(?i)(https?://|file:|data:image|ftp://|www\.)")
_WIN_PATH = re.compile(r"^[A-Za-z]:[\\/]")
_FILE_LIKE = re.compile(r"(?i)[\w\-]+[\\/][\w\-./\\]*\.(jpe?g|png|webp|gif|tiff?|psd|pdf|svg)\b|\.(jpe?g|png|webp)$")


def looks_like_path_or_url(text: str) -> bool:
    return bool(_URL.search(text) or _WIN_PATH.match(text) or text.startswith(("/", "~/", "./", "../")) or "\\" in text or _FILE_LIKE.search(text))


def scan_strings(node: Any, c: IssueCollector) -> None:
    """Rule 2: no paths or URLs anywhere in an export."""
    if isinstance(node, str):
        if looks_like_path_or_url(node):
            c.error(f"contains something that looks like a file path or URL: {node[:60]!r}")
    elif isinstance(node, dict):
        for key, value in node.items():
            scan_strings(key, c.at(f"<key {key!r}>")) if isinstance(key, str) and looks_like_path_or_url(key) else None
            scan_strings(value, c.at(str(key)))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            scan_strings(value, c.at(i))


@dataclass
class ExportContext:
    vocab: dict[str, list[str]] | None = None
    fonts: set[str] | None = None
    recipe_ids: set[str] | None = None


# --------------------------------------------------------------- small checks


def _require(data: dict, key: str, c: IssueCollector, kind: type | tuple = object) -> Any:
    if key not in data or data[key] is None:
        c.at(key).error("is required")
        return None
    if kind is not object and (not isinstance(data[key], kind) or isinstance(data[key], bool) and kind in (int, float)):
        c.at(key).error(f"must be {kind.__name__ if isinstance(kind, type) else kind}, got {type(data[key]).__name__}")
        return None
    return data[key]


def check_generated(data: dict, c: IssueCollector) -> None:
    gen = _require(data, "generated", c, dict)
    if gen is None:
        return
    for key in REQUIRED_GENERATED:
        if key not in gen or gen[key] in (None, ""):
            c.at("generated").at(key).error("is required")


def check_range(r: Any, c: IssueCollector, support: int | None, lo: float | None = None, hi: float | None = None, require_n: bool = True) -> bool:
    """A Range object: ``{median, min, max, n}`` with observed extremes."""
    if not isinstance(r, dict):
        c.error("must be a Range object {median, min, max, n}")
        return False
    ok = True
    for key in ("median", "min", "max"):
        if not is_number(r.get(key)):
            c.at(key).error("must be a number")
            ok = False
    if not ok:
        return False
    if not r["min"] <= r["median"] <= r["max"]:
        c.error(f"needs min <= median <= max, got {r['min']}, {r['median']}, {r['max']}")
        ok = False
    n = r.get("n")
    if require_n or n is not None:
        if isinstance(n, bool) or not isinstance(n, int) or n < 1:
            c.at("n").error("must be a whole number of at least 1")
            ok = False
        elif support is not None and n > support:
            c.at("n").error(f"{n} is more than the cluster's support of {support}")
            ok = False
    if lo is not None and r["min"] < lo - 1e-9:
        c.at("min").error(f"{r['min']} is below {lo}")
        ok = False
    if hi is not None and r["max"] > hi + 1e-9:
        c.at("max").error(f"{r['max']} is above {hi}")
        ok = False
    return ok


def _string_list(value: Any, c: IssueCollector, allowed: tuple | list | set | None = None, minimum: int = 0) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        c.error("must be a list of text")
        return []
    if len(value) < minimum:
        c.error(f"needs at least {minimum} item(s)")
    if allowed is not None:
        for i, item in enumerate(value):
            if item not in allowed:
                c.at(i).error(f"{item!r} is not in the allowed list")
    return value


# -------------------------------------------------------------------- cluster


def _check_params(params: Any, pipeline_ops: dict[str, str], support: int, c: IssueCollector) -> None:
    if not isinstance(params, dict):
        c.error("must be an object")
        return
    for key, entry in params.items():
        pc = c.at(key)
        step_id, _, param = key.partition(".")
        if step_id not in pipeline_ops or not param:
            pc.error(f"key must be '<step id>.<param>' with a step id from pipeline ({sorted(pipeline_ops)})")
            continue
        op = get_op(pipeline_ops[step_id])
        if param not in op.params:
            pc.error(f"op {op.name!r} has no parameter {param!r}")
            continue
        spec = op.params[param]
        if not isinstance(entry, dict):
            pc.error("must be an object")
            continue

        unit = entry.get("unit")
        if unit not in UNITS:
            pc.at("unit").error(f"is required and must be one of {UNITS}")
            continue
        if entry.get("role") not in ("defining", "free"):
            pc.at("role").error("must be 'defining' or 'free'")
        if entry.get("source") not in ("measured", "assumed"):
            pc.at("source").error("must be 'measured' or 'assumed'")
        if "values" not in entry:  # a categorical value has no spread to report
            if entry.get("spread") not in SPREADS:
                pc.at("spread").error(f"must be one of {SPREADS}")
            elif entry.get("spread") != "unknown" and isinstance(entry.get("n"), int) and entry["n"] < 3:
                pc.at("spread").warn("with fewer than 3 samples the spread cannot be known; use 'unknown'")

        if "values" in entry:
            values = entry["values"]
            if not isinstance(values, dict) or not values or not all(isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool) and v >= 1 for k, v in values.items()):
                pc.at("values").error("must map each observed value to a count of at least 1")
                continue
            if sum(values.values()) > support:
                pc.at("values").error(f"counts add up to {sum(values.values())}, more than support {support}")
            if spec.type == "choice":
                for v in values:
                    if v not in (spec.choices or ()):
                        pc.at("values").error(f"{v!r} is not a valid {param} (expected one of {list(spec.choices or ())})")
            continue

        if spec.type not in ("float", "int"):
            pc.error(f"parameter {param!r} is a {spec.type}; describe it with 'values', not numbers")
            continue
        if not check_range(entry, pc, support):
            continue
        if spec.length:
            if unit != "frac_short_edge":
                pc.at("unit").error("a length parameter must use unit 'frac_short_edge' so it is resolution independent")
            elif spec.min is not None and not (spec.min - 1e-6 <= entry["median"] * 1080 <= (spec.max or 1e9) + 1e-6):
                pc.warn(f"median is {entry['median'] * 1080:.2f} px at the 1080 px reference, outside the op's {spec.min}..{spec.max}; it will be clamped")
        elif spec.min is not None and not (spec.min - 1e-6 <= entry["median"] <= spec.max + 1e-6):
            pc.warn(f"median {entry['median']} is outside the op's own range {spec.min}..{spec.max}; it will be clamped")


def validate_cluster_export(raw: Any, file: str, ctx: ExportContext | None = None) -> tuple[dict[str, Any] | None, list[Issue]]:
    ctx = ctx or ExportContext()
    c = IssueCollector(file)
    if not isinstance(raw, dict):
        c.error("a cluster file must be a JSON object")
        return None, c.issues

    check_version(raw, c)
    scan_strings(raw, c)
    check_generated(raw, c)

    cluster_id = _require(raw, "cluster_id", c, str)
    if cluster_id is not None and not ID.match(cluster_id):
        c.at("cluster_id").error("must use only a-z, 0-9 and _")
    _require(raw, "title", c, str)

    members_raw = _require(raw, "members", c, list)
    members: list[str] = []
    if members_raw is not None:
        for i, m in enumerate(members_raw):
            mc = c.at("members").at(i)
            if not isinstance(m, dict) or not isinstance(m.get("poster_id"), str) or not POSTER_ID.match(m["poster_id"]):
                mc.at("poster_id").error("must look like r_ followed by 12 hex characters")
                continue
            if m["poster_id"] in members:
                mc.at("poster_id").error("duplicate member")
            members.append(m["poster_id"])
            if not is_number(m.get("weight")) or not 0 <= m["weight"] <= 1:
                mc.at("weight").error("must be a number from 0 to 1")
            near = m.get("also_near", {})
            if not isinstance(near, dict) or not all(is_number(v) and 0 <= v <= 1 for v in near.values()):
                mc.at("also_near").error("must map cluster ids to weights between 0 and 1")
            if ctx.recipe_ids is not None and m["poster_id"] not in ctx.recipe_ids:
                mc.at("poster_id").error("has no recipe file in this export")

    support = raw.get("support")
    if isinstance(support, bool) or not isinstance(support, int) or support < 1:
        c.at("support").error("must be a whole number of at least 1")
        support = max(len(members), 1)
    elif members_raw is not None and support != len(members_raw):
        c.at("support").error(f"is {support} but there are {len(members_raw)} members")

    quality = _require(raw, "quality", c, dict)
    if quality is not None:
        sil = quality.get("silhouette")
        if sil is not None and (not is_number(sil) or not -1 <= sil <= 1):
            c.at("quality").at("silhouette").error("must be a number from -1 to 1")
        for pid in quality.get("outliers", []) or []:
            if pid not in members:
                c.at("quality").at("outliers").error(f"{pid!r} is not a member")

    pipeline_ops: dict[str, str] = {}
    pipeline = _require(raw, "pipeline", c, list)
    for i, step in enumerate(pipeline or []):
        pc = c.at("pipeline").at(i)
        if not isinstance(step, dict) or not isinstance(step.get("op"), str):
            pc.error("needs an op")
            continue
        if not has_op(step["op"]):
            pc.at("op").error(f"unknown op {step['op']!r}; put capabilities the engine lacks in unsupported_by_engine")
            continue
        step_id = step.get("id", step["op"])
        if not isinstance(step_id, str) or not STEP_ID.match(step_id):
            pc.at("id").error("must match [A-Za-z0-9][A-Za-z0-9_-]*")
            continue
        if step_id in pipeline_ops:
            pc.at("id").error(f"duplicate step id {step_id!r}")
            continue
        pipeline_ops[step_id] = step["op"]
        if not isinstance(step.get("optional"), bool):
            pc.at("optional").error("must be true or false")
        frac = step.get("used_by_fraction")
        if not is_number(frac) or not 0 <= frac <= 1:
            pc.at("used_by_fraction").error("must be a number from 0 to 1")

    if "params" in raw:
        _check_params(raw["params"], pipeline_ops, support, c.at("params"))
    else:
        c.at("params").error("is required")

    measurements = _require(raw, "measurements", c, dict)
    for key, entry in (measurements or {}).items():
        mc = c.at("measurements").at(key)
        if not isinstance(entry, dict) or entry.get("unit") not in UNITS:
            mc.at("unit").error(f"is required and must be one of {UNITS}")
            continue
        check_range(entry, mc, support)

    colors = _require(raw, "colors", c, list)
    for i, col in enumerate(colors or []):
        cc = c.at("colors").at(i)
        if not isinstance(col, dict):
            cc.error("must be an object")
            continue
        if col.get("role") not in COLOR_ROLES:
            cc.at("role").error(f"must be one of {COLOR_ROLES}")
        if not isinstance(col.get("center"), str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", col["center"]):
            cc.at("center").error("must be #RRGGBB")
        if not is_number(col.get("max_delta_e")) or col["max_delta_e"] < 0:
            cc.at("max_delta_e").error("must be a non-negative number (the observed maximum, not a margin)")
        if col.get("source") not in ("measured", "assumed"):
            cc.at("source").error("must be 'measured' or 'assumed'")

    layouts = _require(raw, "layout_clusters", c, list)
    if layouts is not None and not layouts:
        c.at("layout_clusters").error("needs at least one layout")
    layout_ids: set[str] = set()
    for i, lay in enumerate(layouts or []):
        lc = c.at("layout_clusters").at(i)
        if not isinstance(lay, dict):
            lc.error("must be an object")
            continue
        lid = lay.get("layout_id")
        if not isinstance(lid, str) or not ID.match(lid):
            lc.at("layout_id").error("must use only a-z, 0-9 and _")
        elif lid in layout_ids:
            lc.at("layout_id").error("duplicate layout id")
        else:
            layout_ids.add(lid)
        for pid in lay.get("members", []) or []:
            if pid not in members:
                lc.at("members").error(f"{pid!r} is not a member of this cluster")
        if lay.get("negative_space_pct") is not None:
            check_range(lay["negative_space_pct"], lc.at("negative_space_pct"), support, 0, 1)
        _check_regions(lay.get("regions"), lc.at("regions"), support)

    roles = _require(raw, "type_roles", c, list)
    for i, role in enumerate(roles or []):
        rc = c.at("type_roles").at(i)
        if not isinstance(role, dict):
            rc.error("must be an object")
            continue
        if role.get("role") not in SLOT_ROLES:
            rc.at("role").error(f"must be one of {SLOT_ROLES}")
        if role.get("category") not in FONT_CATEGORIES:
            rc.at("category").error(f"must be one of {FONT_CATEGORIES}")
        if role.get("case") not in CASES:
            rc.at("case").error(f"must be one of {CASES}")
        for key in ("tracking", "size_rel"):
            if key in role:
                check_range(role[key], rc.at(key), support, lo=0 if key == "size_rel" else None)
            else:
                rc.at(key).error("is required")
        matches = role.get("font_matches")
        if not isinstance(matches, list) or not matches:
            rc.at("font_matches").error("needs at least one font match")
        else:
            for j, m in enumerate(matches):
                if not isinstance(m, dict) or not isinstance(m.get("name"), str) or not is_number(m.get("confidence")) or not 0 <= m["confidence"] <= 1:
                    rc.at("font_matches").at(j).error('must be {"name": text, "confidence": 0..1}')
                elif ctx.fonts is not None and m["name"] not in ctx.fonts:
                    rc.at("font_matches").at(j).at("name").error(f"{m['name']!r} is not described in fonts.json")

    textures = _require(raw, "texture_rules", c, list)
    for i, tex in enumerate(textures or []):
        tc = c.at("texture_rules").at(i)
        if not isinstance(tex, dict):
            tc.error("must be an object")
            continue
        if tex.get("blend") and tex["blend"] not in BLEND_MODES:
            tc.at("blend").error(f"unknown blend mode {tex['blend']!r}")
        if "opacity" in tex:
            check_range(tex["opacity"], tc.at("opacity"), support, 0, 1)
        if "asset" in tex:
            _check_texture_asset(tex["asset"], tc.at("asset"))
        prob = tex.get("probability")
        if not is_number(prob) or not 0 <= prob <= 1:
            tc.at("probability").error("must be a number from 0 to 1")

    _check_selection(raw.get("selection"), c.at("selection"), ctx)
    unsupported = raw.get("unsupported_by_engine")
    if not isinstance(unsupported, list) or not all(isinstance(u, str) for u in unsupported):
        c.at("unsupported_by_engine").error("is required and must be a list of text (use [] if none)")

    if any(i.severity == "error" for i in c.issues):
        return None, c.issues
    return raw, c.issues


def _check_regions(regions: Any, c: IssueCollector, support: int) -> None:
    if not isinstance(regions, list) or not regions:
        c.error("needs at least one region")
        return
    seen: set[str] = set()
    for i, r in enumerate(regions):
        rc = c.at(i)
        if not isinstance(r, dict):
            rc.error("must be an object")
            continue
        rid = r.get("id")
        if not isinstance(rid, str) or not rid:
            rc.at("id").error("is required")
        elif rid in seen:
            rc.at("id").error("duplicate region id")
        else:
            seen.add(rid)
        if r.get("role") not in REGION_ROLES:
            rc.at("role").error(f"must be one of {REGION_ROLES}")
        content = r.get("content")
        if r.get("role") == "type" and content not in SLOT_ROLES:
            rc.at("content").error(f"a type region needs a slot role from {SLOT_ROLES}")
        bleed = r.get("bleed", [])
        if not isinstance(bleed, list) or any(e not in EDGES for e in bleed):
            rc.at("bleed").error(f"must be a list of {EDGES}")
            bleed = []
        ok = True
        for key in ("x", "y", "w", "h"):
            ok &= check_range(r.get(key), rc.at(key), support, lo=-0.001 if key in ("x", "y") else 0, hi=1.001 if "right" not in bleed and "bottom" not in bleed else 1.5)
        if ok:
            if r["x"]["median"] + r["w"]["median"] > 1.001 and "right" not in bleed:
                rc.error("x + w runs off the right edge without a 'right' bleed")
            if r["y"]["median"] + r["h"]["median"] > 1.001 and "bottom" not in bleed:
                rc.error("y + h runs off the bottom edge without a 'bottom' bleed")
        if r.get("aspect_ratio") is not None:
            check_range(r["aspect_ratio"], rc.at("aspect_ratio"), support, lo=0.05)
        if r.get("z") is not None and (isinstance(r["z"], bool) or not isinstance(r["z"], int)):
            rc.at("z").error("must be a whole number")


def _check_texture_asset(value: Any, c: IssueCollector) -> None:
    """An optional texture asset: an id from the supplied library (curio/assets), not a halftone map."""
    from curio.core.assets import ASSET_PREFIX, default_library

    if not isinstance(value, str) or not value:
        c.error("must be an asset id from curio/assets/assets_manifest.json")
        return
    try:
        asset = default_library().get(value)
    except KeyError:
        c.error(f"no asset {value.removeprefix(ASSET_PREFIX)!r} in the asset library")
        return
    if asset.kind == "halftone_threshold":
        c.error(f"{asset.id!r} is a halftone map; use it in a halftone_map pipeline step, not as a texture layer")


def _check_selection(sel: Any, c: IssueCollector, ctx: ExportContext) -> None:
    if not isinstance(sel, dict):
        c.error("is required")
        return
    vocab = ctx.vocab
    for key in ("moods", "genres", "subject_types"):
        _string_list(sel.get(key), c.at(key), vocab.get(key) if vocab else None, minimum=1)
    _string_list(sel.get("avoid_when"), c.at("avoid_when"), minimum=1)
    notes = sel.get("director_notes")
    if not isinstance(notes, str) or not notes.strip():
        c.at("director_notes").error("is required")
    elif len(notes) > 300:
        c.at("director_notes").error(f"is {len(notes)} characters; the limit is 300")
    _string_list(sel.get("example_briefs"), c.at("example_briefs"), minimum=2)


# --------------------------------------------------------------------- recipe


def validate_recipe_export(raw: Any, file: str, ctx: ExportContext | None = None) -> tuple[dict[str, Any] | None, list[Issue]]:
    ctx = ctx or ExportContext()
    c = IssueCollector(file)
    if not isinstance(raw, dict):
        c.error("a recipe must be a JSON object")
        return None, c.issues

    # Reuse the engine's own recipe rules first (types, hex colours, ranges).
    doc = validate_recipe(raw, file, c)
    scan_strings(raw, c)
    check_generated(raw, c)

    pid = raw.get("poster_id")
    if isinstance(pid, str) and not POSTER_ID.match(pid):
        c.at("poster_id").error("must look like r_ followed by 12 hex characters")

    ctxm = _require(raw, "measurement_context", c, dict)
    if ctxm is not None:
        for key in ("width_px", "height_px"):
            if not is_number(ctxm.get(key)) or ctxm[key] <= 0:
                c.at("measurement_context").at(key).error("must be a positive number")
        if ctxm.get("source_kind") not in ("digital", "scan", "unknown"):
            c.at("measurement_context").at("source_kind").error("must be digital, scan or unknown")

    conf = raw.get("confidence")
    if not is_number(conf) or not 0 <= conf <= 1:
        c.at("confidence").error("is required and must be a number from 0 to 1")
    if not isinstance(raw.get("unsupported_by_engine"), list):
        c.at("unsupported_by_engine").error("is required (use [] if none)")
    if not isinstance(raw.get("layout"), dict) or not isinstance(raw["layout"].get("regions"), list):
        c.at("layout").error("is required and needs a regions list")
    if not isinstance(raw.get("measurements"), list):
        c.at("measurements").error("is required and must be a list")

    # Stricter than the loader: every op must exist (rule 5).
    for i, step in enumerate(raw.get("photo_pipeline") or []):
        if isinstance(step, dict) and isinstance(step.get("op"), str) and not has_op(step["op"]):
            c.at("photo_pipeline").at(i).at("op").error(f"unknown op {step['op']!r}; list it in unsupported_by_engine instead")

    for i, role in enumerate(raw.get("typography") or []):
        if isinstance(role, dict) and role.get("role") not in SLOT_ROLES:
            c.at("typography").at(i).at("role").error(f"must be one of {SLOT_ROLES}")
        if ctx.fonts is not None and isinstance(role, dict):
            for j, m in enumerate(role.get("font_matches") or []):
                if isinstance(m, dict) and isinstance(m.get("name"), str) and m["name"] not in ctx.fonts:
                    c.at("typography").at(i).at("font_matches").at(j).at("name").error(f"{m['name']!r} is not described in fonts.json")

    errors = any(i.severity == "error" for i in c.issues)
    return (None if errors or doc is None else raw), c.issues


# -------------------------------------------------------------- vocab, fonts


def validate_vocab(raw: Any, file: str) -> tuple[dict[str, list[str]] | None, list[Issue]]:
    c = IssueCollector(file)
    if not isinstance(raw, dict):
        c.error("must be a JSON object")
        return None, c.issues
    check_version(raw, c)
    out: dict[str, list[str]] = {}
    for key in ("moods", "genres", "subject_types"):
        value = raw.get(key)
        if not isinstance(value, list) or not value or not all(isinstance(v, str) and v for v in value):
            c.at(key).error("must be a non-empty list of text")
        elif len(set(value)) != len(value):
            c.at(key).error("contains duplicates")
        else:
            out[key] = value
    return (None if any(i.severity == "error" for i in c.issues) else out), c.issues


def validate_fonts(raw: Any, file: str) -> tuple[set[str] | None, list[Issue]]:
    c = IssueCollector(file)
    if not isinstance(raw, dict) or not isinstance(raw.get("fonts"), list):
        c.error('must be an object with a "fonts" list')
        return None, c.issues
    check_version(raw, c)
    scan_strings(raw, c)
    names: set[str] = set()
    for i, font in enumerate(raw["fonts"]):
        fc = c.at("fonts").at(i)
        if not isinstance(font, dict) or not isinstance(font.get("family"), str):
            fc.at("family").error("is required")
            continue
        names.add(font["family"])
        if font.get("category") not in FONT_CATEGORIES:
            fc.at("category").error(f"must be one of {FONT_CATEGORIES}")
        lic = font.get("license")
        if not isinstance(lic, str) or not lic.strip():
            fc.at("license").error("is required")
        elif not re.search(r"(?i)\b(ofl|open font|apache|mit|cc0|public domain|ufl)\b", lic):
            alts = font.get("free_alternatives")
            if not isinstance(alts, list) or not alts:
                fc.at("free_alternatives").error("a font without an open licence needs at least one open-licensed alternative")
    return (None if any(i.severity == "error" for i in c.issues) else names), c.issues


# ------------------------------------------------------------------ manifest


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass
class ExportBundle:
    root: Path
    vocab: dict[str, list[str]] | None = None
    fonts: set[str] | None = None
    recipes: dict[str, dict[str, Any]] = field(default_factory=dict)
    clusters: dict[str, dict[str, Any]] = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def ok(self) -> bool:
        return not self.errors


def _read_json(path: Path, rel: str, issues: list[Issue]) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        issues.append(Issue(rel, "", "file is missing"))
    except (OSError, UnicodeDecodeError) as error:
        issues.append(Issue(rel, "", f"cannot read file: {error}"))
    except json.JSONDecodeError as error:
        issues.append(Issue(rel, f"line {error.lineno}, column {error.colno}", f"invalid JSON: {error.msg}"))
    return None


def load_export(root: str | Path) -> ExportBundle:
    """Validates a whole export folder. Each bad file is skipped; the rest are checked."""
    root = Path(root)
    bundle = ExportBundle(root)
    issues = bundle.issues
    if not root.is_dir():
        issues.append(Issue(str(root), "", "export folder does not exist"))
        return bundle

    manifest = _read_json(root / "manifest.json", "manifest.json", issues)
    if isinstance(manifest, dict):
        mc = IssueCollector("manifest.json", issues)
        check_version(manifest, mc)
        check_generated(manifest, mc)
        listed: dict[str, str] = {}
        for i, entry in enumerate(manifest.get("files") or []):
            ec = mc.at("files").at(i)
            if not isinstance(entry, dict) or not isinstance(entry.get("path"), str) or not isinstance(entry.get("sha256"), str):
                ec.error('must be {"path", "sha256"}')
                continue
            listed[entry["path"]] = entry["sha256"]
            target = root / entry["path"]
            if not target.is_file():
                ec.at("path").error("listed in the manifest but missing from the export")
            elif sha256_file(target) != entry["sha256"]:
                ec.at("sha256").error("does not match the file; it was edited or the export is partial")
        for path in sorted(root.rglob("*.json")):
            rel = path.relative_to(root).as_posix()
            if rel != "manifest.json" and rel not in listed:
                issues.append(Issue(rel, "", "present but not listed in manifest.json", "warning"))
    elif manifest is not None:
        issues.append(Issue("manifest.json", "", "must be a JSON object"))

    raw_vocab = _read_json(root / "vocab.json", "vocab.json", issues)
    if raw_vocab is not None:
        bundle.vocab, found = validate_vocab(raw_vocab, "vocab.json")
        issues.extend(found)
    raw_fonts = _read_json(root / "fonts.json", "fonts.json", issues)
    if raw_fonts is not None:
        bundle.fonts, found = validate_fonts(raw_fonts, "fonts.json")
        issues.extend(found)

    recipe_files = sorted((root / "recipes").glob("*.json")) if (root / "recipes").is_dir() else []
    ids_on_disk = {p.stem for p in recipe_files}
    ctx = ExportContext(bundle.vocab, bundle.fonts, ids_on_disk)

    for path in recipe_files:
        rel = path.relative_to(root).as_posix()
        raw = _read_json(path, rel, issues)
        if raw is None:
            bundle.skipped.append(rel)
            continue
        doc, found = validate_recipe_export(raw, rel, ctx)
        issues.extend(found)
        if doc is None:
            bundle.skipped.append(rel)
        elif doc.get("poster_id") != path.stem:
            issues.append(Issue(rel, "poster_id", f"is {doc.get('poster_id')!r} but the file is named {path.stem}.json"))
            bundle.skipped.append(rel)
        else:
            bundle.recipes[doc["poster_id"]] = doc

    cluster_files = sorted((root / "clusters").glob("*.json")) if (root / "clusters").is_dir() else []
    for path in cluster_files:
        rel = path.relative_to(root).as_posix()
        raw = _read_json(path, rel, issues)
        if raw is None:
            bundle.skipped.append(rel)
            continue
        doc, found = validate_cluster_export(raw, rel, ctx)
        issues.extend(found)
        if doc is None:
            bundle.skipped.append(rel)
        elif doc.get("cluster_id") != path.stem:
            issues.append(Issue(rel, "cluster_id", f"is {doc.get('cluster_id')!r} but the file is named {path.stem}.json"))
            bundle.skipped.append(rel)
        else:
            bundle.clusters[doc["cluster_id"]] = doc

    if not cluster_files:
        issues.append(Issue("clusters/", "", "no cluster files found", "warning"))
    return bundle

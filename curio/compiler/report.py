"""The human-readable markdown report, generated from a cluster's JSON.

Hand-written numbers are not allowed (spec section 12): this is the only way a
report is produced, so the markdown and the JSON cannot disagree.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _fmt(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.4g}"
    return str(value)


def _range_cells(entry: dict[str, Any]) -> str:
    if "values" in entry:
        return ", ".join(f"{k} ({v})" for k, v in sorted(entry["values"].items()))
    return f"{_fmt(entry['median'])} ({_fmt(entry['min'])} to {_fmt(entry['max'])}, n={entry['n']})"


def render_report(cluster: dict[str, Any]) -> str:
    raw = json.dumps(cluster, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    cid = cluster["cluster_id"]
    out = [f"<!-- generated from clusters/{cid}.json, sha256 {digest}. Do not edit. -->", "", f"# {cluster['title']}", ""]
    q = cluster["quality"]
    out += [
        f"`{cid}`: {cluster['support']} reference poster(s), silhouette {_fmt(q.get('silhouette', 'n/a'))}.",
        "",
        "## Members",
        "",
    ]
    for m in cluster["members"]:
        near = ", ".join(f"{k} {_fmt(v)}" for k, v in sorted(m.get("also_near", {}).items()))
        out.append(f"- `{m['poster_id']}` weight {_fmt(m['weight'])}" + (f", also near: {near}" if near else ""))
    if q.get("outliers"):
        out.append(f"- outliers: {', '.join(q['outliers'])}")
    if q.get("notes"):
        out += ["", f"> {q['notes']}"]

    out += ["", "## Photo treatment", "", "| Step | Op | Optional | Used by |", "| --- | --- | --- | --- |"]
    for s in cluster["pipeline"]:
        out.append(f"| {s.get('id', s['op'])} | {s['op']} | {'yes' if s['optional'] else 'no'} | {_fmt(s['used_by_fraction'])} |")

    out += ["", "## Parameters", "", "| Parameter | Unit | Value | Role | Spread | Source |", "| --- | --- | --- | --- | --- | --- |"]
    for key in sorted(cluster["params"]):
        e = cluster["params"][key]
        out.append(f"| `{key}` | {e['unit']} | {_range_cells(e)} | {e['role']} | {e.get('spread', '-')} | {e['source']} |")

    if cluster["measurements"]:
        out += ["", "## Measurements", "", "| Measurement | Unit | Value |", "| --- | --- | --- |"]
        for key in sorted(cluster["measurements"]):
            e = cluster["measurements"][key]
            out.append(f"| `{key}` | {e['unit']} | {_range_cells(e)} |")

    out += ["", "## Colours", "", "| Role | Colour | Max delta E | n | Source |", "| --- | --- | --- | --- | --- |"]
    for col in cluster["colors"]:
        out.append(f"| {col['role']} | `{col['center']}` | {_fmt(col['max_delta_e'])} | {col.get('n', '-')} | {col['source']} |")

    out += ["", "## Layouts", ""]
    for lay in cluster["layout_clusters"]:
        out.append(f"### `{lay['layout_id']}` ({len(lay.get('members', []))} member(s), alignment {lay.get('alignment', 'left')})")
        out += ["", "| Region | Role | Content | x | y | w | h |", "| --- | --- | --- | --- | --- | --- | --- |"]
        for r in lay["regions"]:
            cells = " | ".join(_fmt(r[k]["median"]) for k in ("x", "y", "w", "h"))
            out.append(f"| {r['id']} | {r['role']} | {r.get('content', '')} | {cells} |")
        out.append("")

    out += ["## Type", "", "| Role | Category | Case | Tracking (em) | Size (of height) | Fonts |", "| --- | --- | --- | --- | --- | --- |"]
    for r in cluster["type_roles"]:
        fonts = ", ".join(f"{m['name']} ({_fmt(m['confidence'])})" for m in r["font_matches"])
        out.append(f"| {r['role']} | {r['category']} | {r['case']} | {_fmt(r['tracking']['median'])} | {_fmt(r['size_rel']['median'])} | {fonts} |")

    s = cluster["selection"]
    out += ["", "## When to use it", "", f"- Moods: {', '.join(s['moods'])}", f"- Genres: {', '.join(s['genres'])}", f"- Subjects: {', '.join(s['subject_types'])}", f"- Avoid when: {'; '.join(s['avoid_when'])}", "", s["director_notes"], ""]
    out += ["## Not supported by the engine", ""]
    out += [f"- {u}" for u in cluster["unsupported_by_engine"]] or ["None."]
    return "\n".join(out).rstrip() + "\n"

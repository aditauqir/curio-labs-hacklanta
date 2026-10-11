"""Using a preset: resolving it to runnable steps, tuning it safely, merging two.

ASSUMPTIONS (the brief does not define these; see curio/OPEN_ITEMS.md). They are
all in this file so changing one is a local edit:

* ``defaults``, ``ranges``, ``defining_params`` and ``free_params`` address a
  parameter by a dotted path ``"<step_id>.<param>"``. A step's id is its ``id``,
  else its op name, else ``op_2``, ``op_3`` for repeats. Paths under
  ``layout_rules`` / ``type_rules`` / ``texture_rules`` address those sections.
* A range is ``[min, max]``, ``{"min", "max"}`` or ``{"choices": [...]}``.
* Defining parameters may move only *inside* their declared range; a request
  outside it is rejected (not clamped), because a clamped value would still be a
  change the director did not intend. A defining parameter with no range cannot
  move at all. Free parameters are clamped into their range instead.
* ``essential_ops`` / ``optional_ops`` match a step id or an op name. A step is
  optional if listed there or marked ``"optional": true``; everything else is
  essential, and ``essential_ops`` wins over ``optional_ops``.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from curio.core.stacks import OpCall
from curio.ops import get_op, validate_params
from curio.ops.registry import param_errors

from .schema import IssueCollector, StyleDocument
from .validate import PRESET_SECTIONS, flatten, flatten_ranges, in_range, is_number, normalise_range, validate_preset


@dataclass(frozen=True)
class TuneEvent:
    path: str
    action: str  # set | clamped | rejected | dropped | kept | blended | adopted
    requested: Any = None
    applied: Any = None
    reason: str = ""

    def __str__(self) -> str:
        return f"{self.action} {self.path}: requested {self.requested!r}, applied {self.applied!r}" + (f" ({self.reason})" if self.reason else "")


@dataclass
class ResolvedStep:
    id: str
    op: str
    params: dict[str, Any]
    optional: bool = False
    enabled: bool = True
    seed: int | None = None

    def to_call(self) -> OpCall:
        return OpCall(op=self.op, params=dict(self.params), seed=self.seed, enabled=self.enabled, id=self.id)


@dataclass
class ResolvedPreset:
    preset_id: str
    steps: list[ResolvedStep]
    values: dict[str, Any]
    log: list[TuneEvent] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)

    def to_calls(self) -> list[OpCall]:
        return [step.to_call() for step in self.steps if step.enabled]

    def rejected(self) -> list[TuneEvent]:
        return [e for e in self.log if e.action == "rejected"]


class Preset:
    """A validated style family preset."""

    def __init__(self, doc: StyleDocument) -> None:
        if doc.kind != "preset":
            raise ValueError("not a preset document")
        self.doc = doc
        self.data = doc.data
        self.id: str = doc.id
        self.family: str = self.data["family"]
        self.steps: list[dict[str, Any]] = self.data["pipeline"]
        self.defaults: dict[str, Any] = flatten(self.data["defaults"])
        self.defining: list[str] = list(self.data["defining_params"])
        self.free: list[str] = list(self.data["free_params"])
        self.when_to_use: dict[str, list[str]] = self.data["when_to_use"]

        self.ranges: dict[str, dict[str, Any]] = {}
        for path, spec in flatten_ranges(self.data["ranges"]).items():
            normalised = normalise_range(spec, IssueCollector("<preset>"))
            if normalised is not None:
                self.ranges[path] = normalised

    # ---------------------------------------------------------------- helpers

    def is_essential(self, step: dict[str, Any]) -> bool:
        names = {step["id"], step["op"]}
        if names & set(self.data["essential_ops"]):
            return True
        if step.get("optional") or names & set(self.data["optional_ops"]):
            return False
        return True

    def tunable_paths(self) -> list[str]:
        return sorted(set(self.defining) | set(self.free))

    def range_of(self, path: str) -> dict[str, Any] | None:
        return self.ranges.get(path)

    # ---------------------------------------------------------------- resolve

    def resolve(self, overrides: dict[str, Any] | None = None, drop: list[str] | None = None) -> ResolvedPreset:
        """Produces runnable steps with tuning applied and every decision logged."""
        steps = {s["id"]: copy.deepcopy(s) for s in self.steps}
        values: dict[str, Any] = {}
        log: list[TuneEvent] = []

        for step_id, step in steps.items():
            effective = dict(step["params"])
            for path, value in self.defaults.items():
                head, _, rest = path.partition(".")
                if head == step_id and rest:
                    effective[rest] = value
            step["params"] = effective
            for name, value in effective.items():
                values[f"{step_id}.{name}"] = value
        for path, value in self.defaults.items():
            if path.partition(".")[0] in PRESET_SECTIONS:
                values[path] = value

        for path, requested in flatten(overrides or {}).items() if _nested(overrides) else (overrides or {}).items():
            self._apply_override(path, requested, steps, values, log)

        dropped: list[str] = []
        for step_id in drop or []:
            step = steps.get(step_id) or next((s for s in steps.values() if s["op"] == step_id), None)
            if step is None:
                log.append(TuneEvent(step_id, "rejected", reason="no such step to drop"))
            elif self.is_essential(step):
                log.append(TuneEvent(step["id"], "rejected", reason="essential steps always run"))
            else:
                dropped.append(step["id"])
                log.append(TuneEvent(step["id"], "dropped", reason="optional step removed"))

        resolved = [
            ResolvedStep(s["id"], s["op"], s["params"], not self.is_essential(s), s["enabled"], s.get("seed"))
            for s in steps.values()
            if s["id"] not in dropped
        ]
        return ResolvedPreset(self.id, resolved, values, log, dropped)

    def _apply_override(self, path: str, requested: Any, steps: dict, values: dict, log: list[TuneEvent]) -> None:
        tunable = path in self.defining or path in self.free
        if not tunable:
            log.append(TuneEvent(path, "rejected", requested, values.get(path), "not a tunable parameter of this preset"))
            return

        spec = self.ranges.get(path)
        applied = requested
        action = "set"

        if path in self.defining:
            if spec is None:
                log.append(TuneEvent(path, "rejected", requested, values.get(path), "defining parameter has no range, so it is fixed"))
                return
            if not in_range(requested, spec):
                log.append(TuneEvent(path, "rejected", requested, values.get(path), f"outside the defining range {_show(spec)}; that would change the style"))
                return
        elif spec is not None and not in_range(requested, spec):
            if "choices" in spec or not is_number(requested):
                log.append(TuneEvent(path, "rejected", requested, values.get(path), f"must be within {_show(spec)}"))
                return
            applied = min(max(requested, spec["min"]), spec["max"])
            action = "clamped"

        head, _, rest = path.partition(".")
        if head in steps:
            op_spec = get_op(steps[head]["op"])
            resolved, issues = validate_params(op_spec, {rest: applied}, on_range="clamp")
            errors = param_errors(issues)
            if errors:
                log.append(TuneEvent(path, "rejected", requested, values.get(path), "; ".join(str(e) for e in errors)))
                return
            if any(i.clamped for i in issues):
                applied, action = resolved[rest], "clamped"
            steps[head]["params"][rest] = applied
        values[path] = applied
        log.append(TuneEvent(path, action, requested, applied, f"within {_show(spec)}" if spec else ""))


def _nested(overrides: dict[str, Any] | None) -> bool:
    return bool(overrides) and any(isinstance(v, dict) for v in overrides.values())


def _show(spec: dict[str, Any] | None) -> str:
    if not spec:
        return "its limits"
    return f"{spec['choices']}" if "choices" in spec else f"{spec['min']}..{spec['max']}"


# ------------------------------------------------------------------- merging


def merge_presets(
    primary: Preset,
    secondary: Preset,
    weight: float = 0.5,
    adopt_steps: list[str] | None = None,
) -> tuple[Preset, list[TuneEvent]]:
    """Blends two presets, explicitly, and returns the merge log with the result.

    ``primary`` stays the style: its pipeline, rules and defining parameters are
    kept as they are. Free numeric defaults present in both presets are
    interpolated by ``weight`` toward ``secondary`` (and held inside primary's
    range). ``adopt_steps`` lists secondary step ids to append to the pipeline,
    as optional free steps. Nothing happens that is not in the returned log.
    """
    if not 0.0 <= weight <= 1.0:
        raise ValueError("weight must be between 0 and 1")
    log: list[TuneEvent] = []
    data = copy.deepcopy(primary.data)
    data["preset_id"] = f"{primary.id}+{secondary.id}"
    data["merged_from"] = {"primary": primary.id, "secondary": secondary.id, "weight": weight, "adopted_steps": list(adopt_steps or [])}

    defaults = dict(primary.defaults)
    for path, secondary_value in secondary.defaults.items():
        if path in primary.defining:
            log.append(TuneEvent(path, "kept", secondary_value, defaults.get(path), "defining parameter of the primary style"))
            continue
        if path not in primary.free or path not in secondary.free or path not in defaults:
            continue
        mine = defaults[path]
        if is_number(mine) and is_number(secondary_value):
            blended = mine + (secondary_value - mine) * weight
            spec = primary.ranges.get(path)
            if spec and "min" in spec:
                held = min(max(blended, spec["min"]), spec["max"])
                if held != blended:
                    log.append(TuneEvent(path, "clamped", blended, held, f"held inside the primary range {_show(spec)}"))
                blended = held
            defaults[path] = blended
            log.append(TuneEvent(path, "blended", secondary_value, blended, f"{mine} -> {secondary_value} at weight {weight}"))
        else:
            log.append(TuneEvent(path, "kept", secondary_value, mine, "non-numeric values are not blended"))

    taken = {s["id"] for s in primary.steps}
    secondary_steps = {s["id"]: s for s in secondary.steps}
    ranges = {path: copy.deepcopy(spec) for path, spec in primary.ranges.items()}
    free = list(primary.free)
    for step_id in adopt_steps or []:
        step = secondary_steps.get(step_id)
        if step is None:
            raise ValueError(f"secondary preset has no step {step_id!r} to adopt")
        new_id = step_id if step_id not in taken else f"{step_id}_{secondary.id}"
        taken.add(new_id)
        adopted = {**copy.deepcopy(step), "id": new_id, "optional": True}
        data["pipeline"].append(adopted)
        for path, value in secondary.defaults.items():
            head, _, rest = path.partition(".")
            if head == step_id:
                defaults[f"{new_id}.{rest}"] = value
        for path, spec in secondary.ranges.items():
            head, _, rest = path.partition(".")
            if head == step_id:
                ranges[f"{new_id}.{rest}"] = copy.deepcopy(spec)
        for path in secondary.free:
            head, _, rest = path.partition(".")
            if head == step_id:
                free.append(f"{new_id}.{rest}")
        log.append(TuneEvent(new_id, "adopted", step_id, new_id, f"step from {secondary.id}, added as optional and free"))

    data["defaults"] = defaults
    data["ranges"] = ranges
    data["free_params"] = free
    collector = IssueCollector(f"<merge {primary.id}+{secondary.id}>")
    doc = validate_preset(data, collector.file, collector)
    if doc is None:
        raise ValueError("merge produced an invalid preset: " + "; ".join(str(i) for i in collector.issues if i.severity == "error"))
    return Preset(doc), log

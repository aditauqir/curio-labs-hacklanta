"""The op registry.

An op is a typed, pure function ``fn(image, params, seed) -> image``. Adding one
means writing a module that decorates a function with :func:`register_op`; the
pipeline runner never needs to know about it, because it only looks ops up by
name here.

Every op declares a parameter schema (type, min, max, default). That schema is
what lets a style preset be validated against the real op library before it is
ever run.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

import numpy as np

from curio.core.color import is_hex
from curio.core.image import Image, merge_alpha, split_alpha


class OpError(Exception):
    """Raised for an unknown op, bad params, or an op that broke its contract."""


@dataclass(frozen=True)
class Param:
    name: str
    type: str  # float | int | bool | choice | color | color_list | float_list | image | str
    default: Any
    min: float | None = None
    max: float | None = None
    choices: tuple[str, ...] | None = None
    min_items: int | None = None
    max_items: int | None = None
    doc: str = ""
    #: True when the value is a length in pixels at the reference size. Such values
    #: are scaled by output size at render time (see curio/ops/units.py).
    length: bool = False

    def describe(self) -> dict[str, Any]:
        out: dict[str, Any] = {"name": self.name, "type": self.type, "default": self.default}
        for key in ("min", "max", "choices", "min_items", "max_items"):
            value = getattr(self, key)
            if value is not None:
                out[key] = value
        if self.doc:
            out["doc"] = self.doc
        if self.length:
            out["length"] = True
        return out


def Float(name: str, default: float, min: float, max: float, doc: str = "") -> Param:
    return Param(name, "float", default, min, max, doc=doc)


def Int(name: str, default: int, min: int, max: int, doc: str = "") -> Param:
    return Param(name, "int", default, min, max, doc=doc)


def Bool(name: str, default: bool, doc: str = "") -> Param:
    return Param(name, "bool", default, doc=doc)


def Choice(name: str, default: str, choices: Iterable[str], doc: str = "") -> Param:
    return Param(name, "choice", default, choices=tuple(choices), doc=doc)


def Color(name: str, default: str, doc: str = "") -> Param:
    return Param(name, "color", default, doc=doc)


def ColorList(name: str, default: list[str], min_items: int = 1, max_items: int = 16, doc: str = "") -> Param:
    return Param(name, "color_list", list(default), min_items=min_items, max_items=max_items, doc=doc)


def FloatList(name: str, default: list[float], min: float, max: float, min_items: int = 1, max_items: int = 64, doc: str = "") -> Param:
    return Param(name, "float_list", list(default), min, max, min_items=min_items, max_items=max_items, doc=doc)


def ImageParam(name: str, doc: str = "") -> Param:
    return Param(name, "image", None, doc=doc)


class Params(dict):
    """A resolved parameter set with attribute access (``p.amount``)."""

    def __getattr__(self, key: str) -> Any:
        try:
            return self[key]
        except KeyError as error:
            raise AttributeError(key) from error


@dataclass(frozen=True)
class ParamIssue:
    param: str
    message: str
    clamped: bool = False

    def __str__(self) -> str:
        return f"{self.param}: {self.message}"


@dataclass
class OpSpec:
    name: str
    fn: Callable[[Image, Params, int], Image]
    params: dict[str, Param]
    category: str = ""
    stochastic: bool = False
    uses_alpha: bool = False
    changes_size: bool = False
    outputs_alpha: bool = False
    doc: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "category": self.category,
            "stochastic": self.stochastic,
            "uses_alpha": self.uses_alpha,
            "changes_size": self.changes_size,
            "outputs_alpha": self.outputs_alpha,
            "doc": self.doc,
            "params": [p.describe() for p in self.params.values()],
        }


_REGISTRY: dict[str, OpSpec] = {}


def register_op(
    name: str,
    *,
    category: str,
    params: Iterable[Param] = (),
    stochastic: bool = False,
    uses_alpha: bool = False,
    changes_size: bool = False,
    outputs_alpha: bool = False,
) -> Callable[[Callable[[Image, Params, int], Image]], Callable[[Image, Params, int], Image]]:
    """Registers an op.

    ``uses_alpha`` ops receive the full image including alpha; ``changes_size`` ops
    may return a different height and width; ``outputs_alpha`` ops always return
    RGBA (they write a matte), so RGB input is allowed to become RGBA.
    """

    def decorator(fn: Callable[[Image, Params, int], Image]):
        if name in _REGISTRY:
            raise OpError(f"op {name!r} is already registered")
        _REGISTRY[name] = OpSpec(
            name=name,
            fn=fn,
            params={p.name: p for p in params},
            category=category,
            stochastic=stochastic,
            uses_alpha=uses_alpha or changes_size or outputs_alpha,
            changes_size=changes_size,
            outputs_alpha=outputs_alpha,
            doc=(fn.__doc__ or "").strip().split("\n")[0],
        )
        return fn

    return decorator


def has_op(name: str) -> bool:
    return name in _REGISTRY


def get_op(name: str) -> OpSpec:
    try:
        return _REGISTRY[name]
    except KeyError as error:
        raise OpError(f"unknown op {name!r}") from error


def list_ops(category: str | None = None) -> list[OpSpec]:
    ops = sorted(_REGISTRY.values(), key=lambda spec: (spec.category, spec.name))
    return [spec for spec in ops if category is None or spec.category == category]


# ---------------------------------------------------------------- validation


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _check_range(param: Param, number: float, label: str, on_range: str, issues: list[ParamIssue]) -> float:
    lo = param.min if param.min is not None else -math.inf
    hi = param.max if param.max is not None else math.inf
    if lo <= number <= hi:
        return number
    clamped = min(max(number, lo), hi)
    issues.append(ParamIssue(label, f"{number:g} is outside {param.min}..{param.max}", clamped=on_range == "clamp"))
    return clamped


def _coerce(param: Param, value: Any, on_range: str, issues: list[ParamIssue]) -> Any:
    name, kind = param.name, param.type

    if kind in ("float", "int"):
        number = _number(value)
        if number is None:
            issues.append(ParamIssue(name, "must be a number"))
            return param.default
        if kind == "int":
            if number != int(number):
                issues.append(ParamIssue(name, "must be a whole number"))
                return param.default
            return int(_check_range(param, number, name, on_range, issues))
        return float(_check_range(param, number, name, on_range, issues))

    if kind == "bool":
        if not isinstance(value, bool):
            issues.append(ParamIssue(name, "must be true or false"))
            return param.default
        return value

    if kind == "choice":
        if value not in (param.choices or ()):
            issues.append(ParamIssue(name, f"must be one of {list(param.choices or ())}"))
            return param.default
        return value

    if kind == "color":
        if not is_hex(value):
            issues.append(ParamIssue(name, "must be a #RRGGBB colour"))
            return param.default
        return _normalise_hex(value)

    if kind == "color_list":
        if not isinstance(value, (list, tuple)) or not all(is_hex(v) for v in value):
            issues.append(ParamIssue(name, "must be a list of #RRGGBB colours"))
            return list(param.default)
        if not (param.min_items or 0) <= len(value) <= (param.max_items or 10**6):
            issues.append(ParamIssue(name, f"needs {param.min_items} to {param.max_items} colours"))
            return list(param.default)
        return [_normalise_hex(v) for v in value]

    if kind == "float_list":
        if not isinstance(value, (list, tuple)) or any(_number(v) is None for v in value):
            issues.append(ParamIssue(name, "must be a list of numbers"))
            return list(param.default)
        if not (param.min_items or 0) <= len(value) <= (param.max_items or 10**6):
            issues.append(ParamIssue(name, f"needs {param.min_items} to {param.max_items} numbers"))
            return list(param.default)
        return [float(_check_range(param, float(v), f"{name}[{i}]", on_range, issues)) for i, v in enumerate(value)]

    if kind == "image":
        if value is None or isinstance(value, (str, np.ndarray)):
            return value
        issues.append(ParamIssue(name, "must be an image array or an asset id"))
        return None

    if kind == "str":
        if not isinstance(value, str):
            issues.append(ParamIssue(name, "must be text"))
            return param.default
        return value

    raise OpError(f"op parameter {name!r} has unknown type {kind!r}")


def _normalise_hex(value: str) -> str:
    digits = value.strip().lstrip("#")
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    return "#" + digits.upper()


def validate_params(
    spec: OpSpec, raw: dict[str, Any] | None, on_range: str = "error"
) -> tuple[Params, list[ParamIssue]]:
    """Checks ``raw`` against the op schema and fills in defaults.

    ``on_range="error"`` reports out-of-range values as errors (what preset
    validation wants); ``"clamp"`` clamps them and flags the issue as clamped
    (what a runtime render wants).
    """
    raw = dict(raw or {})
    issues: list[ParamIssue] = []
    resolved = Params()

    for key in raw:
        if key not in spec.params:
            issues.append(ParamIssue(key, f"op {spec.name!r} has no parameter {key!r}"))

    for name, param in spec.params.items():
        if name in raw:
            resolved[name] = _coerce(param, raw[name], on_range, issues)
        else:
            resolved[name] = list(param.default) if isinstance(param.default, list) else param.default

    return resolved, issues


def param_errors(issues: list[ParamIssue]) -> list[ParamIssue]:
    return [issue for issue in issues if not issue.clamped]


# ------------------------------------------------------------------ running


def apply_op(name: str, image: Image, params: dict[str, Any] | None = None, seed: int = 0, on_range: str = "clamp") -> Image:
    """Runs one op. Validates params, preserves alpha, and enforces the contract.

    Raises :class:`OpError` for an unknown op, invalid params, or output that is
    not finite or has the wrong shape.
    """
    spec = get_op(name)
    resolved, issues = validate_params(spec, params, on_range=on_range)
    errors = param_errors(issues)
    if errors:
        raise OpError(f"{name}: " + "; ".join(str(issue) for issue in errors))

    if image.dtype != np.float32:
        image = image.astype(np.float32)

    if spec.uses_alpha:
        out = spec.fn(image, resolved, int(seed))
    else:
        rgb, alpha = split_alpha(image)
        out = merge_alpha(spec.fn(np.ascontiguousarray(rgb), resolved, int(seed)), alpha)

    out = np.asarray(out, dtype=np.float32)
    if not np.all(np.isfinite(out)):
        raise OpError(f"{name}: produced non-finite pixels")
    if out.ndim != 3 or out.shape[2] not in (3, 4):
        raise OpError(f"{name}: returned an array of shape {out.shape}")
    if spec.outputs_alpha and out.shape[2] != 4:
        raise OpError(f"{name}: declared outputs_alpha but returned {out.shape[2]} channels")
    expected = image.shape[:2] if spec.outputs_alpha else image.shape
    if not spec.changes_size and out.shape[: len(expected)] != expected:
        raise OpError(f"{name}: changed the image shape from {image.shape} to {out.shape}")
    return np.clip(out, 0.0, 1.0)

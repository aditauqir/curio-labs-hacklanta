"""The image op library.

Importing this package discovers every module in it, so a new op is added by
dropping in a module; the registry and the pipeline runner are never edited.
"""

from __future__ import annotations

import importlib
import pkgutil

from .registry import (
    Bool,
    Choice,
    Color,
    ColorList,
    Float,
    FloatList,
    ImageParam,
    Int,
    OpError,
    OpSpec,
    Param,
    ParamIssue,
    Params,
    apply_op,
    get_op,
    has_op,
    list_ops,
    param_errors,
    register_op,
    validate_params,
)

for _module in pkgutil.iter_modules(__path__):
    if _module.name not in ("registry", "units") and not _module.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_module.name}")

from . import units  # noqa: E402  (must run after every op module has registered)

__all__ = [
    "Bool",
    "Choice",
    "Color",
    "ColorList",
    "Float",
    "FloatList",
    "ImageParam",
    "Int",
    "OpError",
    "OpSpec",
    "Param",
    "ParamIssue",
    "Params",
    "apply_op",
    "get_op",
    "has_op",
    "list_ops",
    "param_errors",
    "register_op",
    "validate_params",
]

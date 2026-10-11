"""Effect stacks: ordered, reusable chains of op calls.

A stack is data (a list of :class:`OpCall`), so a style preset can name one and
a layer can carry one. Seeds are derived per step from a single top-level seed,
so a whole chain is reproducible from one number.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from curio.core.image import Image
from curio.core.seed import derive_seed


@dataclass
class OpCall:
    """One step: an op name, its params, and an optional pinned seed."""

    op: str
    params: dict[str, Any] = field(default_factory=dict)
    seed: int | None = None
    enabled: bool = True
    id: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "OpCall":
        return cls(
            op=data["op"],
            params=dict(data.get("params") or {}),
            seed=data.get("seed"),
            enabled=bool(data.get("enabled", True)),
            id=data.get("id"),
        )


_NAMED: dict[str, list[OpCall]] = {}


def register_stack(name: str, calls: Iterable[OpCall | dict[str, Any]]) -> None:
    """Saves a named chain (for example ``"warm_print"``) for reuse."""
    _NAMED[name] = [call if isinstance(call, OpCall) else OpCall.from_dict(call) for call in calls]


def get_stack(name: str) -> list[OpCall]:
    try:
        return list(_NAMED[name])
    except KeyError as error:
        raise KeyError(f"no effect stack named {name!r}") from error


def step_seed(seed: int, index: int, call: OpCall) -> int:
    """The seed a step actually runs with: pinned if set, otherwise derived."""
    return call.seed if call.seed is not None else derive_seed(seed, "step", index, call.op)


def run_stack(image: Image, calls: Iterable[OpCall | dict[str, Any]] | str, seed: int = 0, on_range: str = "clamp") -> Image:
    """Runs a chain of ops over ``image`` and returns the result."""
    from curio.ops import apply_op  # imported late: ops depend on core

    if isinstance(calls, str):
        calls = get_stack(calls)

    out = image
    for index, raw in enumerate(calls):
        call = raw if isinstance(raw, OpCall) else OpCall.from_dict(raw)
        if not call.enabled:
            continue
        out = apply_op(call.op, out, call.params, seed=step_seed(seed, index, call), on_range=on_range)
    return out

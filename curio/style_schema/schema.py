"""Shared types and versioning for the style library.

Styles are data. The engine reads them; it never contains a specific style.
Versioning follows the usual rule: the major number must match what this code
understands, a newer minor number is accepted (unknown fields are preserved and
ignored), and a missing version is treated as 1.0 with a warning.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SUPPORTED_MAJOR = 1
CURRENT_VERSION = "1.0"

_VERSION = re.compile(r"^(\d+)\.(\d+)$")
STEP_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


@dataclass(frozen=True)
class Issue:
    """One problem found in one style file, pointing at the exact field."""

    file: str
    path: str  # for example "pipeline[2].params.gamma"
    message: str
    severity: str = "error"  # error: the file is skipped. warning: it still loads.

    def __str__(self) -> str:
        return f"{self.file}: {self.path or '(root)'}: {self.message} [{self.severity}]"


class IssueCollector:
    """Collects issues with a path prefix, the way the TypeScript validators do."""

    def __init__(self, file: str, issues: list[Issue] | None = None, base: str = "") -> None:
        self.file = file
        self.issues: list[Issue] = issues if issues is not None else []
        self.base = base

    def at(self, segment: str | int) -> "IssueCollector":
        if isinstance(segment, int):
            path = f"{self.base}[{segment}]"
        else:
            path = f"{self.base}.{segment}" if self.base else segment
        return IssueCollector(self.file, self.issues, path)

    def error(self, message: str) -> None:
        self.issues.append(Issue(self.file, self.base, message, "error"))

    def warn(self, message: str) -> None:
        self.issues.append(Issue(self.file, self.base, message, "warning"))

    @property
    def has_errors(self) -> bool:
        return any(i.severity == "error" for i in self.issues if i.file == self.file)


def check_version(data: dict[str, Any], c: IssueCollector) -> str:
    """Validates ``schema_version`` and returns the version to record."""
    raw = data.get("schema_version")
    if raw is None:
        c.at("schema_version").warn(f"missing; assuming {CURRENT_VERSION}")
        return CURRENT_VERSION
    match = _VERSION.match(raw) if isinstance(raw, str) else None
    if not match:
        c.at("schema_version").error(f'must look like "1.0", got {raw!r}')
        return CURRENT_VERSION
    major, minor = int(match.group(1)), int(match.group(2))
    if major != SUPPORTED_MAJOR:
        c.at("schema_version").error(f"major version {major} is not supported (this build reads {SUPPORTED_MAJOR}.x)")
    elif (major, minor) > tuple(int(p) for p in CURRENT_VERSION.split(".")):
        c.at("schema_version").warn(f"newer than {CURRENT_VERSION}; fields this build does not know are kept and ignored")
    return raw


@dataclass
class StyleDocument:
    """A validated style file. ``data`` has defaults filled in and unknown fields kept."""

    kind: str  # "preset" or "recipe"
    id: str
    schema_version: str
    data: dict[str, Any]
    path: Path | None = None
    warnings: list[Issue] = field(default_factory=list)

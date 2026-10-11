"""Compiled styles: presets, layouts and templates, loaded as one consistent set.

A template is only a reference (preset + layout + a small override patch), so the
set is only valid as a whole. Loading checks that every template points at a
preset and layout that exist and that its overrides are ones the preset accepts;
a template that fails is skipped and reported, and the rest still load.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from curio.layout.schema import Layout, LayoutError, parse_layout
from curio.style_schema import Issue, Preset, StyleLibrary


@dataclass
class TemplateRef:
    """A template with its preset and layout resolved."""

    template: dict[str, Any]
    preset: Preset
    layout: Layout

    @property
    def id(self) -> str:
        return self.template["template_id"]


@dataclass
class CompiledStyles:
    presets: dict[str, Preset] = field(default_factory=dict)
    layouts: dict[str, Layout] = field(default_factory=dict)
    templates: dict[str, dict[str, Any]] = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    def resolve(self, template_id: str) -> TemplateRef:
        try:
            template = self.templates[template_id]
        except KeyError as error:
            raise KeyError(f"no template {template_id!r}; available: {sorted(self.templates)}") from error
        return TemplateRef(template, self.presets[template["preset_id"]], self.layouts[template["layout_id"]])

    def refs(self) -> list[TemplateRef]:
        return [self.resolve(t) for t in sorted(self.templates)]


class StyleSource(Protocol):
    """Anything that can supply compiled styles: a folder, a database."""

    def load(self) -> CompiledStyles: ...


def check_template(raw: Any, name: str, presets: dict[str, Preset], layouts: dict[str, Layout]) -> list[Issue]:
    """Problems with one template document (empty when it is usable)."""
    if not isinstance(raw, dict):
        return [Issue(name, "", "a template must be a JSON object")]
    issues: list[Issue] = []
    for key in ("template_id", "preset_id", "layout_id"):
        if not isinstance(raw.get(key), str) or not raw[key]:
            issues.append(Issue(name, key, "is required text"))
    if issues:
        return issues
    preset, layout = presets.get(raw["preset_id"]), layouts.get(raw["layout_id"])
    if preset is None:
        issues.append(Issue(name, "preset_id", f"no preset {raw['preset_id']!r} is loaded"))
    if layout is None:
        issues.append(Issue(name, "layout_id", f"no layout {raw['layout_id']!r} is loaded"))
    overrides = raw.get("overrides", {})
    if not isinstance(overrides, dict):
        issues.append(Issue(name, "overrides", "must be an object"))
    elif preset is not None:
        for event in preset.resolve(overrides).rejected():
            issues.append(Issue(name, f"overrides.{event.path}", f"the preset rejects this override: {event.reason}"))
    return issues


def add_layout(styles: CompiledStyles, name: str, text: str) -> None:
    """Parses one layout document into ``styles``, or records why it was skipped."""
    try:
        layout = parse_layout(json.loads(text))
    except (ValueError, LayoutError) as error:
        styles.issues.append(Issue(name, "", str(error)))
        return
    if layout.layout_id in styles.layouts:
        styles.issues.append(Issue(name, "layout_id", f"duplicate layout id {layout.layout_id!r}"))
        return
    styles.layouts[layout.layout_id] = layout


def add_template(styles: CompiledStyles, name: str, text: str) -> None:
    """Checks one template against the presets and layouts already in ``styles``."""
    try:
        raw = json.loads(text)
    except ValueError as error:
        styles.issues.append(Issue(name, "", f"cannot read: {error}"))
        return
    problems = check_template(raw, name, styles.presets, styles.layouts)
    if problems:
        styles.issues.extend(problems)
    elif raw["template_id"] in styles.templates:
        styles.issues.append(Issue(name, "template_id", f"duplicate template id {raw['template_id']!r}"))
    else:
        styles.templates[raw["template_id"]] = raw


def _read(path: Path, name: str, styles: CompiledStyles) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        styles.issues.append(Issue(name, "", f"cannot read: {error}"))
        return None


class DirectorySource:
    """Reads ``presets/``, ``layouts/`` and ``templates/`` from a compiled folder."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def load(self) -> CompiledStyles:
        styles = CompiledStyles()
        library = StyleLibrary(self.root / "presets")
        styles.issues.extend(library.load().issues)
        styles.presets = library.presets

        for folder, add in (("layouts", add_layout), ("templates", add_template)):
            directory = self.root / folder
            for path in sorted(directory.glob("*.json")) if directory.is_dir() else []:
                name = f"{folder}/{path.name}"
                text = _read(path, name, styles)
                if text is not None:
                    add(styles, name, text)
        return styles

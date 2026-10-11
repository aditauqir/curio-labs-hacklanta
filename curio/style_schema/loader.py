"""Loading the style library from a directory of JSON files.

Each file is validated on its own. A file with an error is skipped and reported
(file, field, message); every other file still loads. ``refresh()`` re-reads
only what changed on disk, which is the hot-reload mechanism, and ``watch()``
runs it on a timer.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .fallback import fallback_presets
from .preset import Preset
from .schema import Issue, IssueCollector, StyleDocument
from .validate import validate_preset, validate_recipe

Signature = tuple[int, int]  # (mtime_ns, size)


@dataclass
class FileRecord:
    signature: Signature
    kind: str | None = None
    style_id: str | None = None
    parse_issues: list[Issue] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)  # parse issues plus any duplicate-id error
    loaded: bool = False


@dataclass
class ChangeSet:
    added: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.added or self.updated or self.removed)


@dataclass
class LoadReport:
    loaded: list[str]
    skipped: list[str]
    issues: list[Issue]

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "warning"]


def parse_style_text(text: str, file: str) -> tuple[StyleDocument | None, list[Issue]]:
    """Parses and validates one file's text. Pure, so it is easy to test."""
    collector = IssueCollector(file)
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as error:
        collector.base = f"line {error.lineno}, column {error.colno}"
        collector.error(f"invalid JSON: {error.msg}")
        return None, collector.issues

    if not isinstance(raw, dict):
        collector.error("a style file must contain one JSON object")
        return None, collector.issues

    is_preset, is_recipe = "preset_id" in raw, "poster_id" in raw
    if is_preset and is_recipe:
        collector.error('ambiguous: has both "preset_id" and "poster_id"')
        return None, collector.issues
    if not is_preset and not is_recipe:
        collector.error('cannot tell what this is: a preset needs "preset_id", a recipe needs "poster_id"')
        return None, collector.issues

    doc = validate_preset(raw, file, collector) if is_preset else validate_recipe(raw, file, collector)
    return doc, collector.issues


def default_styles_dir() -> Path:
    """``$CURIO_STYLES_DIR`` if set, else the ``curio/styles`` folder next to the code."""
    configured = os.environ.get("CURIO_STYLES_DIR")
    return Path(configured) if configured else Path(__file__).resolve().parent.parent / "styles"


class StyleLibrary:
    """Presets and recipes loaded from a directory.

    The directory is configurable: pass one, set ``CURIO_STYLES_DIR``, or use the
    default ``curio/styles``. Pass ``None`` for an empty library.
    """

    def __init__(self, directory: str | Path | None = ..., include_fallbacks: bool = False) -> None:  # type: ignore[assignment]
        if directory is ...:
            directory = default_styles_dir()
        self.directory = Path(directory) if directory is not None else None
        self.include_fallbacks = include_fallbacks
        self._files: dict[Path, FileRecord] = {}
        self._parsed: dict[Path, StyleDocument] = {}  # valid on their own
        self._docs: dict[Path, StyleDocument] = {}  # accepted after duplicate resolution
        self._fallbacks: dict[str, Preset] = {}
        self._lock = threading.RLock()
        self._watcher: threading.Thread | None = None
        self._stop = threading.Event()

    # ----------------------------------------------------------------- reading

    def _scan(self) -> dict[Path, Signature]:
        found: dict[Path, Signature] = {}
        if self.directory is None or not self.directory.is_dir():
            return found
        for path in sorted(self.directory.rglob("*.json")):
            relative = path.relative_to(self.directory)
            if any(part.startswith(".") or part.startswith("_") for part in relative.parts):
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            found[path] = (stat.st_mtime_ns, stat.st_size)
        return found

    def _read(self, path: Path) -> FileRecord:
        stat = path.stat()
        record = FileRecord((stat.st_mtime_ns, stat.st_size))
        name = self._name(path)
        try:
            text = path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeDecodeError) as error:
            record.parse_issues = [Issue(name, "", f"cannot read file: {error}")]
            self._parsed.pop(path, None)
            return record
        doc, issues = parse_style_text(text, name)
        record.parse_issues = issues
        if doc is None:
            self._parsed.pop(path, None)
        else:
            record.kind, record.style_id = doc.kind, doc.id
            doc.path = path
            self._parsed[path] = doc
        return record
    def _name(self, path: Path) -> str:
        return path.relative_to(self.directory).as_posix() if self.directory else path.name

    def _resolve_duplicates(self) -> None:
        """Rebuilds the accepted set. The first file (sorted) wins an id; later ones are skipped."""
        self._docs.clear()
        seen: dict[tuple[str, str], Path] = {}
        for path in sorted(self._files):
            record = self._files[path]
            record.issues = list(record.parse_issues)
            doc = self._parsed.get(path)
            if doc is None:
                record.loaded = False
                continue
            key = (doc.kind, doc.id)
            if key in seen:
                field_name = "preset_id" if doc.kind == "preset" else "poster_id"
                record.issues.append(Issue(self._name(path), field_name, f"duplicate {doc.kind} id {doc.id!r}; already loaded from {self._name(seen[key])}"))
                record.loaded = False
            else:
                seen[key] = path
                self._docs[path] = doc
                record.loaded = True
    def load(self) -> LoadReport:
        """Reads every file from scratch."""
        with self._lock:
            self._files.clear()
            self._parsed.clear()
            for path in self._scan():
                self._files[path] = self._read(path)
            self._resolve_duplicates()
            self._fallbacks = {p.id: p for p in fallback_presets()} if self.include_fallbacks else {}
            return self.report()

    def refresh(self) -> ChangeSet:
        """Re-reads only files that were added, changed or removed since the last read."""
        with self._lock:
            changes = ChangeSet()
            current = self._scan()
            for path in sorted(set(self._files) - set(current)):
                del self._files[path]
                self._parsed.pop(path, None)
                changes.removed.append(self._name(path))
            for path, signature in current.items():
                known = self._files.get(path)
                if known is None:
                    self._files[path] = self._read(path)
                    changes.added.append(self._name(path))
                elif known.signature != signature:
                    self._files[path] = self._read(path)
                    changes.updated.append(self._name(path))
            if changes:
                # Which file owns a duplicated id can change when any file does.
                self._resolve_duplicates()
            return changes
    # ------------------------------------------------------------------ access

    def report(self) -> LoadReport:
        with self._lock:
            loaded = [self._name(p) for p, r in sorted(self._files.items()) if r.loaded]
            skipped = [self._name(p) for p, r in sorted(self._files.items()) if not r.loaded]
            issues = [i for _, r in sorted(self._files.items()) for i in r.issues]
            return LoadReport(loaded, skipped, issues)

    @property
    def issues(self) -> list[Issue]:
        return self.report().issues

    @property
    def presets(self) -> dict[str, Preset]:
        with self._lock:
            out = dict(self._fallbacks)
            for doc in self._docs.values():
                if doc.kind == "preset":
                    out[doc.id] = Preset(doc)
            return out

    @property
    def recipes(self) -> dict[str, StyleDocument]:
        with self._lock:
            return {doc.id: doc for doc in self._docs.values() if doc.kind == "recipe"}

    def get_preset(self, preset_id: str) -> Preset:
        try:
            return self.presets[preset_id]
        except KeyError as error:
            raise KeyError(f"no preset {preset_id!r}; loaded: {sorted(self.presets)}") from error

    # --------------------------------------------------------------- hot reload

    def watch(self, interval: float = 1.0, on_change: Callable[[ChangeSet], None] | None = None) -> None:
        """Polls the directory and refreshes on change, in a background thread."""
        if self._watcher and self._watcher.is_alive():
            return
        self._stop.clear()

        def run() -> None:
            while not self._stop.wait(interval):
                changes = self.refresh()
                if changes and on_change:
                    on_change(changes)

        self._watcher = threading.Thread(target=run, name="curio-style-watch", daemon=True)
        self._watcher.start()

    def stop_watching(self) -> None:
        self._stop.set()
        if self._watcher:
            self._watcher.join(timeout=2.0)

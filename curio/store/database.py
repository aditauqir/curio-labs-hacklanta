"""Compiled styles in PostgreSQL (TigerData): publish a folder, load it back.

This is the offline ingestion side (see ``curio/docs/README.md``). A publish takes
a compiled folder that loads with no errors and writes it as one numbered,
immutable **release**, in a single transaction. Readers load the newest release
(or a named one), so a half-written or inconsistent set is never visible.

Documents are stored as their exact canonical JSON text with a SHA-256 of that
text, so a reader can tell when a row no longer matches what was published.

The connection string is read from ``CURIO_DATABASE_URL``, else ``DATABASE_URL``.
It is never printed or logged; error messages from here never include it.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from curio.style_schema import Issue, Preset
from curio.style_schema.loader import parse_style_text

from .directory import CompiledStyles, DirectorySource, add_layout, add_template

KINDS = ("preset", "layout", "template")
FOLDERS = {"preset": "presets", "layout": "layouts", "template": "templates"}
ID_FIELDS = {"preset": "preset_id", "layout": "layout_id", "template": "template_id"}
# Any constant works; it only has to be the same for every publisher.
PUBLISH_LOCK = 0x43555249

SCHEMA = """
CREATE TABLE IF NOT EXISTS curio_style_releases (
  id BIGSERIAL PRIMARY KEY,
  set_hash TEXT NOT NULL,
  counts JSONB NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curio_style_documents (
  release_id BIGINT NOT NULL REFERENCES curio_style_releases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('preset', 'layout', 'template')),
  doc_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (release_id, kind, doc_id)
);
"""


class DatabaseNotConfigured(RuntimeError):
    def __init__(self) -> None:
        super().__init__("set CURIO_DATABASE_URL (or DATABASE_URL) to the TigerData connection string")


class PublishRefused(ValueError):
    """The folder is not a clean, complete set; nothing was written."""

    def __init__(self, issues: list[Issue]) -> None:
        super().__init__(f"refusing to publish: {len(issues)} problem(s)")
        self.issues = issues


@dataclass(frozen=True)
class StyleDoc:
    kind: str
    doc_id: str
    body: str  # canonical JSON text, exactly as stored

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.body.encode("utf-8")).hexdigest()

    @property
    def name(self) -> str:
        return f"{FOLDERS[self.kind]}/{self.doc_id}.json"


@dataclass(frozen=True)
class Release:
    id: int
    set_hash: str
    counts: dict[str, int]
    note: str | None
    created_at: datetime


@dataclass(frozen=True)
class PublishResult:
    release: Release
    created: bool  # False when the newest release already had exactly this content


def canonical(obj: Any) -> str:
    # The same form ``curio.compiler.compile`` writes, without importing the op registry.
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def set_hash(docs: Iterable[StyleDoc]) -> str:
    """One hash for the whole set, independent of order."""
    lines = sorted(f"{d.kind}\t{d.doc_id}\t{d.sha256}" for d in docs)
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


# ------------------------------------------------------------ pure conversion


def collect_documents(folder: str | Path) -> list[StyleDoc]:
    """Every document in a compiled folder, or ``PublishRefused`` if the set is not clean.

    Clean means the folder loads with no errors (every template resolves, no
    duplicates) and contains at least one template. Warnings are allowed.
    """
    root = Path(folder)
    styles = DirectorySource(root).load()
    issues = list(styles.errors)
    docs: list[StyleDoc] = []
    for kind in KINDS:
        directory = root / FOLDERS[kind]
        if not directory.is_dir():
            continue
        # The preset loader also reads subfolders; publish exactly what it saw.
        for path in sorted(directory.rglob("*.json") if kind == "preset" else directory.glob("*.json")):
            relative = path.relative_to(directory)
            if any(part.startswith((".", "_")) for part in relative.parts):
                continue
            name = f"{FOLDERS[kind]}/{relative.as_posix()}"
            try:
                raw = json.loads(path.read_text(encoding="utf-8-sig"))
            except (OSError, ValueError) as error:
                issues.append(Issue(name, "", f"cannot read: {error}"))
                continue
            doc_id = raw.get(ID_FIELDS[kind]) if isinstance(raw, dict) else None
            if not isinstance(doc_id, str) or not doc_id:
                issues.append(Issue(name, ID_FIELDS[kind], "is required text"))
                continue
            docs.append(StyleDoc(kind, doc_id, canonical(raw)))
    if not styles.templates and not issues:
        issues.append(Issue(str(root), "templates", "no templates to publish"))
    if issues:
        raise PublishRefused(issues)
    return sorted(docs, key=lambda d: (KINDS.index(d.kind), d.doc_id))


def styles_from_documents(docs: Iterable[StyleDoc], expected: dict[tuple[str, str], str] | None = None) -> CompiledStyles:
    """Builds ``CompiledStyles`` from stored documents, with the same checks as a folder.

    ``expected`` maps ``(kind, doc_id)`` to the SHA-256 recorded at publish time; a
    document whose text no longer matches is skipped and reported.
    """
    styles = CompiledStyles()
    by_kind: dict[str, list[StyleDoc]] = {kind: [] for kind in KINDS}
    for doc in docs:
        recorded = (expected or {}).get((doc.kind, doc.doc_id))
        if recorded is not None and recorded != doc.sha256:
            styles.issues.append(Issue(doc.name, "", "stored text does not match its recorded hash; skipped"))
            continue
        by_kind[doc.kind].append(doc)

    for doc in sorted(by_kind["preset"], key=lambda d: d.doc_id):
        parsed, issues = parse_style_text(doc.body, doc.name)
        styles.issues.extend(issues)
        if parsed is None:
            continue
        if parsed.kind != "preset":
            styles.issues.append(Issue(doc.name, "", "stored as a preset but is not one"))
        elif parsed.id in styles.presets:
            styles.issues.append(Issue(doc.name, "preset_id", f"duplicate preset id {parsed.id!r}"))
        else:
            styles.presets[parsed.id] = Preset(parsed)
    for doc in sorted(by_kind["layout"], key=lambda d: d.doc_id):
        add_layout(styles, doc.name, doc.body)
    for doc in sorted(by_kind["template"], key=lambda d: d.doc_id):
        add_template(styles, doc.name, doc.body)
    return styles


def write_documents(docs: Iterable[StyleDoc], out_dir: str | Path) -> list[Path]:
    """Writes documents back out as a compiled folder (the inverse of ``collect_documents``)."""
    out, written = Path(out_dir), []
    for doc in docs:
        path = out / doc.name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(doc.body, encoding="utf-8")
        written.append(path)
    return written


# ------------------------------------------------------------------- database


def database_url() -> str:
    url = (os.environ.get("CURIO_DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        raise DatabaseNotConfigured()
    return url


def connect(url: str | None = None):
    """Opens a connection. TLS is required unless the URL sets its own ``sslmode``."""
    import psycopg  # optional dependency: pip install -e ".[db]"

    url = url or database_url()
    options: dict[str, Any] = {"connect_timeout": 10}
    if "sslmode" not in url:
        options["sslmode"] = "require"
    return psycopg.connect(url, **options)


def ensure_schema(conn) -> None:
    conn.execute(SCHEMA)


def _release(row) -> Release:
    rid, digest, counts, note, created_at = row
    return Release(int(rid), digest, dict(counts), note, created_at)


def latest_release(conn) -> Release | None:
    row = conn.execute(
        "SELECT id, set_hash, counts, note, created_at FROM curio_style_releases ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return _release(row) if row else None


def list_releases(conn, limit: int = 20) -> list[Release]:
    rows = conn.execute(
        "SELECT id, set_hash, counts, note, created_at FROM curio_style_releases ORDER BY id DESC LIMIT %s", (limit,)
    ).fetchall()
    return [_release(r) for r in rows]


def get_release(conn, release_id: int | None = None) -> Release | None:
    if release_id is None:
        return latest_release(conn)
    row = conn.execute(
        "SELECT id, set_hash, counts, note, created_at FROM curio_style_releases WHERE id = %s", (release_id,)
    ).fetchone()
    return _release(row) if row else None


def publish(conn, docs: list[StyleDoc], note: str | None = None) -> PublishResult:
    """Writes ``docs`` as a new release in one transaction.

    If the newest release already has exactly this content, nothing is written and
    that release is returned with ``created=False``.
    """
    digest = set_hash(docs)
    counts = {kind: sum(1 for d in docs if d.kind == kind) for kind in KINDS}
    with conn.transaction():
        ensure_schema(conn)
        # Serialise publishers so two runs cannot both decide "unchanged" or interleave.
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (PUBLISH_LOCK,))
        current = latest_release(conn)
        if current is not None and current.set_hash == digest:
            return PublishResult(current, created=False)
        row = conn.execute(
            "INSERT INTO curio_style_releases (set_hash, counts, note) VALUES (%s, %s, %s) "
            "RETURNING id, set_hash, counts, note, created_at",
            (digest, json.dumps(counts), note),
        ).fetchone()
        release = _release(row)
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO curio_style_documents (release_id, kind, doc_id, sha256, body) VALUES (%s, %s, %s, %s, %s)",
                [(release.id, d.kind, d.doc_id, d.sha256, d.body) for d in docs],
            )
    return PublishResult(release, created=True)


def fetch_documents(conn, release_id: int) -> tuple[list[StyleDoc], dict[tuple[str, str], str]]:
    rows = conn.execute(
        "SELECT kind, doc_id, sha256, body FROM curio_style_documents WHERE release_id = %s ORDER BY kind, doc_id",
        (release_id,),
    ).fetchall()
    docs = [StyleDoc(kind, doc_id, body) for kind, doc_id, _, body in rows]
    return docs, {(kind, doc_id): sha for kind, doc_id, sha, _ in rows}


class DatabaseSource:
    """Loads one release (default: the newest) as ``CompiledStyles``. Read-only."""

    def __init__(self, release: int | None = None, connector: Callable[[], Any] | None = None) -> None:
        self.requested = release
        self._connect = connector or connect
        self.release: Release | None = None  # set by load()

    def documents(self) -> list[StyleDoc]:
        docs, _ = self._fetch()
        return docs

    def _fetch(self) -> tuple[list[StyleDoc], dict[tuple[str, str], str]]:
        with self._connect() as conn:
            if not tables_exist(conn):
                self.release = None
                return [], {}
            self.release = get_release(conn, self.requested)
            if self.release is None:
                return [], {}
            return fetch_documents(conn, self.release.id)

    def load(self) -> CompiledStyles:
        docs, expected = self._fetch()
        styles = styles_from_documents(docs, expected)
        if self.release is None:
            what = f"release {self.requested}" if self.requested is not None else "any release"
            styles.issues.append(Issue("database", "release", f"no {what} has been published", "warning"))
        return styles


def tables_exist(conn) -> bool:
    row = conn.execute("SELECT to_regclass('curio_style_releases') IS NOT NULL").fetchone()
    return bool(row and row[0])

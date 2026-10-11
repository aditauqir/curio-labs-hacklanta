"""Publishes the engine's asset library (curio/assets) into the website's shared library.

The website owns ``curio_library_assets`` (``db/schema.sql``); this only upserts rows
into it and never creates or alters the table. Each asset becomes one shared row
(``owner_instance_id`` NULL) with the file in ``data``, and vector assets get a
second row for their SVG. Every row is tagged ``engine-texture`` so the website keeps
them out of the Gemini context (``lib/library.ts`` ``ENGINE_TEXTURE_TAG``).

Row ids are ``engine:<asset id>`` (``engine:<asset id>.svg`` for SVGs), so a publish
is idempotent: re-running updates rows in place, and rows are removed only with
``prune=True`` (ids under ``engine:`` that the manifest no longer lists).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from curio.core.assets import Asset, AssetLibrary

ENGINE_TEXTURE_TAG = "engine-texture"
ID_PREFIX = "engine:"
#: The website's upload API caps shared assets at 25 MB; stay under it here too.
MAX_BYTES = 25 * 1024 * 1024


@dataclass(frozen=True)
class LibraryRow:
    id: str
    name: str
    description: str
    tags: list[str]
    metadata: dict[str, Any]
    content_type: str
    data: bytes

    @property
    def size_bytes(self) -> int:
        return len(self.data)


def _name(asset: Asset) -> str:
    return asset.id.replace("_", " ")


def rows_for(library: AssetLibrary) -> list[LibraryRow]:
    """The rows to publish, one per file, in a fixed order."""
    rows: list[LibraryRow] = []
    for asset_id in sorted(library.assets):
        asset = library.assets[asset_id]
        files = [(asset.file, "image/png", "")] + ([(asset.svg, "image/svg+xml", ".svg")] if asset.svg else [])
        for relative, content_type, suffix in files:
            data = (library.directory / relative).read_bytes()
            if len(data) > MAX_BYTES:
                raise ValueError(f"{relative} is {len(data)} bytes; the library limit is {MAX_BYTES}")
            rows.append(LibraryRow(
                id=f"{ID_PREFIX}{asset.id}{suffix}",
                name=_name(asset) + (" (SVG)" if suffix else ""),
                description=asset.notes[:500],
                tags=sorted({ENGINE_TEXTURE_TAG, asset.kind, f"blend:{asset.blend_hint}", "cc0", "tileable" if asset.tileable else "fitted"} | ({"svg"} if suffix else set())),
                metadata={
                    "source": "curio-engine",
                    "engineAsset": asset.reference,
                    "kind": asset.kind,
                    "blendHint": asset.blend_hint,
                    "tileable": asset.tileable,
                    "width": asset.width,
                    "height": asset.height,
                    "params": asset.params,
                    "achieved": asset.achieved,
                    "license": asset.license,
                    "sha256": hashlib.sha256(data).hexdigest(),
                },
                content_type=content_type,
                data=data,
            ))
    return rows


@dataclass(frozen=True)
class PublishSummary:
    inserted: int
    updated: int
    unchanged: int
    removed: int
    total_bytes: int


def publish_library(conn, rows: list[LibraryRow], prune: bool = False) -> PublishSummary:
    """Upserts ``rows`` into ``curio_library_assets`` in one transaction."""
    exists = conn.execute("SELECT to_regclass('curio_library_assets') IS NOT NULL").fetchone()
    if not (exists and exists[0]):
        raise RuntimeError("curio_library_assets does not exist; the website creates it on first start (db/schema.sql)")
    inserted = updated = unchanged = removed = 0
    with conn.transaction():
        current = {
            row_id: sha
            for row_id, sha in conn.execute(
                "SELECT id, metadata->>'sha256' FROM curio_library_assets WHERE id LIKE %s AND owner_instance_id IS NULL",
                (ID_PREFIX + "%",),
            ).fetchall()
        }
        for row in rows:
            if current.get(row.id) == row.metadata["sha256"]:
                unchanged += 1
                # Metadata can change without the file changing; keep it current.
                conn.execute(
                    "UPDATE curio_library_assets SET name = %s, description = %s, tags = %s, metadata = %s, updated_at = NOW() WHERE id = %s",
                    (row.name, row.description, row.tags, json.dumps(row.metadata), row.id),
                )
                continue
            conn.execute(
                """
                INSERT INTO curio_library_assets (id, kind, name, description, tags, metadata, content_type, size_bytes, data, updated_at)
                VALUES (%s, 'image', %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (id) DO UPDATE SET
                  kind = EXCLUDED.kind, name = EXCLUDED.name, description = EXCLUDED.description, tags = EXCLUDED.tags,
                  metadata = EXCLUDED.metadata, content_type = EXCLUDED.content_type, size_bytes = EXCLUDED.size_bytes,
                  data = EXCLUDED.data, updated_at = NOW()
                """,
                (row.id, row.name, row.description, row.tags, json.dumps(row.metadata), row.content_type, row.size_bytes, row.data),
            )
            if row.id in current:
                updated += 1
            else:
                inserted += 1
        if prune:
            stale = sorted(set(current) - {r.id for r in rows})
            for row_id in stale:
                conn.execute("DELETE FROM curio_library_assets WHERE id = %s AND owner_instance_id IS NULL", (row_id,))
            removed = len(stale)
    return PublishSummary(inserted, updated, unchanged, removed, sum(r.size_bytes for r in rows))

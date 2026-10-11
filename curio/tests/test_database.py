from __future__ import annotations

import json
import os
import uuid
from dataclasses import replace
from pathlib import Path

import pytest

from curio.compiler import load_export
from curio.compiler.compile import compile_bundle, write_compiled
from curio.store import DatabaseSource, DirectorySource, PublishRefused
from curio.store.database import collect_documents, set_hash, styles_from_documents, write_documents
from curio.tests import exportfix as fx


@pytest.fixture(scope="module")
def styles_dir(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("styles")
    write_compiled(compile_bundle(load_export(fx.write_export(root / "export"))), root / "compiled")
    return root / "compiled"


def _copy(src: Path, dst: Path) -> Path:
    for path in src.rglob("*.json"):
        target = dst / path.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
    return dst


def _same(a, b) -> None:
    assert sorted(a.templates) == sorted(b.templates)
    assert sorted(a.layouts) == sorted(b.layouts)
    assert sorted(a.presets) == sorted(b.presets)
    for preset_id in a.presets:
        assert a.presets[preset_id].data == b.presets[preset_id].data
    for template_id in a.templates:
        assert a.templates[template_id] == b.templates[template_id]
        assert a.resolve(template_id).layout == b.resolve(template_id).layout


# ------------------------------------------------------------ pure conversion


def test_collect_takes_every_file_of_a_clean_folder(styles_dir):
    docs = collect_documents(styles_dir)
    assert len(docs) == len(list(styles_dir.rglob("*.json")))
    assert {d.kind for d in docs} == {"preset", "layout", "template"}


def test_documents_rebuild_the_same_styles_as_the_folder(styles_dir):
    _same(styles_from_documents(collect_documents(styles_dir)), DirectorySource(styles_dir).load())


def test_written_documents_load_back_as_the_same_folder(styles_dir, tmp_path):
    write_documents(collect_documents(styles_dir), tmp_path / "out")
    _same(DirectorySource(tmp_path / "out").load(), DirectorySource(styles_dir).load())


def test_a_folder_with_a_broken_template_is_refused_whole(styles_dir, tmp_path):
    root = _copy(styles_dir, tmp_path / "c")
    victim = sorted((root / "templates").glob("*.json"))[0]
    doc = json.loads(victim.read_text(encoding="utf-8"))
    doc["layout_id"] = "missing"
    victim.write_text(json.dumps(doc), encoding="utf-8")
    with pytest.raises(PublishRefused) as refused:
        collect_documents(root)
    assert "layout_id" in [i.path for i in refused.value.issues]


def test_an_empty_folder_is_refused(tmp_path):
    with pytest.raises(PublishRefused, match="problem"):
        collect_documents(tmp_path)


def test_the_set_hash_ignores_order_but_not_content(styles_dir):
    docs = collect_documents(styles_dir)
    assert set_hash(docs) == set_hash(list(reversed(docs)))
    changed = [replace(docs[0], body=docs[0].body.replace("}", ' , "x": 1}', 1))] + docs[1:]
    assert set_hash(changed) != set_hash(docs)


def test_a_document_that_no_longer_matches_its_hash_is_skipped(styles_dir):
    docs = collect_documents(styles_dir)
    expected = {(d.kind, d.doc_id): d.sha256 for d in docs}
    layout = next(d for d in docs if d.kind == "layout")
    tampered = [replace(d, body=d.body + " ") if d == layout else d for d in docs]
    styles = styles_from_documents(tampered, expected)
    assert layout.doc_id not in styles.layouts
    assert any("recorded hash" in i.message for i in styles.errors)
    # Templates on that layout fail to resolve and are reported, the rest still load.
    assert all(t["layout_id"] != layout.doc_id for t in styles.templates.values())
    assert styles.templates


# ------------------------------------------------- against a real PostgreSQL

DB_URL = os.environ.get("CURIO_TEST_DATABASE_URL")


@pytest.fixture
def scratch_schema():
    """A throwaway schema on the test database, dropped afterwards."""
    if not DB_URL:
        pytest.skip("set CURIO_TEST_DATABASE_URL to run the database round trip")
    pytest.importorskip("psycopg")
    from curio.store.database import connect

    schema = f"curio_test_{uuid.uuid4().hex[:12]}"

    def connector():
        conn = connect(DB_URL)
        conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        conn.execute(f'SET search_path TO "{schema}"')
        conn.commit()
        return conn

    yield connector
    with connect(DB_URL) as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


def _small_library(tmp_path: Path, ids: list[str]):
    from curio.core.assets import AssetLibrary, default_assets_dir

    root = tmp_path / "assets"
    manifest = json.loads((default_assets_dir() / "assets_manifest.json").read_text(encoding="utf-8"))
    manifest["assets"] = [a for a in manifest["assets"] if a["id"] in ids]
    for asset in manifest["assets"]:
        for rel in [asset["file"], asset.get("achieved", {}).get("svg")]:
            if rel:
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_bytes((default_assets_dir() / rel).read_bytes())
    (root / "assets_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return AssetLibrary(root)


def test_library_rows_are_tagged_hashed_and_include_svgs(tmp_path):
    import hashlib

    from curio.store.library_assets import ENGINE_TEXTURE_TAG, rows_for

    rows = rows_for(_small_library(tmp_path, ["ht_bayer4", "vec_sacred_flower_of_life"]))
    assert [r.id for r in rows] == ["engine:ht_bayer4", "engine:vec_sacred_flower_of_life", "engine:vec_sacred_flower_of_life.svg"]
    assert all(ENGINE_TEXTURE_TAG in r.tags and r.metadata["license"] == "CC0-1.0" for r in rows)
    assert rows[-1].content_type == "image/svg+xml" and "svg" in rows[-1].tags
    assert all(r.metadata["sha256"] == hashlib.sha256(r.data).hexdigest() for r in rows)


def test_the_library_publishes_into_the_website_table_idempotently(scratch_schema, tmp_path):
    from curio.store.library_assets import publish_library, rows_for

    with scratch_schema() as conn:
        conn.execute(Path("db/schema.sql").read_text(encoding="utf-8"))
    rows = rows_for(_small_library(tmp_path, ["ht_bayer4", "grain_film_mono_std8", "vec_concentric_target"]))
    with scratch_schema() as conn:
        first = publish_library(conn, rows)
    assert (first.inserted, first.updated, first.unchanged) == (len(rows), 0, 0)
    with scratch_schema() as conn:
        again = publish_library(conn, rows)
        stored = conn.execute("SELECT id, kind, owner_instance_id, size_bytes, data, tags FROM curio_library_assets ORDER BY id").fetchall()
    assert (again.inserted, again.unchanged) == (0, len(rows))
    assert [s[0] for s in stored] == [r.id for r in rows]
    for (row_id, kind, owner, size, data, tags), row in zip(stored, rows):
        assert kind == "image" and owner is None and size == len(row.data) and bytes(data) == row.data and "engine-texture" in tags
    with scratch_schema() as conn:
        pruned = publish_library(conn, rows[:1], prune=True)
        left = [r[0] for r in conn.execute("SELECT id FROM curio_library_assets").fetchall()]
    assert pruned.removed == len(rows) - 1 and left == [rows[0].id]


def test_publish_then_load_round_trips_through_postgres(styles_dir, scratch_schema, tmp_path):
    from curio.store.database import list_releases, publish

    # Nothing published yet: an empty set and a warning, not a crash.
    empty = DatabaseSource(connector=scratch_schema).load()
    assert not empty.templates and not empty.errors and empty.issues

    docs = collect_documents(styles_dir)
    with scratch_schema() as conn:
        first = publish(conn, docs, "first")
    assert first.created and first.release.counts["template"] == sum(d.kind == "template" for d in docs)

    with scratch_schema() as conn:
        again = publish(conn, docs, "same content")
    assert not again.created and again.release.id == first.release.id

    source = DatabaseSource(connector=scratch_schema)
    loaded = source.load()
    assert source.release.id == first.release.id and not loaded.errors
    _same(loaded, DirectorySource(styles_dir).load())

    # A changed set becomes a new release; the old one stays loadable by id.
    fewer = [d for d in docs if not (d.kind == "template" and d.doc_id == docs[-1].doc_id)]
    with scratch_schema() as conn:
        second = publish(conn, fewer, None)
        assert [r.id for r in list_releases(conn)] == [second.release.id, first.release.id]
    assert len(DatabaseSource(connector=scratch_schema).load().templates) == len(loaded.templates) - 1
    _same(DatabaseSource(first.release.id, connector=scratch_schema).load(), loaded)

    # A pulled release is a folder the renderer can use as is.
    write_documents(DatabaseSource(first.release.id, connector=scratch_schema).documents(), tmp_path / "pulled")
    _same(DirectorySource(tmp_path / "pulled").load(), loaded)

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from curio.compiler import load_export
from curio.compiler.compile import compile_bundle, write_compiled
from curio.core.image import load_image
from curio.render import PACK_VERSION, Photo, RenderRequest, build_manifest, compose_pack, render_poster, write_pack
from curio.store import DirectorySource
from curio.tests import exportfix as fx
from curio.tests.fixtures import standin_photo
from curio.tests.fontfix import make_family_set
from curio.typography import FontLibrary

CONTENT = {"headline": "Night Shift", "kicker": "Friday only", "tracklist": [f"{i:02d} Track number {i}" for i in range(1, 9)]}


@pytest.fixture(scope="module")
def styles(tmp_path_factory):
    root = tmp_path_factory.mktemp("styles")
    write_compiled(compile_bundle(load_export(fx.write_export(root / "export"))), root / "compiled")
    loaded = DirectorySource(root / "compiled").load()
    assert not loaded.errors
    return loaded


@pytest.fixture(scope="module")
def fonts(tmp_path_factory) -> FontLibrary:
    return FontLibrary.from_directories([make_family_set(tmp_path_factory.mktemp("fonts"))])


def _render(styles, fonts, template_id: str, seed: int = 3):
    photo = Photo(standin_photo(300), source="test fixture", license="CC0-1.0")
    return render_poster(RenderRequest(template_id, CONTENT, photo, short_edge=270, seed=seed), styles, fonts)


@pytest.fixture(scope="module")
def packs(styles, fonts, tmp_path_factory):
    """One pack per compiled template: (template_id, pack dir, result)."""
    root = tmp_path_factory.mktemp("packs")
    out = []
    for template_id in sorted(styles.templates):
        result = _render(styles, fonts, template_id)
        write_pack(result, root / template_id)
        out.append((template_id, root / template_id, result))
    return out


def _manifest(pack: Path) -> dict:
    return json.loads((pack / "manifest.json").read_text(encoding="utf-8"))


def test_composing_the_elements_reproduces_the_engine_render(packs):
    for template_id, pack, result in packs:
        rebuilt = compose_pack(pack)
        preview = load_image(pack / "preview.png")
        diff = np.abs(rebuilt - preview)
        # Only 8-bit rounding of the layer PNGs separates the two.
        assert float(diff.mean()) < 2e-3 and float(diff.max()) < 0.04, template_id


def test_every_layer_becomes_an_element_or_the_background(packs):
    for _, pack, result in packs:
        manifest = _manifest(pack)
        ids = [e["id"] for e in manifest["elements"]]
        assert len(ids) == len(set(ids))
        textures = [n for n in result.stack.names if result.elements[n]["kind"] == "global_texture"]
        assert len(ids) + len(textures) == len(result.stack)
        assert (manifest["background"]["file"] is not None) == bool(textures)


def test_every_referenced_file_exists_and_paths_are_relative(packs):
    for _, pack, _ in packs:
        manifest = _manifest(pack)
        files = [manifest["background"]["file"], manifest["preview"], manifest["record"]]
        files += [e.get("file") or (e.get("raster") or {}).get("file") for e in manifest["elements"]]
        for name in filter(None, files):
            assert not Path(name).is_absolute() and ".." not in Path(name).parts and "\\" not in name
            assert (pack / name).is_file(), name


def test_text_elements_are_editable_not_just_pixels(packs):
    _, pack, _ = packs[0]
    manifest = _manifest(pack)
    texts = {e["slot"]: e for e in manifest["elements"] if e["kind"] == "text"}
    assert texts, "the fixture templates set type"
    headline = texts.get("headline") or next(iter(texts.values()))
    for key in ("text", "case", "font", "size_px", "tracking_em", "leading", "align", "color", "x", "y", "w", "h", "rotation_deg"):
        assert key in headline, key
    assert headline["font"]["family"] and "/" not in headline["font"]["file"]
    if "tracklist" in texts:
        assert texts["tracklist"]["text"] == CONTENT["tracklist"]
    assert manifest["fonts"] and all(f["family"] for f in manifest["fonts"])


def test_the_photo_element_carries_its_treatment_and_licence(packs):
    _, pack, _ = packs[0]
    photos = [e for e in _manifest(pack)["elements"] if e["role"] == "photo"]
    assert photos
    assert photos[0]["license"] == "CC0-1.0" and isinstance(photos[0]["treatment"], list)


def test_plates_point_at_the_text_they_serve(packs):
    for _, pack, _ in packs:
        elements = {e["id"]: e for e in _manifest(pack)["elements"]}
        for element in elements.values():
            if element["role"] == "plate":
                assert elements[element["linked_to"]]["kind"] == "text"


def test_the_manifest_is_versioned_and_deterministic(styles, fonts, packs):
    template_id, pack, _ = packs[0]
    manifest = _manifest(pack)
    assert manifest["format"] == "curio.asset_pack" and manifest["version"] == PACK_VERSION
    again, _ = build_manifest(_render(styles, fonts, template_id))
    assert json.loads(json.dumps(again)) == manifest


def test_a_result_without_a_stack_is_rejected(packs):
    from curio.render import RenderResult

    _, _, result = packs[0]
    with pytest.raises(ValueError, match="no layer stack"):
        build_manifest(RenderResult(result.image, result.record))

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from curio.compiler import load_export
from curio.compiler.compile import compile_bundle, write_compiled
from curio.core.assets import KINDS, AssetLibrary, default_assets_dir, default_library
from curio.core.textures import resolve_texture
from curio.ops import apply_op
from curio.render import Photo, RenderRequest, render_poster
from curio.store import DirectorySource
from curio.tests import exportfix as fx
from curio.tests.fixtures import standin_photo
from curio.tests.fontfix import make_family_set
from curio.typography import FontLibrary

LIBRARY = default_library()


# ----------------------------------------------------------------- the library


def test_every_shipped_asset_loads_with_no_issues():
    manifest = json.loads((default_assets_dir() / "assets_manifest.json").read_text(encoding="utf-8"))
    assert not LIBRARY.issues, [str(i) for i in LIBRARY.issues]
    assert len(LIBRARY.assets) == len(manifest["assets"])
    assert {a.kind for a in LIBRARY.assets.values()} == set(KINDS)
    assert all(a.license == "CC0-1.0" for a in LIBRARY.assets.values())


def test_vector_assets_point_at_their_svg():
    for asset in LIBRARY.of_kind("vector"):
        assert asset.svg and (default_assets_dir() / asset.svg).is_file()


def test_shipped_files_carry_no_source_names():
    # The analysis kept recipes under an artist's name; nothing published may.
    for path in default_assets_dir().rglob("*"):
        if path.suffix in (".json", ".md", ".py"):
            assert "charli" not in path.read_text(encoding="utf-8").lower(), path


def test_a_tileable_asset_repeats_at_native_scale():
    source = LIBRARY.pixels("ht_am_round_p7p8_a51")
    th, tw = source.shape
    tiled = LIBRARY.texture("ht_am_round_p7p8_a51", (tw + 300, th + 200))
    assert np.array_equal(tiled[:th, :tw], source)
    assert np.array_equal(tiled[th:, tw:], source[:200, :300])
    shifted = LIBRARY.texture("asset:ht_am_round_p7p8_a51", (64, 32), offset=(10, 5))
    assert np.array_equal(shifted, source[5:37, 10:74])


def test_tiles_resample_with_the_output_scale():
    half = LIBRARY.texture("grain_film_mono_std8", (512, 256), scale=0.5)
    double = LIBRARY.texture("grain_film_mono_std8", (512, 256), scale=2.0)
    assert half.shape == double.shape == (256, 512)
    # Doubling the scale makes neighbouring pixels much more alike.
    assert np.abs(np.diff(double, axis=1)).mean() < 0.5 * np.abs(np.diff(half, axis=1)).mean()


def test_a_non_tileable_asset_covers_the_canvas():
    out = LIBRARY.texture("overlay_photocopy_creases_1", (300, 500))
    assert out.shape == (500, 300)
    rgba = LIBRARY.texture("vec_concentric_target", (200, 100), keep_alpha=True)
    assert rgba.shape == (100, 200, 4)


def test_resolve_texture_accepts_asset_references():
    out = resolve_texture("asset:paper_newsprint_r5", (120, 80))
    assert out.shape == (80, 120, 3) and out.dtype == np.float32
    with pytest.raises(KeyError, match="no asset"):
        resolve_texture("asset:nope", (10, 10))


def _copy_library(tmp_path: Path, edit) -> AssetLibrary:
    root = tmp_path / "assets"
    manifest = json.loads((default_assets_dir() / "assets_manifest.json").read_text(encoding="utf-8"))
    keep = manifest["assets"][:3]
    for asset in keep:
        (root / asset["file"]).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(default_assets_dir() / asset["file"], root / asset["file"])
    manifest["assets"] = keep
    edit(manifest)
    (root / "assets_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return AssetLibrary(root)


@pytest.mark.parametrize(
    "edit, message",
    [
        (lambda m: m["assets"][0].update(file="../../outside.png"), "inside the library"),
        (lambda m: m["assets"][0].update(file="halftone/missing.png"), "missing"),
        (lambda m: m["assets"][0].update(size=[10, 10]), "but the file is"),
        (lambda m: m["assets"][0].update(kind="photo"), "kind"),
        (lambda m: m["assets"][0].update(license=""), "license"),
        (lambda m: m["assets"][1].update(id=m["assets"][0]["id"]), "duplicate"),
    ],
)
def test_a_bad_manifest_entry_is_reported_and_the_rest_load(tmp_path, edit, message):
    library = _copy_library(tmp_path, edit)
    assert any(message in i.message for i in library.issues), [str(i) for i in library.issues]
    assert len(library.assets) == 2


def test_a_missing_library_is_an_issue_not_a_crash(tmp_path):
    library = AssetLibrary(tmp_path / "none")
    assert not library.assets and library.issues


# ------------------------------------------------------------- halftone_map op


def _grey(value: float, size: int = 256) -> np.ndarray:
    return np.full((size, size, 3), value, dtype=np.float32)


def test_halftone_map_inks_coverage_in_proportion_to_tone():
    for asset in ("ht_am_round_p7p8_a51", "ht_line_p13p8_h", "ht_stochastic_blue", "ht_bayer8"):
        out = apply_op("halftone_map", _grey(0.5), {"map": f"asset:{asset}"})
        assert abs(float(out.mean()) - 0.5) < 0.06, asset
    assert float(apply_op("halftone_map", _grey(0.0), {}).max()) == 0.0
    assert float(apply_op("halftone_map", _grey(1.0), {}).min()) == 1.0


def test_halftone_map_uses_the_inks():
    out = apply_op("halftone_map", standin_photo(64), {"ink": "#020602", "paper": "#90E908"})
    colours = {tuple(np.round(px, 3)) for px in out.reshape(-1, 3)[:: 97]}
    assert all(c[1] >= c[0] for c in colours)  # every pixel lies between the two inks


def test_halftone_map_scale_coarsens_the_screen():
    fine = apply_op("halftone_map", _grey(0.5), {"scale": 1.0})
    coarse = apply_op("halftone_map", _grey(0.5), {"scale": 3.0})
    edges = lambda a: float(np.abs(np.diff(a[..., 0], axis=1)).mean())  # noqa: E731
    assert edges(coarse) < 0.6 * edges(fine)


def test_halftone_map_refuses_a_texture_asset():
    with pytest.raises(ValueError, match="not a halftone_threshold"):
        apply_op("halftone_map", _grey(0.5, 32), {"map": "asset:paper_aged_r5"})


# ------------------------------------------------------------------ in a style


@pytest.fixture(scope="module")
def fonts(tmp_path_factory) -> FontLibrary:
    return FontLibrary.from_directories([make_family_set(tmp_path_factory.mktemp("fonts"))])


def _styles(tmp_path: Path, asset: str):
    mutate = {"clusters/synth_newsprint.json": lambda c: c["texture_rules"][0].update(asset=asset)}
    bundle = load_export(fx.write_export(tmp_path / "export", mutate))
    return bundle, compile_bundle(bundle)


def test_a_style_can_name_a_library_texture_and_it_is_used_and_credited(tmp_path, fonts):
    bundle, compiled = _styles(tmp_path, "paper_newsprint_r5")
    assert bundle.ok, [str(i) for i in bundle.errors]
    write_compiled(compiled, tmp_path / "compiled")
    styles = DirectorySource(tmp_path / "compiled").load()
    template_id = next(t for t in sorted(styles.templates) if t.startswith("synth_newsprint"))
    photo = Photo(standin_photo(200), source="test fixture", license="CC0-1.0")
    result = render_poster(RenderRequest(template_id, {"headline": "Night Shift"}, photo, short_edge=216, seed=2), styles, fonts)
    applied = [t for t in result.record["textures"] if t["applied"]]
    assert applied and applied[0]["source"] == "asset:paper_newsprint_r5"
    assert {"kind": "texture", "source": "asset:paper_newsprint_r5", "license": "CC0-1.0"} in result.record["assets_used"]


@pytest.mark.parametrize("asset, message", [("nope", "no asset"), ("ht_bayer4", "halftone map")])
def test_an_export_naming_a_bad_texture_asset_is_rejected(tmp_path, asset, message):
    bundle, _ = _styles(tmp_path, asset)
    assert any(message in i.message and i.path.endswith("asset") for i in bundle.errors), [str(i) for i in bundle.issues]

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from curio.compiler import load_export
from curio.compiler.compile import compile_bundle, write_compiled
from curio.core.color import contrast_ratio, parse_hex
from curio.layout import PlacementError, canvas_size, parse_layout, place
from curio.render import Photo, RenderRequest, fit_microtype, render_poster
from curio.store import DirectorySource
from curio.tests import exportfix as fx
from curio.tests.fixtures import standin_photo
from curio.tests.fontfix import make_family_set
from curio.typography import FontLibrary, render_text

CONTENT = {"headline": "Night Shift", "kicker": "Friday only", "tracklist": [f"{i:02d} Track number {i}" for i in range(1, 13)]}


@pytest.fixture(scope="module")
def styles_dir(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("styles")
    bundle = load_export(fx.write_export(root / "export"))
    write_compiled(compile_bundle(bundle), root / "compiled")
    return root / "compiled"


@pytest.fixture(scope="module")
def styles(styles_dir):
    loaded = DirectorySource(styles_dir).load()
    assert not loaded.errors, [str(i) for i in loaded.errors]
    return loaded


@pytest.fixture(scope="module")
def fonts(tmp_path_factory) -> FontLibrary:
    return FontLibrary.from_directories([make_family_set(tmp_path_factory.mktemp("fonts"))])


def photo(size: int = 400) -> Photo:
    return Photo(standin_photo(size), source="test fixture", license="CC0-1.0")


# ---------------------------------------------------------------------- store


def test_every_compiled_template_resolves(styles):
    assert styles.templates
    for ref in styles.refs():
        assert ref.preset.id == ref.template["preset_id"] and ref.layout.layout_id == ref.template["layout_id"]


def test_an_unknown_template_names_the_available_ones(styles):
    with pytest.raises(KeyError, match="available"):
        styles.resolve("nope")


def _copy(src: Path, dst: Path) -> Path:
    for path in src.rglob("*.json"):
        target = dst / path.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
    return dst


@pytest.mark.parametrize(
    "edit, field",
    [
        (lambda t: t.update(preset_id="missing"), "preset_id"),
        (lambda t: t.update(layout_id="missing"), "layout_id"),
        (lambda t: t.update(overrides={"halftone_screen.pitch_px": 500}), "overrides.halftone_screen.pitch_px"),
        (lambda t: t.pop("template_id"), "template_id"),
    ],
)
def test_a_broken_template_is_skipped_and_reported_while_the_rest_load(styles_dir, tmp_path, edit, field):
    root = _copy(styles_dir, tmp_path / "c")
    victim = sorted((root / "templates").glob("synth_newsprint__*.json"))[0]
    doc = json.loads(victim.read_text(encoding="utf-8"))
    edit(doc)
    victim.write_text(json.dumps(doc), encoding="utf-8")
    loaded = DirectorySource(root).load()
    assert field in [i.path for i in loaded.errors]
    assert victim.stem not in loaded.templates
    assert len(loaded.templates) == len(list((root / "templates").glob("*.json"))) - 1


def test_a_duplicate_template_id_is_reported(styles_dir, tmp_path):
    root = _copy(styles_dir, tmp_path / "c")
    first = sorted((root / "templates").glob("*.json"))[0]
    (root / "templates" / "zz_copy.json").write_bytes(first.read_bytes())
    loaded = DirectorySource(root).load()
    assert any("duplicate template id" in i.message for i in loaded.errors)


def test_a_missing_folder_loads_empty_without_crashing(tmp_path):
    loaded = DirectorySource(tmp_path / "nothing").load()
    assert not loaded.templates and not loaded.layouts


# ------------------------------------------------------------- layout engine


LAYOUT = parse_layout({
    "layout_id": "l", "cluster_id": "c", "alignment": "left",
    "regions": [
        {"id": "pic", "role": "photo", "content": "photo", "x": {"lo": 0, "hi": 0.2, "default": 0.1}, "y": {"lo": 0, "hi": 0.2, "default": 0.1},
         "w": {"lo": 0.5, "hi": 0.8, "default": 0.8}, "h": {"lo": 0.3, "hi": 0.6, "default": 0.5}, "aspect_ratio": {"lo": 1.5, "hi": 2.0, "default": 1.75}, "z": 1},
        {"id": "head", "role": "type", "content": "headline", "x": {"lo": 0, "hi": 0.2, "default": 0.1}, "y": {"lo": 0.6, "hi": 0.8, "default": 0.7},
         "w": {"lo": 0.5, "hi": 0.9, "default": 0.8}, "h": {"lo": 0.1, "hi": 0.2, "default": 0.15}, "z": 2},
        {"id": "kick", "role": "type", "content": "kicker", "x": {"lo": 0, "hi": 0.2, "default": 0.1}, "y": {"lo": 0, "hi": 0.1, "default": 0.02},
         "w": {"lo": 0.5, "hi": 0.9, "default": 0.8}, "h": {"lo": 0.03, "hi": 0.06, "default": 0.05}, "z": 2, "optional": True},
    ],
})


def test_canvas_size_keeps_the_short_edge():
    assert canvas_size("4:5", 1080) == (1080, 1350)
    assert canvas_size("16:9", 1080) == (1920, 1080)
    assert canvas_size("1:1", 500) == (500, 500)
    with pytest.raises(ValueError):
        canvas_size("wide")


def test_place_turns_fractions_into_pixels_and_enforces_the_photo_aspect():
    p = place(LAYOUT, 1000, 2000, {"headline": "Hi"})
    pic = p.get("pic")
    assert (pic.x, pic.y, pic.w) == (100, 200, 800)
    # 800 x 1000 would be 0.8; the aspect lower bound 1.5 wins.
    assert pic.w / pic.h == pytest.approx(1.5)
    assert p.get("head").content == "Hi"


def test_optional_empty_slots_are_dropped_and_required_ones_raise():
    p = place(LAYOUT, 100, 100, {"headline": "Hi", "kicker": "  "})
    assert p.dropped == ["kick"] and "dropped optional region 'kick'" in p.log[0]
    with pytest.raises(PlacementError, match="headline"):
        place(LAYOUT, 100, 100, {})
    with pytest.raises(PlacementError, match="photo"):
        place(LAYOUT, 100, 100, {"headline": "Hi"}, has_photo=False)


def test_tuning_is_clamped_to_the_region_bounds_and_logged():
    p = place(LAYOUT, 100, 100, {"headline": "Hi"}, tuning={"head.y": 0.95, "head.x": 0.15, "ghost.x": 0.1})
    assert p.get("head").y == pytest.approx(80) and p.get("head").x == pytest.approx(15)
    assert any("clamped head.y" in line for line in p.log)
    assert any("ignored tuning 'ghost.x'" in line for line in p.log)


# --------------------------------------------------------------- hollow text


def test_hollow_text_draws_only_the_ring(fonts):
    face = fonts.nearest(fonts.in_family("Test Sans"), 900)
    solid = render_text("H", face, 120, color="#FF0000", outline_px=4)
    hollow = render_text("H", face, 120, color="#FF0000", outline_px=4, hollow=True)
    assert hollow.image.shape == solid.image.shape
    # in the outlined render the fill is red and the outline black; hollow keeps only the outline, in red
    inside = (solid.image[..., 3] > 0.99) & (solid.image[..., 0] > 0.99) & (solid.image[..., 1] < 0.01)
    assert inside.sum() > 50
    assert hollow.image[..., 3][inside].mean() < 0.05
    ring = hollow.image[..., 3] > 0.99
    assert ring.any() and np.allclose(hollow.image[ring][:, :3], parse_hex("#FF0000"), atol=1e-3)
    with pytest.raises(ValueError, match="outline_px"):
        render_text("H", face, 40, hollow=True)


def test_a_bare_family_name_prefers_the_normal_width(tmp_path):
    from curio.tests.fontfix import make_font
    from curio.typography import resolve_font

    make_font(tmp_path / "Narrow.ttf", "Arialish", "Narrow", 400, width=3)
    make_font(tmp_path / "Regular.ttf", "Arialish", "Regular", 400, width=5)
    library = FontLibrary.from_directories([tmp_path])
    assert resolve_font([{"name": "Arialish", "confidence": 1}], library).face.width == 5
    assert resolve_font([{"name": "Arialish Narrow", "confidence": 1}], library).face.width == 3


# -------------------------------------------------------------------- runner


def test_every_template_renders_at_the_requested_size(styles, fonts):
    for template_id in sorted(styles.templates):
        result = render_poster(RenderRequest(template_id, CONTENT, photo(), aspect="4:5", short_edge=270, seed=1), styles, fonts)
        assert result.image.shape == (338, 270, 3)
        assert np.all(np.isfinite(result.image)) and result.image.min() >= 0 and result.image.max() <= 1
        assert result.record["template_id"] == template_id
        assert any(name.startswith("type:") for name in result.record["layers"])


def test_rendering_is_deterministic_and_the_seed_matters(styles, fonts):
    tid = sorted(t for t in styles.templates if t.startswith("synth_duotone"))[0]
    a = render_poster(RenderRequest(tid, CONTENT, photo(), short_edge=200, seed=5), styles, fonts)
    b = render_poster(RenderRequest(tid, CONTENT, photo(), short_edge=200, seed=5), styles, fonts)
    c = render_poster(RenderRequest(tid, CONTENT, photo(), short_edge=200, seed=6), styles, fonts)
    assert np.array_equal(a.image, b.image) and a.record == b.record
    assert not np.array_equal(a.image, c.image)


def test_the_record_explains_what_happened(styles, fonts):
    tid = "synth_newsprint__inset_window"
    result = render_poster(RenderRequest(tid, CONTENT, photo(), short_edge=300, overrides={"halftone_screen.pitch_px": 500}), styles, fonts)
    record = result.record
    assert any("rejected halftone_screen.pitch_px" in w for w in result.warnings)
    assert set(record["fonts"]) == {"headline", "kicker", "tracklist"}
    assert all(f["method"] in ("category_default", "any_installed") for f in record["fonts"].values())  # Impact is not installed
    assert any("fell back" in w for w in result.warnings)
    assert {"kind": "photo", "source": "test fixture", "license": "CC0-1.0"} in record["assets_used"]
    assert [s["op"] for s in record["steps"]][:2] == ["levels", "halftone_screen"]
    json.dumps(record)  # the record is plain data


def test_lengths_follow_the_output_size(styles, fonts):
    tid = "synth_newsprint__inset_window"
    small = render_poster(RenderRequest(tid, CONTENT, photo(), short_edge=540), styles, fonts).record
    large = render_poster(RenderRequest(tid, CONTENT, photo(), short_edge=1080), styles, fonts).record
    pitch = lambda r: next(s for s in r["steps"] if s["op"] == "halftone_screen")["params"]["pitch_px"]  # noqa: E731
    assert pitch(large) == pytest.approx(2 * pitch(small))


def test_unsupported_capabilities_and_missing_licences_are_warned(styles, fonts):
    tid = sorted(t for t in styles.templates if t.startswith("synth_duotone"))[0]
    result = render_poster(RenderRequest(tid, CONTENT, Photo(standin_photo(64)), short_edge=300), styles, fonts)
    assert any("subject isolation" in w for w in result.warnings)
    assert any("no licence" in w for w in result.warnings)
    assert any("upscaled" in w for w in result.warnings)


def test_every_type_region_meets_its_contrast_target_or_says_so(styles, fonts):
    for template_id in sorted(styles.templates):
        record = render_poster(RenderRequest(template_id, CONTENT, photo(), short_edge=270), styles, fonts).record
        for region_id, fix in record["legibility"].items():
            assert fix["kind"] == "unfixable" or fix["ratio_after"] >= fix["required"], (template_id, region_id, fix)


def test_type_over_a_dark_photo_is_fixed_not_left_unreadable(styles, fonts):
    # full-bleed duotone: the headline sits on the photo, and the style has no text colour, so it starts black.
    # A black photo becomes the dark shadow colour, so black type must be changed.
    tid = "synth_duotone__full_bleed"
    dark = Photo(np.zeros((400, 400, 3), np.float32), license="CC0-1.0")
    result = render_poster(RenderRequest(tid, {"headline": "Loud"}, dark, short_edge=300), styles, fonts)
    fix = result.record["legibility"]["headline"]
    assert fix["kind"] in ("color_shift", "outline", "plate")
    assert fix["ratio_after"] >= fix["required"]
    shadow = parse_hex("#1B1340")
    if fix["kind"] == "color_shift":
        assert contrast_ratio(parse_hex(fix["text_color"]), shadow) >= fix["required"]
    elif fix["kind"] == "outline":
        assert contrast_ratio(parse_hex(fix["outline_color"]), shadow) >= 3.0
    else:
        assert "plate:headline" in result.record["layers"]


def test_optional_slots_without_content_are_dropped(styles, fonts):
    record = render_poster(RenderRequest("synth_newsprint__inset_window", {"headline": "Only"}, photo(), short_edge=270), styles, fonts).record
    assert set(record["dropped_regions"]) == {"kicker", "tracklist"}
    assert set(record["type"]) == {"headline"}


def test_a_missing_photo_is_an_error_not_a_blank(styles, fonts):
    with pytest.raises(PlacementError, match="no photo"):
        render_poster(RenderRequest("synth_newsprint__inset_window", CONTENT, None), styles, fonts)


def test_the_cli_writes_the_poster_and_its_record(styles_dir, fonts, tmp_path):
    from curio.cli import main as cli
    from curio.core.image import save_image

    save_image(standin_photo(200), tmp_path / "in.png")
    font_dir = Path(fonts.faces[0].path).parent
    code = cli([
        "render", str(styles_dir), "synth_newsprint__inset_window", str(tmp_path / "out" / "p.png"),
        "--photo", str(tmp_path / "in.png"), "--license", "CC0-1.0", "--fonts", str(font_dir),
        "--text", "headline=Hello", "--text", "tracklist=One|Two|Three", "--short-edge", "200", "--seed", "4",
    ])
    assert code == 0
    record = json.loads((tmp_path / "out" / "p.json").read_text(encoding="utf-8"))
    assert record["canvas"] == [200, 250] and record["seed"] == 4 and "tracklist" in record["type"]
    assert (tmp_path / "out" / "p.png").stat().st_size > 0
    assert cli(["render", str(styles_dir), "synth_newsprint__inset_window", str(tmp_path / "x.png"), "--text", "oops"]) == 1


def test_long_lists_spread_into_columns_before_shrinking(fonts):
    face = fonts.nearest(fonts.in_family("Test Sans"), 400)
    lines = [f"Track {i}" for i in range(20)]
    size_one, cols_one, fits = fit_microtype(lines[:3], face, 600, 600, 40, 6, 0.0, 1.3, "upper")  # room to spare: one column
    size_many, cols_many, fits_many = fit_microtype(lines, face, 600, 120, 40, 6, 0.0, 1.3, "upper")
    assert fits and fits_many and cols_one == 1 and cols_many > 1
    assert size_many <= size_one
    _, cols, fits_none = fit_microtype(lines * 20, face, 50, 10, 40, 6, 0.0, 1.3, "upper")
    assert not fits_none and cols == 1

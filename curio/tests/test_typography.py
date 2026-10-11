from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from curio.core.color import contrast_ratio, parse_hex
from curio.tests.fontfix import glyph_advance, make_family_set, make_font
from curio.tests.golden import check_golden
from curio.typography import (
    FontLibrary,
    GroupItem,
    NoFontsError,
    arc_path,
    check_legibility,
    fit_group,
    fit_text_size,
    fix_legibility,
    measure_text,
    parse_weight,
    render_microtype_column,
    render_text,
    render_text_on_path,
    resolve_font,
    resolve_size_px,
)


@pytest.fixture(scope="module")
def font_dir(tmp_path_factory) -> Path:
    return make_family_set(tmp_path_factory.mktemp("fonts"))


@pytest.fixture(scope="module")
def library(font_dir) -> FontLibrary:
    return FontLibrary.from_directories([font_dir])


def face(library: FontLibrary, family: str, weight: int = 400):
    hit = library.nearest(library.in_family(family), weight)
    assert hit is not None
    return hit


def ink_box(image: np.ndarray, threshold: float = 0.05):
    ys, xs = np.nonzero(image[..., 3] > threshold)
    return xs.min(), ys.min(), xs.max(), ys.max()


# --------------------------------------------------------------------- library


def test_library_reads_metadata_from_the_font_files(library):
    assert len(library) == 8 and not library.issues
    black = face(library, "Test Sans", 900)
    assert (black.family, black.style, black.weight, black.width, black.italic) == ("Test Sans", "Black", 900, 5, False)
    assert black.license == "SIL Open Font License 1.1" and black.license_url == "https://openfontlicense.org"
    assert face(library, "Test Condensed").width == 3 and face(library, "Test Condensed").width_name == "condensed"
    assert any(f.italic for f in library.in_family("Test Sans"))


def test_categories_come_from_the_font_not_the_filename(library):
    assert face(library, "Test Sans").category == "sans-serif"
    assert face(library, "Test Serif").category == "serif"
    assert face(library, "Test Mono").category == "monospace"
    assert library.families() == ["Test Condensed", "Test Mono", "Test Sans", "Test Serif"]


def test_script_and_display_categories_from_panose(tmp_path):
    make_font(tmp_path / "a.ttf", "Plain Hand", family_type=3)
    make_font(tmp_path / "b.ttf", "Plain Deco", family_type=4)
    lib = FontLibrary.from_directories([tmp_path])
    assert face(lib, "Plain Hand").category == "script" and face(lib, "Plain Deco").category == "display"


def test_sidecar_overrides_category_and_licence(tmp_path):
    make_font(tmp_path / "x.ttf", "Mystery Face")
    (tmp_path / "fonts.json").write_text(json.dumps({"Mystery Face": {"category": "display", "license": "Custom commercial"}, "Other": "ignored"}))
    lib = FontLibrary.from_directories([tmp_path])
    assert face(lib, "Mystery Face").category == "display" and face(lib, "Mystery Face").license == "Custom commercial"


def test_bad_sidecar_values_are_ignored(tmp_path):
    make_font(tmp_path / "x.ttf", "Plain Face")
    (tmp_path / "fonts.json").write_text(json.dumps({"Plain Face": {"category": "wizardly"}}))
    assert face(FontLibrary.from_directories([tmp_path]), "Plain Face").category == "sans-serif"
    (tmp_path / "fonts.json").write_text("{not json")
    assert len(FontLibrary.from_directories([tmp_path])) == 1


def test_corrupt_and_missing_inputs_are_reported_not_fatal(tmp_path):
    make_font(tmp_path / "good.ttf", "Good Font")
    (tmp_path / "broken.ttf").write_bytes(b"this is not a font")
    lib = FontLibrary.from_directories([tmp_path, tmp_path / "nowhere"])
    assert len(lib) == 1
    messages = " ".join(i.message for i in lib.issues)
    assert "unreadable" in messages and "not a directory" in messages


def test_the_index_order_is_deterministic(font_dir):
    a, b = FontLibrary.from_directories([font_dir]), FontLibrary.from_directories([font_dir])
    assert [f.path for f in a.faces] == [f.path for f in b.faces]
    assert a.faces == sorted(a.faces, key=lambda f: f.sort_key())


def test_indexing_the_same_file_twice_does_not_duplicate_it(font_dir):
    lib = FontLibrary.from_directories([font_dir])
    assert lib.add_directory(font_dir) == 0 and len(lib) == 8


def test_nearest_picks_by_slant_then_weight_then_width(library):
    sans = library.in_family("Test Sans")
    assert library.nearest(sans, weight=860).weight == 900
    assert library.nearest(sans, weight=800).weight == 700  # an exact tie goes to the lighter face, every time
    assert library.nearest(sans, weight=300).weight == 400
    assert library.nearest(sans, italic=True).italic is True
    assert library.nearest(sans, weight=700, italic=False).style == "Bold"
    assert library.nearest([], weight=400) is None
    assert library.nearest(library.faces, weight=700, width=3).family == "Test Condensed"


def test_best_for_prefers_configured_defaults_then_nearest_in_category(font_dir):
    plain = FontLibrary.from_directories([font_dir])
    assert plain.best_for("serif", 700).family == "Test Serif"
    assert plain.best_for("script") is None and plain.best_for(None) is None
    configured = FontLibrary.from_directories([font_dir], category_defaults={"sans-serif": ["Test Condensed"]})
    assert configured.best_for("sans-serif", 700).family == "Test Condensed"


def test_parse_weight_accepts_words_numbers_and_garbage():
    assert parse_weight("bold") == 700 and parse_weight("Extra Bold") == 800 and parse_weight("BLACK") == 900
    assert parse_weight("light") == 300 and parse_weight("regular") == 400
    assert parse_weight(650) == 700 and parse_weight(750) == 800 and parse_weight(649) == 600  # halves round up
    assert parse_weight("700") == 700 and parse_weight(30) == 100 and parse_weight(2000) == 900
    assert parse_weight("wobbly") == 400 and parse_weight(None, default=500) == 500 and parse_weight(True) == 400


# -------------------------------------------------------------------- matching


def test_exact_family_and_style_names_resolve(library):
    assert resolve_font([{"name": "Test Serif", "confidence": 0.9}], library).face.family == "Test Serif"
    black = resolve_font([{"name": "Test Sans Black", "confidence": 0.9}], library)
    assert black.method == "exact_name" and black.face.weight == 900
    bold_italic = resolve_font([{"name": "TestSans-Italic", "confidence": 1}], library)
    assert bold_italic.face.italic


def test_matches_are_tried_by_descending_confidence(library):
    matches = [{"name": "Test Mono", "confidence": 0.2}, {"name": "Test Serif", "confidence": 0.95}]
    result = resolve_font(matches, library)
    assert result.face.family == "Test Serif" and result.tried == ["Test Serif"]


def test_missing_fonts_fall_through_the_list(library):
    matches = [{"name": "Futura Display", "confidence": 0.9}, {"name": "Not Installed", "confidence": 0.8}, {"name": "Test Mono", "confidence": 0.1}]
    result = resolve_font(matches, library)
    assert result.face.family == "Test Mono" and result.tried == ["Futura Display", "Not Installed", "Test Mono"]
    assert not result.is_fallback


def test_close_spellings_match_fuzzily(library):
    for spelling in ("TestSans", "test-sans", "Test Sanss", "TEST SANS"):
        got = resolve_font([{"name": spelling, "confidence": 1}], library)
        assert got.face.family == "Test Sans", spelling
    assert resolve_font([{"name": "Test Sanss", "confidence": 1}], library).method == "fuzzy"


def test_role_weight_chooses_a_face_within_the_matched_family(library):
    assert resolve_font([{"name": "Test Sans", "confidence": 1}], library, weight="black").face.weight == 900
    assert resolve_font([{"name": "Test Sans", "confidence": 1}], library, weight="bold").face.weight == 700
    assert resolve_font([{"name": "Test Sans", "confidence": 1}], library, italic=True).face.italic


def test_unmatched_fonts_fall_back_to_the_category_default_and_say_so(library):
    result = resolve_font([{"name": "Futura Display", "confidence": 0.9}], library, category="serif", weight="bold")
    assert result.method == "category_default" and result.is_fallback
    assert result.face.family == "Test Serif" and result.face.weight == 700 and result.requested == "Futura Display"


def test_with_no_category_match_anything_installed_is_better_than_nothing(library):
    result = resolve_font([{"name": "Futura Display", "confidence": 0.9}], library, category="script")
    assert result.method == "any_installed" and result.is_fallback
    assert resolve_font(None, library).method == "any_installed"


def test_malformed_match_entries_are_skipped(library):
    junk = [None, "text", {"name": ""}, {"confidence": 1}, {"name": 5}, {"name": "Test Mono", "confidence": "high"}]
    assert resolve_font(junk, library).face.family == "Test Mono"


def test_an_empty_library_raises_a_clear_error():
    with pytest.raises(NoFontsError):
        resolve_font([{"name": "Anything"}], FontLibrary())


def test_resolution_is_deterministic(library):
    matches = [{"name": "Nope", "confidence": 0.5}]
    first = resolve_font(matches, library, category="sans-serif")
    assert all(resolve_font(matches, library, category="sans-serif").face == first.face for _ in range(5))


# ------------------------------------------------------------------- rendering


def test_render_returns_straight_alpha_rgba_in_the_requested_colour(library):
    out = render_text("Hello", face(library, "Test Sans"), 48, color="#336699")
    img = out.image
    assert img.shape[2] == 4 and img.min() >= 0.0 and img.max() <= 1.0 and img.dtype == np.float32
    solid = img[..., 3] > 0.99
    assert solid.any() and np.allclose(img[..., :3][solid], parse_hex("#336699"), atol=1e-4)


def test_rendering_is_deterministic(library):
    args = ("Hello World", face(library, "Test Sans"), 40)
    assert np.array_equal(render_text(*args, tracking=0.05).image, render_text(*args, tracking=0.05).image)


def test_text_scales_linearly_with_size(library):
    f = face(library, "Test Sans")
    a, b = measure_text("Hello", f, 50), measure_text("Hello", f, 100)
    assert b.width == pytest.approx(2 * a.width, rel=0.03) and b.height == pytest.approx(2 * a.height, rel=0.03)


def test_width_is_the_sum_of_glyph_advances_in_the_synthetic_font(library):
    f = face(library, "Test Sans")
    text = "Hello"
    expected = sum(glyph_advance(c, False) for c in text) / 1000 * 100
    assert measure_text(text, f, 100).width == pytest.approx(expected, abs=2)


def test_tracking_adds_space_between_glyphs_only(library):
    f = face(library, "Test Sans")
    base = measure_text("Hello", f, 100).width
    assert measure_text("Hello", f, 100, tracking=0.1).width == pytest.approx(base + 4 * 10, abs=2)
    assert measure_text("Hello", f, 100, tracking=-0.05).width == pytest.approx(base - 4 * 5, abs=2)
    assert measure_text("H", f, 100, tracking=0.5).width == measure_text("H", f, 100).width  # one glyph: no gap


def test_case_transforms_apply(library):
    f = face(library, "Test Sans")
    assert measure_text("aaa", f, 50, case="upper").lines == ["AAA"]
    assert measure_text("AAA", f, 50, case="lower").lines == ["aaa"]
    assert measure_text("hello world", f, 50, case="title").lines == ["Hello World"]
    with pytest.raises(ValueError):
        measure_text("x", f, 50, case="shouty")


def test_wrapping_respects_max_width_and_explicit_newlines(library):
    f = face(library, "Test Sans")
    text = "one two three four five six"
    metrics = measure_text(text, f, 40, max_width=200)
    assert len(metrics.lines) > 1 and metrics.width <= 200
    assert " ".join(metrics.lines) == text  # nothing lost or duplicated
    assert measure_text("a\nb\n\nc", f, 40).lines == ["a", "b", "", "c"]
    assert measure_text("Antidisestablishment", f, 40, max_width=50).lines == ["Antidisestablishment"]  # never split mid-word


def test_leading_controls_block_height(library):
    f = face(library, "Test Sans")
    tight, loose = measure_text("a\nb\nc", f, 50, leading=0.9), measure_text("a\nb\nc", f, 50, leading=1.5)
    assert loose.height - tight.height == pytest.approx(2 * 0.6 * 50, abs=2)


def test_alignment_positions_the_ink(library):
    f = face(library, "Test Sans")
    boxes = {a: ink_box(render_text("MMMMMM\nM", f, 40, align=a).image) for a in ("left", "center", "right")}
    # Compare the short second line's horizontal position through the image.
    def second_line_x(align):
        img = render_text("MMMMMM\nM", f, 40, align=align).image
        h = img.shape[0]
        ys, xs = np.nonzero(img[h // 2 + 12 :, :, 3] > 0.05)
        return xs.mean()

    assert second_line_x("left") < second_line_x("center") < second_line_x("right")
    assert boxes["left"][2] == boxes["right"][2]  # same overall width
    with pytest.raises(ValueError):
        render_text("x", f, 20, align="justify")


def test_ink_never_touches_the_image_edge(library):
    for outline in (0, 6):
        img = render_text("Wide Text Here", face(library, "Test Sans", 900), 60, outline_px=outline, tracking=0.2).image
        assert img[0, :, 3].max() == 0 and img[-1, :, 3].max() == 0 and img[:, 0, 3].max() == 0 and img[:, -1, 3].max() == 0


def test_outline_adds_a_coloured_border_around_the_fill(library):
    f = face(library, "Test Sans", 900)
    plain = render_text("MM", f, 80, color="#FFFFFF")
    outlined = render_text("MM", f, 80, color="#FFFFFF", outline_px=5, outline_color="#FF0000")
    assert (outlined.image[..., 3] > 0.5).sum() > (plain.image[..., 3] > 0.5).sum()
    # The outlined image has 5px more padding on every side; align before comparing.
    aligned = outlined.image[5:-5, 5:-5]
    assert aligned.shape == plain.image.shape
    border = (aligned[..., 3] > 0.9) & (plain.image[..., 3] < 0.05)
    assert border.any() and np.allclose(aligned[..., :3][border], [1, 0, 0], atol=0.02)
    inside = plain.image[..., 3] > 0.99
    assert np.allclose(aligned[..., :3][inside], 1.0, atol=0.02)


def test_rotation_by_ninety_swaps_the_block_dimensions(library):
    f = face(library, "Test Sans")
    flat, turned = render_text("Hello there", f, 40), render_text("Hello there", f, 40, rotation_deg=90)
    assert turned.height == pytest.approx(flat.width, abs=2) and turned.width == pytest.approx(flat.height, abs=2)
    assert turned.baseline is None and flat.baseline is not None


def test_empty_and_whitespace_text_render_without_error(library):
    f = face(library, "Test Sans")
    assert render_text("", f, 30).image[..., 3].max() == 0
    assert render_text("   ", f, 30).image[..., 3].max() == 0


def test_heavier_weights_draw_more_ink(library):
    light = render_text("MMM", face(library, "Test Sans", 400), 80).image[..., 3].sum()
    heavy = render_text("MMM", face(library, "Test Sans", 900), 80).image[..., 3].sum()
    assert heavy > light * 1.2


def test_text_golden(library, update_golden):
    sans, serif = face(library, "Test Sans", 700), face(library, "Test Serif")
    top = render_text("Midnight Jazz", sans, 34, color="#1B1340", tracking=-0.02, case="upper").image
    bottom = render_text("Live Music Friday\nDoors at seven", serif, 18, color="#B2452E", leading=1.3, align="center", outline_px=1, outline_color="#FFFFFF").image
    canvas = np.ones((130, 300, 4), np.float32)
    canvas[..., 3] = 1.0
    for img, y in ((top, 8), (bottom, 56)):
        h, w = img.shape[:2]
        region = canvas[y : y + h, 10 : 10 + w]
        a = img[: region.shape[0], : region.shape[1], 3:4]
        region[..., :3] = region[..., :3] * (1 - a) + img[: region.shape[0], : region.shape[1], :3] * a
    check_golden("text__sample", canvas, update_golden)


# ------------------------------------------------------------------------- fit


def test_fit_text_size_is_the_largest_that_fits(library):
    f = face(library, "Test Sans")
    size = fit_text_size("Hello world", f, 300, 120, wrap=False)
    fits = lambda s: (lambda m: m.width <= 300 and m.height <= 120)(measure_text("Hello world", f, s))
    assert fits(size) and not fits(size + 1)


def test_fit_with_wrapping_uses_the_height_too(library):
    f = face(library, "Test Sans")
    text = "the quick brown fox jumps over the lazy dog"
    wide, tall = fit_text_size(text, f, 400, 60), fit_text_size(text, f, 400, 400)
    assert tall > wide
    metrics = measure_text(text, f, tall, max_width=400)
    assert metrics.width <= 400 and metrics.height <= 400


def test_fit_returns_the_minimum_when_nothing_fits(library):
    assert fit_text_size("Hello world", face(library, "Test Sans"), 5, 5, min_px=6, wrap=False) == 6


def test_fit_group_keeps_the_hierarchy_ratios_and_fills_the_box(library):
    f = face(library, "Test Sans")
    items = [GroupItem("HEADLINE", f, 0.12), GroupItem("a subtitle line", f, 0.04), GroupItem("fine print", f, 0.02)]
    sizes = fit_group(items, 400, 500)
    assert sizes[0] / sizes[1] == pytest.approx(3.0, rel=0.05) and sizes[1] / sizes[2] == pytest.approx(2.0, rel=0.08)
    total = sum(measure_text(i.text, i.face, s, max_width=400).height for i, s in zip(items, sizes))
    assert total <= 500
    bigger = fit_group(items, 800, 1000)
    assert bigger[0] > sizes[0]
    assert fit_group([], 100, 100) == []


def test_fit_group_never_overflows_the_width(library):
    f = face(library, "Test Sans")
    sizes = fit_group([GroupItem("EXTRAORDINARILY", f, 0.1, wrap=False)], 200, 1000)
    assert measure_text("EXTRAORDINARILY", f, sizes[0]).width <= 200


def test_size_rel_resolves_against_the_canvas_height_and_rejects_nonsense():
    assert resolve_size_px(0.1, 1350) == pytest.approx(135.0)
    for bad in (0, -1, None):
        with pytest.raises(ValueError):
            resolve_size_px(bad, 1000)


# ---------------------------------------------------------------- microtype etc


def test_microtype_deals_lines_into_columns_in_reading_order(library):
    f = face(library, "Test Mono")
    lines = [f"Track {i}" for i in range(1, 7)]
    one = render_microtype_column(lines, f, 14, 300, columns=1)
    two = render_microtype_column(lines, f, 14, 300, columns=2)
    assert two.height < one.height
    assert two.lines[:3] == ["TRACK 1", "TRACK 2", "TRACK 3"] and two.lines[3:] == ["TRACK 4", "TRACK 5", "TRACK 6"]
    left, right = two.image[:, : two.width // 2], two.image[:, two.width // 2 :]
    assert left[..., 3].max() > 0 and right[..., 3].max() > 0


def test_microtype_lines_do_not_wrap_unless_asked(library):
    f = face(library, "Test Mono")
    line = ["A fairly long track title here"]
    assert len(render_microtype_column(line, f, 14, 80).lines) == 1
    assert len(render_microtype_column(line, f, 14, 80, wrap=True).lines) > 1


def test_microtype_rejects_columns_with_no_room(library):
    with pytest.raises(ValueError):
        render_microtype_column(["a", "b"], face(library, "Test Mono"), 14, 20, columns=2, gutter_px=30)


def test_text_on_a_straight_path_matches_ordinary_text(library):
    f = face(library, "Test Sans")
    canvas = (300, 120)
    on_path = render_text_on_path("HELLO", f, 40, [(20, 80), (280, 80)], canvas)
    flat = render_text("HELLO", f, 40)
    x0, y0, x1, y1 = ink_box(on_path)
    fx0, fy0, fx1, fy1 = ink_box(flat.image)
    assert (x1 - x0) == pytest.approx(fx1 - fx0, abs=6) and (y1 - y0) == pytest.approx(fy1 - fy0, abs=4)
    assert y1 == pytest.approx(80, abs=3)  # the baseline sits on the path


def test_text_follows_a_curve_and_drops_glyphs_past_the_end(library):
    f = face(library, "Test Sans")
    arc = arc_path(150, 150, 100, 200, 340)
    curved = render_text_on_path("ARC TEXT", f, 24, arc, (300, 200))
    x0, y0, x1, y1 = ink_box(curved)
    assert (y1 - y0) > 24 * 1.5  # glyphs rise and fall along the arc
    short = render_text_on_path("AAAAAAAAAAAAAAAAAAAA", f, 24, [(10, 50), (60, 50)], (300, 100))
    assert ink_box(short)[2] < 70  # nothing drawn beyond the end of the path
    with pytest.raises(ValueError):
        render_text_on_path("x", f, 20, [(0, 0)], (50, 50))


def test_arc_path_points_lie_on_the_circle():
    pts = np.array(arc_path(10, 20, 5, 0, 180, steps=7))
    assert np.allclose(np.hypot(pts[:, 0] - 10, pts[:, 1] - 20), 5)
    assert np.allclose(pts[0], [15, 20]) and np.allclose(pts[-1], [5, 20], atol=1e-9)


# ------------------------------------------------------------------ legibility


def test_black_on_white_passes_and_grey_on_grey_fails():
    assert check_legibility("#000000", "#FFFFFF").passes
    low = check_legibility("#808080", "#888888")
    assert not low.passes and low.worst_ratio < 1.5


def test_legibility_uses_the_worst_part_of_a_background_region():
    region = np.zeros((20, 20, 3), np.float32)
    region[:, 10:] = 1.0  # half black, half white
    report = check_legibility("#808080", region)
    assert not report.passes and report.worst_ratio < report.median_ratio + 5


def test_already_legible_type_is_left_alone():
    fix = fix_legibility("#000000", "#FFFFFF")
    assert fix.kind == "none" and fix.text_color == "#000000"


def test_colour_shift_keeps_the_hue_and_reaches_the_target():
    fix = fix_legibility("#8899DD", "#9AA7E0")
    assert fix.kind == "color_shift" and fix.ratio_after >= 4.5
    assert check_legibility(fix.text_color, "#9AA7E0").passes
    r, g, b = parse_hex(fix.text_color)
    assert b >= r - 1e-6  # still a blue-ish type colour


def test_busy_backgrounds_get_an_outline_or_a_plate():
    region = np.zeros((20, 20, 3), np.float32)
    region[:, 10:] = 1.0
    fix = fix_legibility("#FFFFFF", region, size_px=36)
    assert fix.kind in ("outline", "plate")
    if fix.kind == "outline":
        assert fix.outline_px >= 1 and float(contrast_ratio(parse_hex(fix.text_color), parse_hex(fix.outline_color))) >= 4.5
    else:
        assert fix.plate_color and float(contrast_ratio(parse_hex(fix.text_color), parse_hex(fix.plate_color))) >= 4.5


def test_a_fix_for_a_split_background_is_verified_against_the_whole_region():
    region = np.zeros((20, 20, 3), np.float32)
    region[:, 10:] = 1.0
    fix = fix_legibility("#808080", region)
    assert fix.kind in ("color_shift", "outline", "plate") and fix.ratio_after >= 4.5
    if fix.kind == "color_shift":
        # A grey of exactly the right lightness does reach 4.5:1 against both black and white.
        assert check_legibility(fix.text_color, region).passes
    elif fix.kind == "plate":
        assert fix.plate_opacity > 0.5


def test_every_reported_fix_actually_meets_the_requirement():
    rng = np.random.default_rng(0)
    for _ in range(25):
        text = "#{:02X}{:02X}{:02X}".format(*rng.integers(0, 256, 3))
        bg = rng.random((8, 8, 3), dtype=np.float32)
        fix = fix_legibility(text, bg)
        assert fix.kind != "unfixable"
        assert fix.ratio_after >= 4.5 or fix.kind == "none"


def test_large_text_uses_a_lower_threshold():
    assert not check_legibility("#777777", "#FFFFFF", required=4.5).passes
    assert check_legibility("#777777", "#FFFFFF", required=3.0).passes

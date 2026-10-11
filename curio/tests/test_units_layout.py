from __future__ import annotations

import copy
import json

import numpy as np
import pytest

from curio.core.color import luma
from curio.layout import Bounds, LayoutError, parse_bounds, parse_layout
from curio.ops import apply_op, get_op, list_ops
from curio.ops.units import LENGTH_PARAMS, REFERENCE_SHORT_EDGE_PX, length_defaults_scaled, scale_for, scale_lengths
from curio.style_schema import Preset, parse_style_text
from curio.style_schema.schema import IssueCollector
from curio.style_schema.validate import in_range, normalise_range


# ---------------------------------------------------------------------- units


def test_every_pixel_parameter_is_flagged_as_a_length():
    """A new op with a *_px parameter must be added to curio/ops/units.py."""
    for spec in list_ops():
        for p in spec.params.values():
            if p.name.endswith("_px"):
                assert p.length, f"{spec.name}.{p.name} looks like a pixel length but is not in LENGTH_PARAMS"


def test_the_length_table_names_real_parameters_and_flags_exactly_them():
    flagged = {(s.name, p.name) for s in list_ops() for p in s.params.values() if p.length}
    declared = {(op, name) for op, names in LENGTH_PARAMS.items() for name in names}
    assert flagged == declared
    for op, name in declared:
        assert get_op(op).params[name].type in ("float", "float_list")


def test_fractions_and_angles_are_not_lengths():
    for op, name in (("vignette", "radius"), ("halftone_screen", "angle_deg"), ("halftone_screen", "dot_gain"), ("grain", "amount"), ("scan_lines", "thickness")):
        assert not get_op(op).params[name].length


def test_the_scale_is_relative_to_the_short_edge_of_the_canvas():
    assert REFERENCE_SHORT_EDGE_PX == 1080
    assert scale_for(1080, 1350) == 1.0 and scale_for(2160, 2700) == 2.0 and scale_for(4000, 540) == 0.5


def test_only_length_parameters_are_scaled():
    out = scale_lengths("halftone_screen", {"pitch_px": 8.0, "angle_deg": 45.0, "dot_gain": 0.1}, 2.0)
    assert out == {"pitch_px": 16.0, "angle_deg": 45.0, "dot_gain": 0.1}
    assert scale_lengths("misregistration", {"red": [2.0, -1.0], "green": [0, 0]}, 3.0) == {"red": [6.0, -3.0], "green": [0, 0]}
    assert scale_lengths("levels", {"gamma": 1.2}, 5.0) == {"gamma": 1.2}


def test_scaling_does_not_mutate_its_input():
    params = {"pitch_px": 8.0}
    scale_lengths("halftone_screen", params, 2.0)
    assert params == {"pitch_px": 8.0}


def test_an_unset_length_still_follows_the_output_size():
    scaled = length_defaults_scaled("halftone_screen", {}, 2.0)
    assert scaled["pitch_px"] == pytest.approx(get_op("halftone_screen").params["pitch_px"].default * 2.0)


def _dominant_cycles(image: np.ndarray) -> int:
    plane = luma(image) - luma(image).mean()
    mag = np.abs(np.fft.fftshift(np.fft.fft2(plane)))
    c = mag.shape[0] // 2
    mag[c - 2 : c + 3, c - 2 : c + 3] = 0
    iy, ix = np.unravel_index(np.argmax(mag), mag.shape)
    return int(max(abs(ix - c), abs(iy - c)))


def test_the_same_style_has_the_same_number_of_dots_at_any_output_size():
    counts = []
    for size in (540, 1080):
        params = scale_lengths("halftone_screen", {"pitch_px": 12.0, "angle_deg": 0.0}, scale_for(size, size))
        out = apply_op("halftone_screen", np.full((size, size, 3), 0.5, np.float32), params)
        counts.append(_dominant_cycles(out))
    assert counts[0] == counts[1] == 90  # 1080 px / 12 px, and 540 px / 6 px


# ------------------------------------------------------------- colour ranges


def _range(value):
    c = IssueCollector("t")
    return normalise_range(value, c), c.issues


def test_a_colour_range_normalises_and_checks_its_fields():
    r, issues = _range({"center": "#90e908", "max_delta_e": 6})
    assert r == {"center": "#90E908", "max_delta_e": 6.0} and not issues
    for bad in ({"center": "lime", "max_delta_e": 6}, {"center": "#90E908"}, {"center": "#90E908", "max_delta_e": -1}, {"center": "#90E908", "max_delta_e": "6"}):
        assert _range(bad)[0] is None


def test_colour_distance_is_measured_in_delta_e():
    r, _ = _range({"center": "#90E908", "max_delta_e": 6})
    assert in_range("#90E908", r) and in_range("#8FE40A", r)
    assert not in_range("#FF0000", r) and not in_range("lime", r) and not in_range(0.5, r)


def _riso(extra_ranges=None, defining=True):
    return {
        "schema_version": "1.0",
        "preset_id": "colour_test",
        "defining_params": ["duotone.highlight"] if defining else [],
        "free_params": [] if defining else ["duotone.highlight"],
        "defaults": {"duotone": {"shadow": "#101010", "highlight": "#90E908"}},
        "ranges": {"duotone": {"highlight": {"center": "#90E908", "max_delta_e": 6}}},
        "pipeline": [{"op": "duotone"}],
    }


def _preset(raw) -> Preset:
    doc, issues = parse_style_text(json.dumps(raw), "t.json")
    assert doc is not None, [str(i) for i in issues]
    return Preset(doc)


@pytest.mark.parametrize("defining", [True, False])
def test_a_colour_override_inside_the_range_is_accepted_and_outside_is_rejected(defining):
    p = _preset(_riso(defining=defining))
    ok = p.resolve({"duotone.highlight": "#8FE40A"})
    assert ok.values["duotone.highlight"] == "#8FE40A" and ok.log[0].action == "set"
    bad = p.resolve({"duotone.highlight": "#FF0000"})
    assert bad.values["duotone.highlight"] == "#90E908" and bad.rejected() and "delta E" in bad.rejected()[0].reason


def test_a_default_colour_outside_its_own_range_is_an_error():
    raw = _riso()
    raw["defaults"]["duotone"]["highlight"] = "#FF0000"
    doc, issues = parse_style_text(json.dumps(raw), "t.json")
    assert doc is None and any("outside its own range" in i.message for i in issues)


def test_a_malformed_colour_range_is_reported_at_its_path():
    raw = _riso()
    raw["ranges"]["duotone"]["highlight"] = {"center": "lime", "max_delta_e": 6}
    doc, issues = parse_style_text(json.dumps(raw), "t.json")
    assert doc is None and any(i.path.startswith("ranges.duotone.highlight") for i in issues if i.severity == "error")


# -------------------------------------------------------------------- layouts


def good_layout() -> dict:
    def b(lo, default, hi):
        return {"lo": lo, "hi": hi, "default": default}

    return {
        "schema_version": "1.0",
        "layout_id": "fam__inset",
        "cluster_id": "fam",
        "alignment": "center",
        "aspects_seen": ["4:5"],
        "negative_space": b(0.3, 0.4, 0.5),
        "regions": [
            {"id": "photo", "role": "photo", "content": "photo", "x": b(0.06, 0.08, 0.1), "y": b(0.15, 0.18, 0.2), "w": b(0.8, 0.84, 0.88), "h": b(0.38, 0.42, 0.46), "z": 1, "bleed": [], "aspect_ratio": b(1.6, 1.75, 1.8)},
            {"id": "headline", "role": "type", "content": "headline", "x": b(0.05, 0.06, 0.07), "y": b(0.6, 0.64, 0.68), "w": b(0.86, 0.88, 0.9), "h": b(0.12, 0.14, 0.16), "z": 2},
        ],
    }


def test_a_valid_layout_parses_and_round_trips():
    layout = parse_layout(good_layout())
    assert layout.layout_id == "fam__inset" and layout.alignment == "center"
    assert layout.slots == ["headline"] and layout.region("photo").aspect_ratio.default == 1.75
    again = parse_layout(layout.to_dict())
    assert again == layout


def test_unknown_layout_fields_are_kept():
    raw = good_layout()
    raw["future"] = {"a": 1}
    assert parse_layout(raw).extra == {"future": {"a": 1}} and parse_layout(raw).to_dict()["future"] == {"a": 1}


def test_bounds_must_be_ordered_and_inside_limits():
    assert parse_bounds({"lo": 0.1, "hi": 0.3, "default": 0.2}, "x") == Bounds(0.1, 0.3, 0.2)
    for bad in ({"lo": 0.3, "hi": 0.1, "default": 0.2}, {"lo": 0.1, "hi": 0.3, "default": 0.5}, {"lo": 0.0, "hi": 9.0, "default": 0.5}, {"lo": "a", "hi": 1, "default": 1}, "x", {"lo": 0, "hi": 1}):
        with pytest.raises(LayoutError):
            parse_bounds(bad, "x")
    assert Bounds(0.2, 0.6, 0.4).clamp(0.9) == 0.6 and Bounds.fixed(0.5).clamp(0.1) == 0.5


@pytest.mark.parametrize(
    "edit,fragment",
    [
        (lambda d: d.pop("layout_id"), "layout_id"),
        (lambda d: d.update(alignment="justify"), "alignment"),
        (lambda d: d.update(regions=[]), "regions"),
        (lambda d: d["regions"][1].update(id="photo"), "duplicate region id"),
        (lambda d: d["regions"][0].update(role="blob"), "regions[0].role"),
        (lambda d: d["regions"][1].update(content="slogan"), "regions[1].content"),
        (lambda d: d["regions"][0].update(bleed=["middle"]), "regions[0].bleed"),
        (lambda d: d["regions"][0].update(z=1.5), "regions[0].z"),
        (lambda d: d["regions"][0].update(frame="thick"), "regions[0].frame"),
        (lambda d: d["regions"][0]["x"].update(default=0.95, hi=0.99), "runs off the right edge"),
        (lambda d: d["regions"][0]["y"].update(default=0.9, hi=0.95), "runs off the bottom edge"),
        (lambda d: d["regions"][0].pop("w"), "regions[0].w"),
    ],
)
def test_malformed_layouts_are_rejected_with_the_field_path(edit, fragment):
    d = copy.deepcopy(good_layout())
    edit(d)
    with pytest.raises(LayoutError, match=fragment.replace("[", r"\[").replace("]", r"\]")):
        parse_layout(d)


def test_a_region_may_run_off_an_edge_only_when_it_bleeds_there():
    d = good_layout()
    d["regions"][0]["x"] = {"lo": 0.4, "hi": 0.6, "default": 0.5}
    d["regions"][0]["w"] = {"lo": 0.6, "hi": 0.8, "default": 0.7}
    with pytest.raises(LayoutError):
        parse_layout(d)
    d["regions"][0]["bleed"] = ["right"]
    assert parse_layout(d).region("photo").bleed == ("right",)


def test_negative_space_must_be_a_fraction():
    d = good_layout()
    d["negative_space"] = {"lo": 0.0, "hi": 2.0, "default": 0.5}
    with pytest.raises(LayoutError, match="negative_space"):
        parse_layout(d)

"""Contract tests that run against every registered op, so a new op is held to
the same rules automatically."""

from __future__ import annotations

import numpy as np
import pytest

from curio.ops import OpError, apply_op, get_op, has_op, list_ops, param_errors, validate_params
from curio.ops.registry import Float, Int, OpSpec, Param, register_op
from curio.tests.fixtures import standin_matte, standin_photo, standin_rgba

ALL_OPS = [spec.name for spec in list_ops()]
NEEDS_INPUT = {"cutout"}  # needs a matte; covered in test_ops.py and the golden cases
RGB_OPS = [name for name in ALL_OPS if name not in NEEDS_INPUT]


def photo():
    return standin_photo(48)


def test_the_expected_op_families_are_registered():
    required = {
        "levels", "curves", "brightness_contrast", "exposure", "hue_shift", "saturation", "vibrance",
        "color_balance", "desaturate", "threshold", "posterize", "gradient_map", "duotone", "tritone",
        "channel_mixer", "invert", "halftone_screen", "ordered_dither", "stochastic_dither",
        "bitmap_threshold", "sharpen", "unsharp_mask", "blur", "edge_detect", "grain", "paper_texture",
        "scan_lines", "noise", "misregistration", "ink_bleed", "distress", "halation", "vignette",
        "overlay_texture", "crop", "resize", "rotate", "flip", "perspective", "cutout", "mask",
        "feather", "stroke", "drop_shadow",
    }
    assert required <= set(ALL_OPS), sorted(required - set(ALL_OPS))


def test_every_op_declares_a_category_and_documented_params():
    for spec in list_ops():
        assert spec.category, spec.name
        assert spec.doc, f"{spec.name} needs a docstring"
        for param in spec.params.values():
            if param.type in ("float", "int"):
                assert param.min is not None and param.max is not None, f"{spec.name}.{param.name} needs a range"
                assert param.min <= param.default <= param.max, f"{spec.name}.{param.name} default is out of range"


@pytest.mark.parametrize("name", RGB_OPS)
def test_defaults_are_valid_and_output_is_finite_and_in_range(name):
    out = apply_op(name, photo(), {}, seed=1)
    assert np.all(np.isfinite(out)) and out.min() >= 0.0 and out.max() <= 1.0
    assert out.dtype == np.float32


@pytest.mark.parametrize("name", RGB_OPS)
def test_same_inputs_and_seed_give_identical_output(name):
    a = apply_op(name, photo(), {}, seed=11)
    b = apply_op(name, photo(), {}, seed=11)
    assert np.array_equal(a, b)


@pytest.mark.parametrize("name", RGB_OPS)
def test_seed_only_matters_for_stochastic_ops(name):
    spec = get_op(name)
    a = apply_op(name, photo(), {}, seed=1)
    b = apply_op(name, photo(), {}, seed=2)
    if spec.stochastic:
        assert not np.array_equal(a, b), f"{name} is marked stochastic but ignores its seed"
    else:
        assert np.array_equal(a, b), f"{name} is not marked stochastic but depends on its seed"


@pytest.mark.parametrize("name", RGB_OPS)
def test_ops_never_modify_their_input(name):
    img = photo()
    before = img.copy()
    apply_op(name, img, {}, seed=1)
    assert np.array_equal(img, before)


@pytest.mark.parametrize("name", [n for n in RGB_OPS if not get_op(n).uses_alpha])
def test_alpha_is_carried_through_ops_that_do_not_use_it(name):
    rgba = standin_rgba(48)
    out = apply_op(name, rgba, {}, seed=1)
    assert out.shape == rgba.shape
    assert np.array_equal(out[..., 3], rgba[..., 3])


@pytest.mark.parametrize("name", [n for n in RGB_OPS if not get_op(n).changes_size])
def test_size_preserving_ops_keep_height_and_width(name):
    assert apply_op(name, photo(), {}, seed=1).shape[:2] == photo().shape[:2]


def test_every_alpha_writing_op_returns_rgba():
    for name in ("mask", "feather", "stroke", "drop_shadow"):
        assert apply_op(name, photo(), {}, seed=1).shape[2] == 4, name
    assert apply_op("cutout", photo(), {"matte": standin_matte(48)}, seed=1).shape[2] == 4


# --------------------------------------------------------- param validation


def test_unknown_op_and_unknown_param_are_rejected():
    with pytest.raises(OpError):
        apply_op("sparkle", photo())
    with pytest.raises(OpError, match="no parameter"):
        apply_op("levels", photo(), {"blackness": 0.2})
    assert not has_op("sparkle") and has_op("levels")


def test_out_of_range_values_clamp_at_runtime_but_error_in_validation():
    spec = get_op("levels")
    clamped = apply_op("levels", photo(), {"gamma": 99.0})
    assert np.array_equal(clamped, apply_op("levels", photo(), {"gamma": 5.0}))

    resolved, issues = validate_params(spec, {"gamma": 99.0}, on_range="error")
    assert resolved["gamma"] == 5.0
    assert param_errors(issues) and "outside" in issues[0].message

    _, runtime_issues = validate_params(spec, {"gamma": 99.0}, on_range="clamp")
    assert not param_errors(runtime_issues) and runtime_issues[0].clamped


@pytest.mark.parametrize(
    "op,params",
    [
        ("levels", {"gamma": "bright"}),
        ("levels", {"gamma": True}),
        ("levels", {"gamma": float("nan")}),
        ("posterize", {"levels": 3.5}),
        ("threshold", {"invert": "yes"}),
        ("threshold", {"dark": "black"}),
        ("blur", {"kind": "zoom"}),
        ("gradient_map", {"stops": ["#000000"]}),
        ("gradient_map", {"stops": ["#000000", "red"]}),
        ("curves", {"points": [0, 0, 1]}),
        ("overlay_texture", {"texture": 42}),
    ],
)
def test_wrongly_typed_params_are_errors_not_silently_fixed(op, params):
    with pytest.raises(OpError):
        apply_op(op, photo(), params)


def test_defaults_fill_in_and_colours_are_normalised():
    resolved, issues = validate_params(get_op("duotone"), {"shadow": "#abc"})
    assert not issues
    assert resolved["shadow"] == "#AABBCC" and resolved["highlight"] == "#FFB36B"


def test_int_params_accept_whole_floats_only():
    resolved, issues = validate_params(get_op("posterize"), {"levels": 4.0})
    assert resolved["levels"] == 4 and not issues
    _, bad = validate_params(get_op("posterize"), {"levels": 4.5})
    assert param_errors(bad)


def test_op_spec_can_be_described_for_tooling():
    described = get_op("halftone_screen").describe()
    names = {p["name"] for p in described["params"]}
    assert {"shape", "pitch_px", "angle_deg", "dot_gain", "mode"} <= names
    assert described["category"] == "screening"


# --------------------------------------------- the registry is open for extension


def test_a_new_op_registers_without_touching_the_runner():
    @register_op("test_only_brighten", category="test", params=[Float("by", 0.1, 0.0, 1.0)])
    def brighten(img, p, seed):
        """Adds light."""
        return img + p.by

    try:
        out = apply_op("test_only_brighten", np.zeros((2, 2, 3), np.float32), {"by": 0.25})
        assert np.allclose(out, 0.25)
        with pytest.raises(OpError):
            register_op("test_only_brighten", category="test")(brighten)
    finally:
        from curio.ops import registry

        registry._REGISTRY.pop("test_only_brighten", None)


def test_the_runner_enforces_the_op_contract():
    from curio.ops import registry

    @register_op("test_only_bad_shape", category="test")
    def bad_shape(img, p, seed):
        """Returns the wrong shape."""
        return img[:1]

    @register_op("test_only_nan", category="test")
    def nan(img, p, seed):
        """Returns NaN."""
        return img * np.nan

    try:
        with pytest.raises(OpError, match="changed the image shape"):
            apply_op("test_only_bad_shape", photo())
        with pytest.raises(OpError, match="non-finite"):
            apply_op("test_only_nan", photo())
    finally:
        registry._REGISTRY.pop("test_only_bad_shape", None)
        registry._REGISTRY.pop("test_only_nan", None)


def test_opspec_and_param_types_are_importable():
    assert isinstance(get_op("levels"), OpSpec)
    assert isinstance(Float("a", 0, 0, 1), Param) and isinstance(Int("b", 1, 0, 3), Param)

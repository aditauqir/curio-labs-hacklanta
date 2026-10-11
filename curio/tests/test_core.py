from __future__ import annotations

import numpy as np
import pytest

from curio.core.blend import BLEND_MODES, blend_rgb, composite
from curio.core.color import (
    contrast_ratio,
    delta_e_2000,
    hsv_to_rgb,
    is_hex,
    lab_to_rgb,
    luma,
    parse_hex,
    rgb_to_hsv,
    rgb_to_lab,
    to_hex,
)
from curio.core.layers import Layer, LayerStack, Transform, bleed_off_edge, place, render
from curio.core.noise import fbm
from curio.core.seed import derive_seed, rng
from curio.core.stacks import OpCall, register_stack, run_stack
from curio.core.textures import clear_textures, procedural, register_texture, resolve_texture


# ---------------------------------------------------------------------- seeds


def test_derive_seed_is_stable_across_processes():
    # Pinned: this value must never change, or every stored recipe re-renders differently.
    assert derive_seed(7, "grain", 3) == derive_seed(7, "grain", 3)
    assert derive_seed(0) == 1446120009


def test_derive_seed_depends_on_every_input():
    assert derive_seed(1, "a") != derive_seed(2, "a")
    assert derive_seed(1, "a") != derive_seed(1, "b")
    assert derive_seed(1, "a", 1) != derive_seed(1, "a", 2)


def test_rng_streams_are_reproducible_and_independent():
    assert np.array_equal(rng(5, "x").random(4), rng(5, "x").random(4))
    assert not np.array_equal(rng(5, "x").random(4), rng(5, "y").random(4))


# --------------------------------------------------------------------- colour


def test_hex_round_trip_and_validation():
    assert parse_hex("#FF8000") == pytest.approx((1.0, 128 / 255, 0.0))
    assert parse_hex("#f80") == pytest.approx((1.0, 136 / 255, 0.0))
    assert to_hex((1.0, 0.5, 0.0)) == "#FF8000"
    assert is_hex("#123ABC") and not is_hex("teal") and not is_hex("#12345")
    with pytest.raises(ValueError):
        parse_hex("nope")


def test_hsv_round_trip():
    rgb = np.random.default_rng(1).random((40, 3), dtype=np.float32)
    assert np.allclose(hsv_to_rgb(rgb_to_hsv(rgb)), rgb, atol=1e-5)


def test_lab_round_trip_and_known_white():
    rgb = np.random.default_rng(2).random((40, 3), dtype=np.float32)
    assert np.allclose(lab_to_rgb(rgb_to_lab(rgb)), rgb, atol=2e-3)
    assert rgb_to_lab(np.array([1.0, 1.0, 1.0]))[0] == pytest.approx(100.0, abs=0.05)


def test_delta_e_2000_matches_published_reference_pair():
    # Sharma, Wu, Dalal (2005), test pair 1.
    a = np.array([50.0, 2.6772, -79.7751])
    b = np.array([50.0, 0.0, -82.7485])
    assert float(delta_e_2000(a, b)) == pytest.approx(2.0425, abs=1e-3)
    assert float(delta_e_2000(a, a)) == pytest.approx(0.0, abs=1e-6)


def test_wcag_contrast_extremes():
    assert contrast_ratio((0, 0, 0), (1, 1, 1)) == pytest.approx(21.0, abs=0.01)
    assert contrast_ratio((0.5, 0.5, 0.5), (0.5, 0.5, 0.5)) == pytest.approx(1.0)


def test_luma_weights_sum_to_one():
    assert float(luma(np.ones((2, 2, 3), np.float32))[0, 0]) == pytest.approx(1.0, abs=1e-6)


# ---------------------------------------------------------------- blend modes


def _px(v: float) -> np.ndarray:
    return np.full((1, 1, 3), v, dtype=np.float32)


@pytest.mark.parametrize(
    "mode,backdrop,source,expected",
    [
        ("normal", 0.3, 0.8, 0.8),
        ("multiply", 0.5, 0.5, 0.25),
        ("screen", 0.5, 0.5, 0.75),
        ("overlay", 0.25, 0.5, 0.25),  # overlay of mid grey leaves the backdrop alone
        ("hard_light", 0.5, 0.25, 0.25),
        ("difference", 0.2, 0.7, 0.5),
        ("darken", 0.2, 0.7, 0.2),
        ("lighten", 0.2, 0.7, 0.7),
        ("color_dodge", 0.0, 0.9, 0.0),
        ("color_burn", 1.0, 0.1, 1.0),
        ("soft_light", 0.4, 0.5, 0.4),  # soft light with mid grey is identity
    ],
)
def test_blend_mode_values(mode, backdrop, source, expected):
    assert float(blend_rgb(_px(backdrop), _px(source), mode)[0, 0, 0]) == pytest.approx(expected, abs=1e-5)


def test_every_blend_mode_stays_in_range_and_is_finite():
    grid = np.linspace(0, 1, 11, dtype=np.float32)
    b, s = np.meshgrid(grid, grid)
    for mode in BLEND_MODES:
        out = blend_rgb(b[..., None], s[..., None], mode)
        assert np.all(np.isfinite(out)) and out.min() >= 0.0 and out.max() <= 1.0, mode


def test_unknown_blend_mode_is_rejected():
    with pytest.raises(ValueError):
        blend_rgb(_px(0.5), _px(0.5), "glitter")


def test_composite_alpha_math_matches_porter_duff():
    backdrop = np.concatenate([_px(0.2), np.ones((1, 1, 1), np.float32)], axis=2)
    source = np.concatenate([_px(0.8), np.full((1, 1, 1), 0.5, np.float32)], axis=2)
    out = composite(backdrop, source)
    assert float(out[0, 0, 0]) == pytest.approx(0.5, abs=1e-5)  # 50% of 0.8 over 0.2
    assert float(out[0, 0, 3]) == pytest.approx(1.0)


def test_composite_opacity_and_mask_scale_the_source():
    backdrop = np.zeros((2, 2, 3), np.float32)
    source = np.ones((2, 2, 3), np.float32)
    mask = np.array([[1.0, 0.0], [0.5, 1.0]], np.float32)
    out = composite(backdrop, source, opacity=0.5, mask=mask)
    assert out[0, 0, 0] == pytest.approx(0.5)
    assert out[0, 1, 0] == pytest.approx(0.0)
    assert out[1, 0, 0] == pytest.approx(0.25)


def test_composite_over_transparent_backdrop_keeps_source_colour():
    backdrop = np.zeros((1, 1, 4), np.float32)
    source = np.array([[[0.2, 0.4, 0.6, 0.5]]], np.float32)
    out = composite(backdrop, source)
    assert np.allclose(out[0, 0], [0.2, 0.4, 0.6, 0.5], atol=1e-5)


# --------------------------------------------------------------------- layers


def test_layers_render_bottom_to_top():
    stack = LayerStack([Layer("red", np.full((4, 4, 3), (1, 0, 0), np.float32)), Layer("blue", np.full((4, 4, 3), (0, 0, 1), np.float32))])
    assert np.allclose(render(stack, 4, 4)[0, 0], (0, 0, 1))
    stack.move("blue", 0)
    assert np.allclose(render(stack, 4, 4)[0, 0], (1, 0, 0))


def test_layer_names_are_unique_and_lookup_works():
    stack = LayerStack([Layer("a", np.zeros((2, 2, 3), np.float32))])
    with pytest.raises(ValueError):
        stack.add(Layer("a", np.zeros((2, 2, 3), np.float32)))
    with pytest.raises(KeyError):
        stack.get("missing")


def test_reorder_follows_a_preset_layer_order_and_ignores_unknown_names():
    stack = LayerStack([Layer(n, np.zeros((2, 2, 3), np.float32)) for n in ("a", "b", "c")])
    stack.reorder(["c", "ghost", "a"])
    assert stack.names == ["b", "c", "a"]


def test_invisible_and_zero_opacity_layers_are_skipped():
    stack = LayerStack([Layer("hidden", np.ones((2, 2, 3), np.float32), visible=False), Layer("faint", np.ones((2, 2, 3), np.float32), opacity=0.0)])
    assert np.allclose(render(stack, 2, 2, "#000000"), 0.0)


def test_transform_positions_a_layer_and_clips_at_the_canvas_edge():
    layer = np.ones((4, 4, 3), np.float32)
    placed = place(layer, (10, 10), Transform(x=8, y=8))
    assert placed[9, 9, 3] == pytest.approx(1.0) and placed[7, 7, 3] == pytest.approx(0.0)
    off = place(layer, (10, 10), Transform(x=-2, y=-2))
    assert off[0, 0, 3] == pytest.approx(1.0) and off[2, 2, 3] == pytest.approx(0.0)


def test_scale_and_anchor_keep_the_anchor_point_fixed():
    layer = np.ones((10, 10, 3), np.float32)
    placed = place(layer, (40, 40), Transform(x=20, y=20, scale_x=2.0, anchor=(0.5, 0.5)))
    alpha = placed[..., 3]
    assert alpha[20, 20] == pytest.approx(1.0)
    assert alpha[11, 11] == pytest.approx(1.0) and alpha[8, 8] == pytest.approx(0.0)


def test_rotation_by_ninety_degrees_swaps_extents():
    layer = np.ones((10, 4, 3), np.float32)  # 4 wide, 10 tall
    placed = place(layer, (30, 30), Transform(x=15, y=15, rotation_deg=90.0, anchor=(0.5, 0.5)))
    ys, xs = np.nonzero(placed[..., 3] > 0.5)
    assert xs.max() - xs.min() + 1 == pytest.approx(10, abs=1) and ys.max() - ys.min() + 1 == pytest.approx(4, abs=1)


def test_placement_does_not_leave_dark_fringes_on_soft_edges():
    layer = np.ones((8, 8, 4), np.float32)
    layer[..., 3] = 0.5
    placed = place(layer, (16, 16), Transform(x=4.5, y=4.5))
    inside = placed[..., 3] > 0.01
    assert np.allclose(placed[..., :3][inside], 1.0, atol=1e-3)


def test_adjustment_layer_changes_everything_beneath_it():
    stack = LayerStack(
        [
            Layer("base", np.full((4, 4, 3), 0.25, np.float32)),
            Layer("invert", adjustment=[OpCall("invert")]),
        ]
    )
    assert np.allclose(render(stack, 4, 4), 0.75)


def test_adjustment_layer_respects_opacity_and_mask():
    mask = np.zeros((4, 4), np.float32)
    mask[:, 2:] = 1.0
    stack = LayerStack([Layer("base", np.zeros((4, 4, 3), np.float32)), Layer("adj", adjustment=[OpCall("invert")], opacity=0.5, mask=mask)])
    out = render(stack, 4, 4)
    assert np.allclose(out[:, :2], 0.0) and np.allclose(out[:, 2:], 0.5)


def test_render_is_reproducible_for_a_seed_and_differs_across_seeds():
    def build():
        return LayerStack([Layer("photo", np.full((32, 32, 3), 0.5, np.float32), effects=[OpCall("grain", {"amount": 0.8})])])

    a, b, c = render(build(), 32, 32, seed=4), render(build(), 32, 32, seed=4), render(build(), 32, 32, seed=5)
    assert np.array_equal(a, b)
    assert not np.array_equal(a, c)


def test_each_layer_gets_its_own_noise_from_one_seed():
    img = np.full((32, 32, 3), 0.5, np.float32)
    stack = LayerStack([Layer("a", img, effects=[OpCall("noise", {"amount": 0.5})]), Layer("b", img.copy(), effects=[OpCall("noise", {"amount": 0.5})], blend="difference")])
    # Identical layers with identical effects would cancel to black if they shared noise.
    assert render(stack, 32, 32, seed=1).max() > 0.01


def test_transparent_background_returns_rgba():
    stack = LayerStack([Layer("dot", np.ones((2, 2, 3), np.float32), transform=Transform(x=1, y=1))])
    out = render(stack, 4, 4, background=None)
    assert out.shape == (4, 4, 4)
    assert out[0, 0, 3] == 0.0 and out[3, 3, 3] == 0.0  # outside the layer: still transparent
    assert out[1, 1, 3] == pytest.approx(1.0) and out[2, 2, 3] == pytest.approx(1.0)


def test_layer_validation():
    with pytest.raises(ValueError):
        Layer("x", np.zeros((1, 1, 3), np.float32), blend="sparkle")
    with pytest.raises(ValueError):
        Layer("x")


def test_bleed_off_edge_pushes_the_requested_fraction_outside():
    t = bleed_off_edge((100, 200), (300, 400), edge="right", overhang=0.25, height_fraction=1.0, align=0.5)
    scaled_width = 100 * (400 / 200)
    assert t.x + scaled_width == pytest.approx(300 + 0.25 * scaled_width)
    left = bleed_off_edge((100, 200), (300, 400), edge="left", overhang=0.25)
    assert left.x == pytest.approx(-0.25 * 200)
    bottom = bleed_off_edge((100, 200), (300, 400), edge="bottom", overhang=0.5, height_fraction=0.5)
    assert bottom.y + 200 * (150 / 100) == pytest.approx(400 + 0.5 * 200 * (150 / 100))
    with pytest.raises(ValueError):
        bleed_off_edge((1, 1), (1, 1), edge="middle")


# ----------------------------------------------------------- stacks, textures


def test_named_stack_runs_like_its_steps():
    register_stack("test_invert_twice", [OpCall("invert"), OpCall("invert")])
    img = np.random.default_rng(0).random((8, 8, 3), dtype=np.float32)
    assert np.allclose(run_stack(img, "test_invert_twice"), img, atol=1e-6)


def test_disabled_steps_are_skipped_and_pinned_seeds_win():
    img = np.full((16, 16, 3), 0.5, np.float32)
    assert np.array_equal(run_stack(img, [OpCall("invert", enabled=False)]), img)
    pinned = [OpCall("noise", {"amount": 0.5}, seed=9)]
    assert np.array_equal(run_stack(img, pinned, seed=1), run_stack(img, pinned, seed=2))


def test_procedural_textures_are_deterministic_and_distinct():
    for name in ("procedural:paper", "procedural:grain", "procedural:scratches", "procedural:fibers"):
        a, b = procedural(name, (48, 48), 3), procedural(name, (48, 48), 3)
        assert np.array_equal(a, b) and a.shape == (48, 48, 3) and 0.0 <= a.min() and a.max() <= 1.0
    assert not np.array_equal(procedural("procedural:paper", (48, 48), 3), procedural("procedural:paper", (48, 48), 4))


def test_supplied_textures_cover_the_canvas_and_reserved_ids_are_protected():
    clear_textures()
    register_texture("my:paper", np.random.default_rng(0).random((20, 40, 3), dtype=np.float32))
    assert resolve_texture("my:paper", (30, 30)).shape == (30, 30, 3)
    with pytest.raises(ValueError):
        register_texture("procedural:paper", np.zeros((2, 2, 3), np.float32))
    with pytest.raises(KeyError):
        resolve_texture("my:missing", (4, 4))
    clear_textures()


def test_fbm_is_normalised_and_seeded():
    a = fbm((32, 32), 8.0, rng(1, "n"))
    assert a.min() == pytest.approx(0.0, abs=1e-6) and a.max() == pytest.approx(1.0, abs=1e-6)
    assert np.array_equal(a, fbm((32, 32), 8.0, rng(1, "n")))

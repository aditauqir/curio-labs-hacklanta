"""Behavioural tests for individual ops: each checks what the op is for."""

from __future__ import annotations

import numpy as np
import pytest

from curio.core.color import luma, parse_hex
from curio.ops import OpError, apply_op
from curio.ops.cutout import UserMaskSegmenter, set_default_segmenter
from curio.tests.fixtures import standin_matte, standin_photo, standin_rgba


def flat(value: float, size: int = 32) -> np.ndarray:
    return np.full((size, size, 3), value, dtype=np.float32)


def ramp(size: int = 64) -> np.ndarray:
    row = np.linspace(0, 1, size, dtype=np.float32)
    return np.repeat(np.repeat(row[None, :, None], size, axis=0), 3, axis=2)


def run(name, img, **params):
    return apply_op(name, img, params, seed=5)


# ---------------------------------------------------------------------- tonal


def test_levels_defaults_are_the_identity():
    img = standin_photo(32)
    assert np.allclose(run("levels", img), img, atol=1e-6)


def test_levels_black_and_white_points_stretch_the_range():
    out = run("levels", ramp(), black=0.25, white=0.75)
    assert out[0, 0, 0] == 0.0 and out[0, -1, 0] == 1.0
    assert out[0, 32, 0] == pytest.approx(0.5, abs=0.03)


def test_levels_gamma_above_one_brightens_midtones():
    assert run("levels", flat(0.5), gamma=2.0)[0, 0, 0] > 0.5


def test_levels_single_channel_leaves_others_alone():
    img = flat(0.5)
    out = run("levels", img, gamma=2.0, channel="r")
    assert out[0, 0, 0] > 0.5 and out[0, 0, 1] == 0.5 and out[0, 0, 2] == 0.5


def test_curves_identity_and_inversion():
    img = standin_photo(32)
    assert np.allclose(run("curves", img), img, atol=2e-3)
    inverted = run("curves", ramp(), points=[0, 1, 1, 0])
    assert inverted[0, 0, 0] == pytest.approx(1.0, abs=1e-3) and inverted[0, -1, 0] == pytest.approx(0.0, abs=1e-3)


def test_curves_is_monotone_for_monotone_points():
    out = run("curves", ramp(), points=[0, 0, 0.3, 0.6, 1, 1])[0, :, 0]
    assert np.all(np.diff(out) >= -1e-5)


def test_brightness_contrast():
    assert np.allclose(run("brightness_contrast", flat(0.3), brightness=0.2), 0.5)
    low = run("brightness_contrast", ramp(), contrast=-0.5)
    high = run("brightness_contrast", ramp(), contrast=0.5)
    assert np.ptp(low) < np.ptp(ramp()) and high[0, 0, 0] == 0.0 and high[0, -1, 0] == 1.0


def test_exposure_stops_double_linear_light():
    from curio.core.color import linear_to_srgb, srgb_to_linear

    expected = linear_to_srgb(srgb_to_linear(np.float32(0.2)) * 2.0)
    assert run("exposure", flat(0.2), stops=1.0)[0, 0, 0] == pytest.approx(float(expected), abs=1e-4)


def test_hue_shift_by_120_rotates_red_to_green():
    red = np.zeros((4, 4, 3), np.float32)
    red[..., 0] = 1.0
    out = run("hue_shift", red, degrees=120.0)
    assert out[0, 0, 1] == pytest.approx(1.0, abs=1e-3) and out[0, 0, 0] < 0.01


def test_saturation_extremes():
    img = standin_photo(32)
    grey = run("saturation", img, amount=-1.0)
    assert np.allclose(grey[..., 0], grey[..., 1], atol=1e-5) and np.allclose(grey[..., 1], grey[..., 2], atol=1e-5)
    assert np.allclose(run("saturation", img, amount=0.0), img, atol=1e-6)
    boosted = run("saturation", img, amount=1.0)
    assert np.ptp(boosted, axis=2).mean() > np.ptp(img, axis=2).mean()


def test_vibrance_lifts_muted_colours_more_than_vivid_ones():
    muted = np.array([[[0.55, 0.5, 0.45]]], np.float32)
    vivid = np.array([[[1.0, 0.1, 0.1]]], np.float32)
    gain_muted = np.ptp(run("vibrance", muted, amount=1.0)) / np.ptp(muted)
    gain_vivid = np.ptp(run("vibrance", vivid, amount=1.0)) / np.ptp(vivid)
    assert gain_muted > gain_vivid


def test_color_balance_tints_the_chosen_tonal_range():
    img = np.concatenate([flat(0.1, 8), flat(0.9, 8)], axis=1)
    out = run("color_balance", img, shadows=[0.0, 0.0, 1.0])
    assert out[0, 0, 2] - 0.1 > out[0, -1, 2] - 0.9


def test_desaturate_methods_and_amount():
    img = standin_photo(32)
    for method in ("luma", "average", "lightness", "red", "green", "blue"):
        out = run("desaturate", img, method=method)
        assert np.allclose(out[..., 0], out[..., 1], atol=1e-5), method
    assert np.allclose(run("desaturate", img, amount=0.0), img, atol=1e-6)
    assert np.allclose(run("desaturate", img, method="luma")[..., 0], luma(img), atol=1e-5)


def test_threshold_is_strictly_two_colour():
    out = run("threshold", standin_photo(48), cutoff=0.5)
    assert np.unique(out.reshape(-1, 3), axis=0).shape[0] == 2
    custom = run("threshold", ramp(), cutoff=0.5, dark="#112233", light="#FFEEDD")
    assert np.allclose(custom[0, 0], parse_hex("#112233"), atol=1e-5) and np.allclose(custom[0, -1], parse_hex("#FFEEDD"), atol=1e-5)
    assert np.array_equal(run("threshold", ramp(), invert=True)[0, 0], np.ones(3, np.float32))


def test_threshold_softness_creates_intermediate_tones():
    assert len(np.unique(run("threshold", ramp(), softness=0.2)[..., 0])) > 2


def test_posterize_limits_distinct_levels():
    out = run("posterize", ramp(), levels=4)
    assert len(np.unique(out[..., 0])) == 4
    assert np.allclose(np.unique(out[..., 0]), [0.0, 1 / 3, 2 / 3, 1.0], atol=1e-6)


def test_gradient_map_maps_shadows_and_highlights_to_the_end_colours():
    out = run("gradient_map", ramp(), stops=["#FF0000", "#0000FF"])
    assert np.allclose(out[0, 0], [1, 0, 0], atol=1e-3) and np.allclose(out[0, -1], [0, 0, 1], atol=1e-3)


def test_gradient_map_honours_stop_positions():
    out = run("gradient_map", ramp(), stops=["#000000", "#FF0000", "#FFFFFF"], positions=[0.0, 0.2, 1.0])
    assert out[0, int(0.2 * 63), 0] == pytest.approx(1.0, abs=0.06) and out[0, int(0.2 * 63), 1] < 0.1


def test_gradient_map_strength_blends_with_the_original():
    img = standin_photo(32)
    assert np.allclose(run("gradient_map", img, stops=["#FF0000", "#0000FF"], strength=0.0), img, atol=1e-6)


def test_duotone_uses_only_the_two_colours_and_everything_between():
    out = run("duotone", standin_photo(48), shadow="#102030", highlight="#F0E0D0")
    lo, hi = np.array(parse_hex("#102030")), np.array(parse_hex("#F0E0D0"))
    t = (out - lo) / (hi - lo)
    assert np.allclose(t[..., 0], t[..., 1], atol=1e-3) and np.allclose(t[..., 1], t[..., 2], atol=1e-3)
    assert t.min() >= -1e-3 and t.max() <= 1 + 1e-3


def test_duotone_midpoint_shifts_where_the_mid_tone_lands():
    dark_mid = run("duotone", flat(0.5), midpoint=0.8)
    light_mid = run("duotone", flat(0.5), midpoint=0.2)
    assert luma(light_mid)[0, 0] > luma(dark_mid)[0, 0]


def test_tritone_hits_all_three_colours():
    out = run("tritone", ramp(), shadow="#000000", midtone="#FF0000", highlight="#FFFFFF", mid_position=0.5)
    assert np.allclose(out[0, 0], 0, atol=1e-3) and np.allclose(out[0, -1], 1, atol=1e-3)
    assert out[0, 32, 0] > 0.9 and out[0, 32, 1] < 0.1


def test_channel_mixer_identity_swap_and_monochrome():
    img = standin_photo(32)
    assert np.allclose(run("channel_mixer", img), img, atol=1e-6)
    swapped = run("channel_mixer", img, matrix=[0, 0, 1, 0, 1, 0, 1, 0, 0])
    assert np.allclose(swapped[..., 0], img[..., 2], atol=1e-6) and np.allclose(swapped[..., 2], img[..., 0], atol=1e-6)
    mono = run("channel_mixer", img, matrix=[0.3, 0.6, 0.1, 0, 0, 0, 0, 0, 0], monochrome=True)
    assert np.allclose(mono[..., 0], mono[..., 2])


def test_invert_twice_is_the_identity_and_single_channel_inverts_one():
    img = standin_photo(32)
    assert np.allclose(run("invert", run("invert", img)), img, atol=1e-6)
    out = run("invert", img, channel="g")
    assert np.allclose(out[..., 1], 1 - img[..., 1]) and np.allclose(out[..., 0], img[..., 0])


# ------------------------------------------------------------------ screening


def test_halftone_reproduces_the_tone_of_flat_greys():
    for tone in (0.2, 0.5, 0.8):
        out = run("halftone_screen", flat(tone, 96), pitch_px=8.0, dot_gain=0.0)
        assert luma(out).mean() == pytest.approx(tone, abs=0.06), tone


def test_halftone_without_antialias_is_strictly_two_colour():
    out = run("halftone_screen", standin_photo(64), antialias=False, ink="#102030", paper="#F0E0D0")
    assert np.unique(out.reshape(-1, 3), axis=0).shape[0] == 2


def test_halftone_dot_gain_darkens_midtones():
    base = luma(run("halftone_screen", flat(0.5, 96), dot_gain=0.0)).mean()
    gained = luma(run("halftone_screen", flat(0.5, 96), dot_gain=0.3)).mean()
    assert gained < base - 0.05


def test_halftone_pitch_and_angle_set_the_screen_geometry():
    def spectrum_peak(img):
        plane = luma(img) - luma(img).mean()
        mag = np.abs(np.fft.fftshift(np.fft.fft2(plane)))
        c = mag.shape[0] // 2
        mag[c - 2 : c + 3, c - 2 : c + 3] = 0
        iy, ix = np.unravel_index(np.argmax(mag), mag.shape)
        return ix - c, iy - c, mag.shape[0]

    n = 128
    for pitch in (8.0, 16.0):
        fx, fy, size = spectrum_peak(run("halftone_screen", flat(0.5, n), pitch_px=pitch, angle_deg=0.0))
        assert max(abs(fx), abs(fy)) == pytest.approx(size / pitch, abs=1.0), pitch
    fx, fy, _ = spectrum_peak(run("halftone_screen", flat(0.5, n), pitch_px=16.0, angle_deg=45.0))
    assert abs(abs(fx) - abs(fy)) <= 1  # a 45 degree screen puts its energy on the diagonal


def test_halftone_shapes_differ_and_line_screen_has_one_axis_of_variation():
    img = flat(0.5, 64)
    outs = {s: run("halftone_screen", img, shape=s, antialias=False, angle_deg=0.0) for s in ("round", "square", "ellipse", "line")}
    assert len({o.tobytes() for o in outs.values()}) == 4
    line = luma(outs["line"])
    assert np.allclose(line, line[:, :1], atol=1e-6)  # constant along the line direction


def test_halftone_cmyk_uses_process_inks_and_gives_colour():
    out = run("halftone_screen", standin_photo(96), mode="cmyk", pitch_px=6.0)
    assert np.ptp(out, axis=2).mean() > 0.1
    neutral = run("halftone_screen", flat(0.5, 64), mode="cmyk", pitch_px=6.0)
    assert np.ptp(neutral.mean(axis=(0, 1))) < 0.05  # greys stay neutral


def test_ordered_dither_is_binary_and_tracks_tone():
    out = run("ordered_dither", flat(0.5, 64))
    assert set(np.unique(out)) <= {0.0, 1.0} and out.mean() == pytest.approx(0.5, abs=0.05)
    assert run("ordered_dither", flat(0.25, 64)).mean() < run("ordered_dither", flat(0.75, 64)).mean()


def test_ordered_dither_levels_and_color_mode():
    out = run("ordered_dither", standin_photo(48), mode="color", levels=3)
    assert set(np.round(np.unique(out), 3)) <= {0.0, 0.5, 1.0}


def test_stochastic_dither_amount_zero_is_a_hard_threshold():
    img = ramp()
    hard = run("stochastic_dither", img, amount=0.0)
    assert np.array_equal(hard[..., 0], (luma(img) > 0.5).astype(np.float32))
    assert run("stochastic_dither", flat(0.5, 64), amount=1.0).mean() == pytest.approx(0.5, abs=0.08)


def test_bitmap_threshold_methods():
    img = standin_photo(64)
    for method in ("global", "adaptive"):
        out = run("bitmap_threshold", img, method=method)
        assert np.unique(out.reshape(-1, 3), axis=0).shape[0] == 2, method
    # Dark lines across a brightness gradient: a global cutoff loses the lines
    # at the bright end, a locally adaptive one keeps them everywhere.
    shaded = ramp() * 0.3 + 0.5
    shaded[:, 4::8] -= 0.15
    glob = luma(run("bitmap_threshold", shaded, method="global", cutoff=0.5))
    adaptive = luma(run("bitmap_threshold", shaded, method="adaptive", block_size=15, offset=0.02))
    assert glob[:, 52:].min() == glob[:, 52:].max()  # bright end: lines lost
    assert adaptive[:, 52:].min() < adaptive[:, 52:].max() and adaptive[:, :12].min() < adaptive[:, :12].max()


def test_sharpen_and_unsharp_increase_edge_contrast_and_leave_flats_alone():
    step = np.zeros((32, 32, 3), np.float32)
    step[:, 16:] = 0.6
    base = np.abs(np.diff(step[0, :, 0])).max()
    for name, params in (("sharpen", {"amount": 1.5}), ("unsharp_mask", {"amount": 2.0, "radius": 2.0})):
        out = run(name, step, **params)
        assert out[0, 17, 0] >= 0.6 and out[0, 14, 0] <= 0.0 + 1e-6 or out[0, 17, 0] > 0.6 - 1e-6, name
        assert np.allclose(run(name, flat(0.4), **params), 0.4, atol=1e-5), name
    assert np.abs(np.diff(run("unsharp_mask", step, amount=2.0, radius=2.0)[0, :, 0])).max() >= base


def test_unsharp_threshold_ignores_small_differences():
    noisy = flat(0.5) + np.random.default_rng(0).normal(0, 0.01, (32, 32, 3)).astype(np.float32)
    assert np.allclose(run("unsharp_mask", noisy, amount=3.0, threshold=0.2), noisy, atol=1e-6)


def test_blur_preserves_mean_and_softens():
    img = standin_photo(48)
    for params in ({"kind": "gaussian", "radius": 3.0}, {"kind": "motion", "radius": 5.0, "angle_deg": 30.0}):
        out = run("blur", img, **params)
        assert out.mean() == pytest.approx(img.mean(), abs=0.01)
        assert out.std() < img.std()
    assert np.array_equal(run("blur", img, radius=0.0), img)


def test_motion_blur_only_smears_along_its_angle():
    stripes = np.zeros((32, 32, 3), np.float32)
    stripes[:, ::2] = 1.0  # vertical stripes
    horizontal = run("blur", stripes, kind="motion", radius=4.0, angle_deg=0.0)
    vertical = run("blur", stripes, kind="motion", radius=4.0, angle_deg=90.0)
    assert horizontal.std() < 0.1 and vertical.std() > 0.4


def test_edge_detect_finds_a_step_and_ignores_flats():
    step = np.zeros((32, 32, 3), np.float32)
    step[:, 16:] = 1.0
    for method in ("sobel", "laplacian", "canny"):
        edges = run("edge_detect", step, method=method)
        assert edges[:, 14:18].max() > 0.3 and edges[:, :10].max() < 0.01 and edges[:, 22:].max() < 0.01, method
    assert run("edge_detect", flat(0.5)).max() < 1e-6
    assert run("edge_detect", step, invert=True)[0, 0, 0] == pytest.approx(1.0)


def test_edge_detect_overlay_draws_dark_lines_on_the_image():
    step = np.zeros((16, 16, 3), np.float32) + 0.8
    step[:, 8:] = 0.2
    out = run("edge_detect", step, output="overlay", strength=4.0)
    assert out.min() < 0.1 and out[0, 2, 0] == pytest.approx(0.8)


# -------------------------------------------------------------------- texture


def test_grain_keeps_the_mean_and_adds_variation():
    out = run("grain", flat(0.5, 96), amount=0.8)
    assert out.mean() == pytest.approx(0.5, abs=0.02) and out.std() > 0.02


def test_grain_amount_zero_changes_nothing_and_more_amount_means_more_grain():
    img = standin_photo(48)
    assert np.allclose(run("grain", img, amount=0.0), img, atol=1e-6)
    assert run("grain", flat(0.5, 64), amount=0.9).std() > run("grain", flat(0.5, 64), amount=0.3).std()


def test_grain_size_controls_grain_scale_and_chroma_adds_colour_noise():
    def correlation_length(img):
        plane = img[..., 0] - img[..., 0].mean()
        return float((plane[:, :-1] * plane[:, 1:]).mean() / plane.var())

    fine, coarse = run("grain", flat(0.5, 96), amount=0.8, size=1.0), run("grain", flat(0.5, 96), amount=0.8, size=5.0)
    assert correlation_length(coarse) > correlation_length(fine)
    mono, chroma = run("grain", flat(0.5, 64), amount=0.8, mode="mono"), run("grain", flat(0.5, 64), amount=0.8, mode="chroma")
    assert np.ptp(mono, axis=2).max() < 1e-5 and np.ptp(chroma, axis=2).max() > 0.05


def test_grain_midtone_bias_concentrates_grain_in_the_midtones():
    bright = run("grain", flat(0.95, 64), amount=1.0, midtone_bias=1.0, blend="linear_dodge")
    assert np.allclose(bright, 0.95, atol=0.02)


def test_noise_is_additive_and_zero_mean():
    out = run("noise", flat(0.5, 96), amount=0.4)
    assert out.mean() == pytest.approx(0.5, abs=0.02) and out.std() > 0.05
    assert np.allclose(run("noise", flat(0.5), amount=0.0), 0.5)


def test_paper_texture_darkens_slightly_and_is_not_flat():
    out = run("paper_texture", flat(1.0, 64), amount=1.0)
    assert out.mean() < 1.0 and out.std() > 0.002 and out.min() > 0.7
    assert np.allclose(run("paper_texture", flat(1.0), amount=0.0), 1.0)


def test_scan_lines_period_and_opacity():
    out = run("scan_lines", flat(1.0, 64), spacing_px=8.0, thickness=0.5, opacity=1.0, angle_deg=0.0)
    column = luma(out)[:, 0]
    assert column.min() < 0.1 and column.max() > 0.9
    zero_crossings = np.nonzero(np.diff((column < 0.5).astype(int)) == 1)[0]
    assert np.all(np.diff(zero_crossings) == 8)
    assert np.allclose(run("scan_lines", flat(0.7), opacity=0.0), 0.7)


def test_misregistration_shifts_channels_independently():
    img = np.zeros((16, 16, 3), np.float32)
    img[:, 8, :] = 1.0
    out = run("misregistration", img, red=[2.0, 0.0], green=[0.0, 0.0], blue=[-2.0, 0.0])
    assert np.argmax(out[0, :, 0]) == 10 and np.argmax(out[0, :, 1]) == 8 and np.argmax(out[0, :, 2]) == 6


def test_ink_bleed_only_ever_adds_ink_and_leaves_light_areas_alone():
    img = standin_photo(64)
    out = run("ink_bleed", img, spread_px=3.0)
    assert np.all(luma(out) <= luma(img) + 1e-5)
    assert np.array_equal(run("ink_bleed", flat(1.0), spread_px=3.0), flat(1.0))
    assert np.array_equal(run("ink_bleed", img, spread_px=0.0), img)


def test_ink_bleed_swells_a_dark_shape_outward():
    img = np.ones((64, 64, 3), np.float32)
    img[24:40, 24:40] = 0.0
    out = run("ink_bleed", img, spread_px=3.0, roughness=0.0)
    assert (luma(out) < 0.5).sum() > (luma(img) < 0.5).sum()


def test_distress_reveals_the_paper_colour_in_proportion_to_amount():
    img = flat(0.1, 96)
    paper = np.array(parse_hex("#F2EBDD"), np.float32)
    worn = lambda amount: np.all(np.isclose(run("distress", img, amount=amount), paper, atol=1e-5), axis=2).mean()
    assert worn(0.0) == 0.0 and worn(0.2) < worn(0.8)


def test_halation_only_brightens_and_glows_around_highlights():
    img = np.zeros((64, 64, 3), np.float32)
    img[28:36, 28:36] = 1.0
    out = run("halation", img, radius_px=6.0, strength=1.0, tint="#FF0000")
    assert np.all(out >= img - 1e-6)
    assert out[24, 32, 0] > 0.1 and out[24, 32, 2] < 1e-4  # tinted red glow just outside the highlight
    assert out[24, 32, 0] > out[8, 32, 0]  # and it fades with distance
    assert np.allclose(run("halation", flat(0.2), threshold=0.9), flat(0.2), atol=1e-6)


def test_vignette_darkens_corners_not_the_centre():
    out = run("vignette", flat(1.0, 65), amount=0.8, radius=0.4, softness=0.5)
    assert out[32, 32, 0] == pytest.approx(1.0) and out[0, 0, 0] < 0.3
    tinted = run("vignette", flat(1.0, 65), amount=1.0, color="#FF0000", radius=0.2, softness=0.2)
    assert tinted[0, 0, 1] < 0.05 and tinted[0, 0, 0] > 0.95


def test_overlay_texture_modes_and_opacity():
    base = flat(0.5, 48)
    assert np.allclose(run("overlay_texture", base, opacity=0.0), base)
    multiplied = run("overlay_texture", flat(1.0, 48), texture="procedural:paper", blend="multiply", opacity=1.0)
    assert multiplied.mean() < 1.0
    inverted = run("overlay_texture", flat(1.0, 48), texture="procedural:paper", blend="multiply", opacity=1.0, invert=True)
    assert inverted.mean() < multiplied.mean()


def test_overlay_texture_accepts_an_image_array_and_rejects_unknown_ids():
    tex = np.zeros((8, 8, 3), np.float32)
    assert np.allclose(run("overlay_texture", flat(1.0), texture=tex, blend="multiply", opacity=1.0), 0.0)
    with pytest.raises(KeyError):
        run("overlay_texture", flat(1.0), texture="nothing:here")


# ------------------------------------------------------------------- geometry


def test_crop_rect_takes_the_requested_fractions():
    img = standin_photo(100)
    out = run("crop", img, mode="rect", x=0.25, y=0.5, width=0.5, height=0.25)
    assert out.shape[:2] == (25, 50) and np.array_equal(out, img[50:75, 25:75])


def test_crop_focus_centres_the_subject_and_matches_the_aspect():
    img = np.zeros((100, 200, 3), np.float32)
    out = run("crop", img, mode="focus", aspect=1.0, focus_x=0.8, focus_y=0.5, zoom=2.0)
    assert out.shape[1] == pytest.approx(out.shape[0], abs=1) and out.shape[0] == 50
    marked = np.zeros((100, 200, 3), np.float32)
    marked[45:55, 155:165] = 1.0
    cropped = run("crop", marked, mode="focus", aspect=1.0, focus_x=0.8, focus_y=0.5, zoom=2.0)
    ys, xs = np.nonzero(cropped[..., 0])
    assert abs(xs.mean() - cropped.shape[1] / 2) <= 3 and abs(ys.mean() - cropped.shape[0] / 2) <= 3


def test_crop_thirds_puts_the_subject_on_a_thirds_line():
    marked = np.zeros((300, 300, 3), np.float32)
    marked[145:155, 95:105] = 1.0  # subject left of centre
    out = run("crop", marked, mode="thirds", aspect=1.0, focus_x=100 / 300, focus_y=0.5, zoom=1.5)
    ys, xs = np.nonzero(out[..., 0])
    assert xs.mean() / out.shape[1] == pytest.approx(1 / 3, abs=0.04)


def test_crop_never_leaves_the_image():
    out = run("crop", standin_photo(64), mode="focus", aspect=0.5, focus_x=1.0, focus_y=1.0, zoom=1.0)
    assert out.shape[0] <= 64 and out.shape[1] <= 64


def test_resize_modes():
    img = standin_photo(40)
    assert run("resize", img, scale=2.0).shape[:2] == (80, 80)
    assert run("resize", img, width=20).shape[:2] == (20, 20)
    wide = np.zeros((20, 40, 3), np.float32)
    assert run("resize", wide, height=10).shape[:2] == (10, 20)
    assert run("resize", wide, width=30, height=30, fit="stretch").shape[:2] == (30, 30)
    assert run("resize", wide, width=30, height=30, fit="cover").shape[:2] == (30, 30)
    contained = run("resize", flat(0.2, 20)[:, :10], width=30, height=30, fit="contain", fill="#FF0000")
    assert contained.shape[:2] == (30, 30) and np.allclose(contained[0, 0], [1, 0, 0]) and contained[15, 15, 0] == pytest.approx(0.2, abs=1e-3)


def test_resize_with_alpha_does_not_create_dark_fringes():
    rgba = np.ones((8, 8, 4), np.float32)
    rgba[:, 4:, 3] = 0.0
    out = run("resize", rgba, scale=4.0, resample="cubic")
    visible = out[..., 3] > 0.05
    assert np.allclose(out[..., :3][visible], 1.0, atol=0.02)


def test_rotate_expands_the_canvas_and_ninety_degrees_is_a_transpose():
    img = standin_photo(40)[:, :20]
    out = run("rotate", img, angle_deg=90.0)
    assert out.shape[:2] == (20, 40)
    assert run("rotate", img, angle_deg=45.0, expand=False).shape == img.shape
    assert run("rotate", img, angle_deg=45.0).shape[0] > 40
    assert np.array_equal(run("rotate", img, angle_deg=0.0), img)


def test_rotate_fills_with_colour_for_rgb_and_transparency_for_rgba():
    assert np.allclose(run("rotate", flat(0.2), angle_deg=45.0, fill="#FF0000")[0, 0], [1, 0, 0], atol=1e-3)
    rgba = run("rotate", np.ones((16, 16, 4), np.float32), angle_deg=45.0)
    assert rgba[0, 0, 3] == pytest.approx(0.0, abs=1e-3) and rgba[rgba.shape[0] // 2, rgba.shape[1] // 2, 3] == pytest.approx(1.0)


def test_flip_axes():
    img = standin_photo(32)
    assert np.array_equal(run("flip", img, horizontal=True), img[:, ::-1])
    assert np.array_equal(run("flip", img, vertical=True), img[::-1])
    assert np.array_equal(run("flip", img, horizontal=True, vertical=True), img[::-1, ::-1])
    assert np.array_equal(run("flip", img), img)


def test_perspective_identity_and_corner_motion():
    img = standin_photo(48)
    assert np.allclose(run("perspective", img), img, atol=2e-2)
    skewed = run("perspective", flat(0.2, 48), corners=[0.2, 0, -0.2, 0, 0, 0, 0, 0], fill="#FFFFFF")
    assert skewed[0, 0, 0] > 0.9 and skewed[40, 24, 0] == pytest.approx(0.2, abs=0.02)


# ---------------------------------------------------------------------- masks


def test_mask_luminance_keeps_the_chosen_range():
    out = run("mask", ramp(), kind="luminance", low=0.0, high=0.5)
    assert out.shape[2] == 4 and out[0, 2, 3] == pytest.approx(1.0) and out[0, -2, 3] == pytest.approx(0.0)
    assert np.array_equal(run("mask", ramp(), kind="luminance", low=0.0, high=0.5, invert=True)[..., 3], 1.0 - out[..., 3])


def test_mask_colour_key_removes_the_keyed_colour():
    img = flat(0.5)
    img[:, :16] = (0, 1, 0)
    out = run("mask", img, kind="color_key", key="#00FF00", tolerance=20.0)
    assert out[0, 0, 3] == pytest.approx(0.0, abs=1e-3) and out[0, -1, 3] == pytest.approx(1.0, abs=1e-3)


def test_mask_shapes():
    ell = run("mask", flat(1.0, 40), kind="ellipse", width=0.5, height=0.5)[..., 3]
    assert ell[20, 20] == 1.0 and ell[0, 0] == 0.0 and ell[20, 6] == 0.0
    rect = run("mask", flat(1.0, 40), kind="rect", width=0.5, height=0.25)[..., 3]
    assert rect[20, 20] == 1.0 and rect[5, 20] == 0.0 and rect[20, 5] == 0.0
    grad = run("mask", flat(1.0, 40), kind="linear_gradient", angle_deg=0.0)[..., 3]
    assert grad[20, 0] < 0.2 and grad[20, -1] > 0.8


def test_mask_can_multiply_into_existing_alpha():
    base = standin_rgba(32)
    out = run("mask", base, kind="rect", width=2.0, height=2.0, combine="multiply")
    assert np.allclose(out[..., 3], base[..., 3], atol=1e-6)


def test_feather_softens_a_hard_edge_without_moving_the_interior():
    rgba = np.ones((32, 32, 4), np.float32)
    rgba[:, 16:, 3] = 0.0
    out = run("feather", rgba, radius_px=6.0)
    assert 0.1 < out[16, 16, 3] < 0.9 and out[16, 2, 3] == pytest.approx(1.0, abs=1e-3)
    shrunk = run("feather", rgba, radius_px=0.0, shrink_px=3.0)
    assert shrunk[16, 14, 3] < 1.0


def test_stroke_positions():
    shape = np.zeros((40, 40, 4), np.float32)
    shape[10:30, 10:30] = (0.2, 0.4, 0.6, 1.0)
    outside = run("stroke", shape, width_px=3.0, color="#FF0000", position="outside")
    assert outside[8, 20, 3] == pytest.approx(1.0) and np.allclose(outside[8, 20, :3], [1, 0, 0], atol=1e-3)
    assert np.allclose(outside[20, 20, :3], [0.2, 0.4, 0.6], atol=1e-3)
    assert outside[2, 2, 3] == 0.0
    inside = run("stroke", shape, width_px=3.0, color="#FF0000", position="inside")
    assert inside[11, 20, 0] == pytest.approx(1.0, abs=1e-3) and inside[8, 20, 3] == 0.0
    assert np.array_equal(run("stroke", shape, width_px=0.0), shape)


def test_drop_shadow_goes_behind_the_shape_offset_and_blurred():
    shape = np.zeros((48, 48, 4), np.float32)
    shape[10:24, 10:24] = (1.0, 1.0, 1.0, 1.0)
    out = run("drop_shadow", shape, dx=8.0, dy=8.0, blur_px=0.0, opacity=1.0, color="#000000")
    assert np.allclose(out[15, 15], [1, 1, 1, 1], atol=1e-3)  # the shape itself is untouched
    assert out[28, 28, 3] == pytest.approx(1.0) and out[28, 28, 0] == pytest.approx(0.0, abs=1e-3)  # shadow
    assert out[40, 40, 3] == 0.0
    soft = run("drop_shadow", shape, dx=8.0, dy=8.0, blur_px=10.0, opacity=1.0)
    assert 0.0 < soft[26, 31, 3] < 1.0


# --------------------------------------------------------------------- cutout


def test_cutout_with_a_matte_writes_it_as_alpha():
    img, matte = standin_photo(48), standin_matte(48)
    out = apply_op("cutout", img, {"matte": matte})
    assert np.allclose(out[..., 3], matte) and np.array_equal(out[..., :3], img)


def test_cutout_without_a_segmenter_is_an_explicit_open_item_not_a_guess():
    set_default_segmenter(None)
    with pytest.raises(NotImplementedError, match="OPEN ITEM"):
        apply_op("cutout", standin_photo(16), {})


def test_cutout_uses_a_configured_default_segmenter():
    matte = standin_matte(32)
    set_default_segmenter(UserMaskSegmenter(matte))
    try:
        out = apply_op("cutout", standin_photo(32), {})
        assert np.allclose(out[..., 3], matte)
    finally:
        set_default_segmenter(None)


def test_cutout_rejects_a_matte_of_the_wrong_size():
    with pytest.raises(ValueError):
        apply_op("cutout", standin_photo(32), {"matte": np.ones((8, 8), np.float32)})


def test_unknown_op_still_raises_through_the_stack():
    with pytest.raises(OpError):
        apply_op("no_such_op", standin_photo(8))

"""Golden-image tests with fixed inputs and seeds.

Every registered op gets a golden with default params automatically, so adding
an op without one fails the suite. Extra cases cover non-default behaviour.
Update with ``pytest --update-golden`` and review the PNGs in curio/tests/golden.
"""

from __future__ import annotations

import numpy as np
import pytest

from curio.core.layers import Layer, LayerStack, bleed_off_edge, render
from curio.core.stacks import OpCall
from curio.core.textures import resolve_texture
from curio.ops import apply_op, list_ops
from curio.tests.fixtures import standin_matte, standin_photo, standin_rgba
from curio.tests.golden import check_golden

SEED = 20260101
SIZE = 96

# Ops that need something other than the plain stand-in photo to be meaningful.
NEEDS_SPECIAL_INPUT = {"cutout"}

EXTRA_CASES: dict[str, tuple[str, dict, str]] = {
    # id: (op, params, input kind: "photo" or "rgba")
    "halftone_screen__square_30deg": ("halftone_screen", {"shape": "square", "pitch_px": 6, "angle_deg": 30}, "photo"),
    "halftone_screen__line": ("halftone_screen", {"shape": "line", "pitch_px": 5, "angle_deg": 15}, "photo"),
    "halftone_screen__ellipse_inked": ("halftone_screen", {"shape": "ellipse", "pitch_px": 6, "ink": "#1B1340", "paper": "#FFB36B"}, "photo"),
    "halftone_screen__cmyk": ("halftone_screen", {"mode": "cmyk", "pitch_px": 6}, "photo"),
    "halftone_map__line_inked": ("halftone_map", {"map": "asset:ht_line_p4_h", "ink": "#080806", "paper": "#E0DED6"}, "photo"),
    "duotone__riso": ("duotone", {"shadow": "#2B2B6B", "highlight": "#FF6B4A", "contrast": 0.3}, "photo"),
    "gradient_map__three_stops": ("gradient_map", {"stops": ["#101820", "#D8784C", "#F6E7CB"], "positions": [0.0, 0.45, 1.0]}, "photo"),
    "grain__chroma_overlay": ("grain", {"amount": 0.7, "size": 1.6, "mode": "chroma", "blend": "overlay"}, "photo"),
    "ordered_dither__bayer8_colour": ("ordered_dither", {"matrix": "bayer8", "mode": "color", "levels": 3}, "photo"),
    "stochastic_dither__half": ("stochastic_dither", {"amount": 0.6}, "photo"),
    "bitmap_threshold__adaptive": ("bitmap_threshold", {"method": "adaptive", "block_size": 21}, "photo"),
    "blur__motion": ("blur", {"kind": "motion", "radius": 6, "angle_deg": 20}, "photo"),
    "edge_detect__canny_overlay": ("edge_detect", {"method": "canny", "output": "overlay", "strength": 2.0}, "photo"),
    "misregistration__strong": ("misregistration", {"red": [4, 1], "blue": [-4, -1]}, "photo"),
    "ink_bleed__rough": ("ink_bleed", {"spread_px": 2.5, "roughness": 0.8}, "photo"),
    "distress__heavy": ("distress", {"amount": 0.6, "scale_px": 14}, "photo"),
    "overlay_texture__scratches": ("overlay_texture", {"texture": "procedural:scratches", "blend": "overlay", "opacity": 0.8}, "photo"),
    "paper_texture__tinted": ("paper_texture", {"amount": 1.0, "tint": "#F2E4C8"}, "photo"),
    "scan_lines__diagonal": ("scan_lines", {"spacing_px": 5, "angle_deg": 30, "opacity": 0.4}, "photo"),
    "crop__thirds": ("crop", {"mode": "thirds", "aspect": 0.75, "focus_x": 0.4, "focus_y": 0.55, "zoom": 1.4}, "photo"),
    "resize__cover": ("resize", {"width": 64, "height": 96, "fit": "cover"}, "photo"),
    "rotate__30": ("rotate", {"angle_deg": 30, "fill": "#EDE6D8"}, "photo"),
    "perspective__skew": ("perspective", {"corners": [0.1, 0.0, -0.1, 0.05, 0.0, 0.0, 0.0, 0.0], "fill": "#EDE6D8"}, "photo"),
    "mask__ellipse_feathered": ("mask", {"kind": "ellipse", "width": 0.7, "height": 0.7, "feather_px": 8}, "photo"),
    "stroke__outside": ("stroke", {"width_px": 3, "color": "#FF3B30", "position": "outside"}, "rgba"),
    "drop_shadow__offset": ("drop_shadow", {"dx": 5, "dy": 5, "blur_px": 6, "opacity": 0.6}, "rgba"),
    "feather__soft": ("feather", {"radius_px": 8}, "rgba"),
}


def _input(kind: str) -> np.ndarray:
    return standin_rgba(SIZE) if kind == "rgba" else standin_photo(SIZE)


@pytest.mark.parametrize("name", [s.name for s in list_ops() if s.name not in NEEDS_SPECIAL_INPUT])
def test_default_params_golden(name, update_golden):
    check_golden(f"op__{name}__default", apply_op(name, standin_photo(SIZE), {}, seed=SEED), update_golden)


@pytest.mark.parametrize("case_id", sorted(EXTRA_CASES))
def test_extra_golden(case_id, update_golden):
    op, params, kind = EXTRA_CASES[case_id]
    check_golden(f"op__{case_id}", apply_op(op, _input(kind), params, seed=SEED), update_golden)


def test_cutout_golden(update_golden):
    out = apply_op("cutout", standin_photo(SIZE), {"matte": standin_matte(SIZE)}, seed=SEED)
    check_golden("op__cutout__matte", out, update_golden)


def test_every_op_has_a_golden_case():
    """Guards the guarantee above: nothing is silently left out of the golden set."""
    covered = {s.name for s in list_ops() if s.name not in NEEDS_SPECIAL_INPUT} | {"cutout"}
    assert covered == {s.name for s in list_ops()}


def test_effect_stack_golden(update_golden):
    from curio.core.stacks import run_stack

    out = run_stack(
        standin_photo(SIZE),
        [
            OpCall("levels", {"black": 0.08, "white": 0.92}),
            OpCall("duotone", {"shadow": "#1B1340", "highlight": "#FFB36B"}),
            OpCall("grain", {"amount": 0.5, "size": 1.4}),
            OpCall("vignette", {"amount": 0.35}),
        ],
        seed=SEED,
    )
    check_golden("stack__cinematic", out, update_golden)


def test_layer_composition_golden(update_golden):
    """A poster-like composite: paper ground, halftoned subject bleeding off the edge, graded."""
    w, h = 120, 160
    stack = LayerStack()
    stack.add(Layer("ground", np.full((h, w, 3), 0.93, np.float32)))
    stack.add(Layer("paper", resolve_texture("procedural:paper", (w, h), SEED), blend="multiply", opacity=0.8))
    stack.add(
        Layer(
            "subject",
            standin_rgba(SIZE),
            transform=bleed_off_edge((SIZE, SIZE), (w, h), "right", 0.25, 0.8, 0.7),
            effects=[
                OpCall("duotone", {"shadow": "#1B1340", "highlight": "#FFB36B"}),
                OpCall("halftone_screen", {"pitch_px": 4, "ink": "#1B1340", "paper": "#FFB36B"}),
            ],
        )
    )
    stack.add(Layer("grade", adjustment=[OpCall("grain", {"amount": 0.5})], opacity=0.8))
    check_golden("layers__poster_composite", render(stack, w, h, "#EDE6D8", seed=SEED), update_golden)

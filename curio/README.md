# curio: the raster design engine

Deterministic image operations, layers, type and a versioned style library.
**No generative image models.** Every pixel comes from sourced or supplied
assets, real fonts and vector drawing, and every operation is reproducible:
same inputs + same params + same seed = same output.

This is a separate Python package. The Next.js app in the repository root does
not import it. See `OPEN_ITEMS.md` for what is undecided and what was assumed.

## Run it

```bash
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"     # Windows; use .venv/bin/python elsewhere
.venv/Scripts/python -m pytest                       # about 600 tests, a few seconds
.venv/Scripts/python -m pytest --update-golden       # rewrite golden images, then review the PNGs
```

Python 3.12 or newer. Dependencies: NumPy, SciPy, Pillow, OpenCV (headless), fontTools.

## What is built (build steps 1 to 4)

| Package | Contents |
| --- | --- |
| `core/` | Float images and I/O, colour (hex, HSV, CIELAB, CIEDE2000, WCAG contrast), 13 blend modes with Porter-Duff compositing, seeded noise, procedural textures, effect stacks, the layer stack and renderer (transforms, masks, adjustment layers, `bleed_off_edge`) |
| `ops/` | The op registry and **44 ops**: tonal and colour, halftone and dithering, sharpen/blur/edges, grain/paper/distress/ink/halation/vignette/overlays, crop/resize/rotate/flip/perspective, mask/feather/stroke/drop shadow, and a `cutout` stub |
| `typography/` | Font library read from the font files themselves, name matching with the confidence-then-category fallback chain, text rendering (tracking, leading, case, outline, rotation, wrap, align), auto-fit, microtype columns, text on a path, the legibility guard |
| `style_schema/` | Versioned validators for presets and recipes, the directory loader with hot reload, preset resolving and tuning, explicit logged merging, three `fallback_*` test presets |
| `styles/` | Where style JSON files are dropped (empty; the data is produced elsewhere) |

Not built yet (steps 5 to 9): asset acquisition and the rights manifest, the pipeline
runner, the creative director, the critique loop and export, scrapers.

## Conventions

**Images** are `float32` `(H, W, 3|4)` arrays in `[0, 1]`, sRGB-encoded, straight alpha.

**Ops** are `fn(image, params, seed) -> image`. Look one up by name:

```python
from curio.ops import apply_op, list_ops
out = apply_op("halftone_screen", photo, {"shape": "round", "pitch_px": 8}, seed=7)
```

`apply_op` validates params against the op's schema (out-of-range values clamp at
runtime; use `validate_params(..., on_range="error")` to treat them as errors),
preserves alpha, and enforces the contract: finite output, in range, same size
unless the op declares `changes_size`.

**Adding an op** is one new module under `curio/ops/`. It is discovered automatically;
the registry and runner are never edited:

```python
from curio.ops import Float, register_op

@register_op("my_op", category="texture", params=[Float("amount", 0.5, 0.0, 1.0)])
def my_op(img, p, seed):
    """One-line description."""
    return img * (1 - p.amount)
```

The suite then requires it to be deterministic, to leave its input alone, to carry
alpha through (unless it declares otherwise), to match its `stochastic` flag, and to
have a golden image. Mark `stochastic=True` if it uses the seed.

**Seeds.** Pass one seed at the top; steps and layers derive their own with
`derive_seed(seed, ...)`, which is stable across processes (never Python's `hash()`).

**Layers and stacks**

```python
from curio.core.layers import Layer, LayerStack, Transform, render, bleed_off_edge
from curio.core.stacks import OpCall

stack = LayerStack()
stack.add(Layer("ground", paper_rgb))
stack.add(Layer("subject", subject_rgba, transform=bleed_off_edge(...),
                effects=[OpCall("duotone"), OpCall("halftone_screen", {"pitch_px": 5})]))
stack.add(Layer("grade", adjustment=[OpCall("grain", {"amount": 0.4})], opacity=0.8))
poster = render(stack, 1080, 1350, "#EDE6D8", seed=11)
```

**Styles are data.**

```python
from curio.style_schema import StyleLibrary
library = StyleLibrary()            # curio/styles, or $CURIO_STYLES_DIR
report = library.load()             # which files loaded, which were skipped and why
library.refresh()                   # hot reload: re-read only what changed
resolved = library.get_preset("some_preset").resolve({"grain.amount": 0.4})
resolved.log                        # every tuning decision, including rejected ones
```

A bad file is skipped with `file: field.path: message`; the rest still load. Unknown
fields are kept. Defining parameters never leave their ranges. The parameter-path
conventions are assumptions, listed in `OPEN_ITEMS.md`.

**Type.**

```python
from curio.typography import FontLibrary, resolve_font, render_text
fonts = FontLibrary.from_system()   # or from_directories([...]); honours $CURIO_FONT_DIRS
match = resolve_font([{"name": "Impact", "confidence": 0.9}], fonts, category="sans-serif", weight="black")
match.method                        # exact_name | fuzzy | category_default | any_installed
label = render_text("MIDNIGHT", match.face, 150, tracking=-0.02, case="upper")   # RGBA image
```

## Style analysis export

`docs/MODEL_EXPORT_SPEC.md` is the contract for the model that analyses reference
posters and clusters them into families: file layout, units, the recipe and cluster
schemas, measurement guidance, and the engine's op catalog (generated from the
registry, so regenerate it when ops change).

## Tests

- **Contract tests** run against every registered op, so a new op is held to the same rules.
- **Behaviour tests** check what each op is for (halftone pitch and angle by FFT, tone
  reproduction, dither binary-ness, geometry, mask kinds, and so on).
- **Golden images** (`tests/golden/`, 8-bit PNG, small tolerance) for every op at default
  params plus targeted cases, effect stacks, a layered composite, presets and text. A
  missing golden fails the suite. Regenerate with `--update-golden` and review the images.
- Font tests build tiny synthetic TrueType fonts, so they do not depend on installed fonts.

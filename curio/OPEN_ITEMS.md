# Open items and assumptions

Per the build brief: anything ambiguous is left as a clearly marked stub or a
documented assumption here, not invented behaviour. Each assumption below is
confined to one place in the code so it is a local edit to change.

## Open items from the brief (not decided, not built)

| # | Item | State |
| --- | --- | --- |
| 1 | **Subject cutout without generative models.** GrabCut, thresholding on high-contrast photos, user-provided masks, or an allowed non-generative segmentation model. | **Stub.** `curio/ops/cutout.py` defines a `Segmenter` interface, a `UserMaskSegmenter`, and a `cutout` op. With no matte and no configured segmenter it raises `NotImplementedError` naming this item. Nothing guesses. |
| 2 | **Vision-capable LLM in the critique loop**, and which one. | Not built (critique is build step 8). Any use must return parameter-level suggestions only and never touch pixels. |
| 3 | **Target output sizes and DPI** per format. | Not decided. `save_image(..., dpi=)` can embed a DPI; no format table exists. |
| 4 | **Are user uploads the primary input**, or should the system source subjects for most briefs? | Not decided. Affects how much weight the asset layer (step 5) carries. |
| 5 | **Final list of source sites** to enable. | Not decided. Needs a licence review per site. |
| 6 | **Storage and database** for the asset cache and recipe history. | Not decided. |

## Assumptions made (change if wrong)

| # | Assumption | Where it lives |
| --- | --- | --- |
| A1 | `size_rel` is the font size as a **fraction of canvas height**. The style files do not define it. | `curio/typography/text.py` `resolve_size_px()` (one function) |
| A2 | In a preset, `defaults`, `ranges`, `defining_params` and `free_params` address a parameter by the **dotted path `<step_id>.<param>`**. A step id is its `id`, else its op name, else `op_2`, `op_3` for repeats. Paths under `layout_rules` / `type_rules` / `texture_rules` address those sections. Both flat dotted keys and nested objects are accepted. | `curio/style_schema/preset.py` (module docstring), `validate.py` |
| A3 | A **range** is `[min, max]`, `{"min": a, "max": b}` or `{"choices": [...]}`. | `validate.py` `normalise_range()` |
| A4 | **Defining parameters** move only *inside* their range; a request outside it is **rejected** (the default stays), not clamped. A defining parameter with no range cannot move. **Free parameters** are clamped into their range. Both are logged. | `preset.py` `Preset._apply_override()` |
| A5 | A pipeline step is `{"op", "params", "id"?, "optional"?, "seed"?, "enabled"?}`. `essential_ops` / `optional_ops` match a step id or an op name; everything is essential unless marked optional; `essential_ops` wins. | `preset.py` `Preset.is_essential()` |
| A6 | In a **preset**, an unknown op or an out-of-range or mistyped param is an **error** (it could not run), so the file is skipped. In a **recipe** (training output), an unknown op is only a **warning** and the recipe is kept as data. | `validate.py` |
| A7 | A **missing `schema_version`** is treated as `1.0` with a warning rather than skipping the file, so training output that omits it is not lost. | `schema.py` `check_version()` |
| A8 | A recipe needs a non-empty `poster_id`, and every palette entry needs a valid `#RRGGBB` `hex`. The blank template in the brief is therefore reported and skipped, which is correct for a template. | `validate.py` `validate_recipe()` |
| A9 | A merge keeps the **primary** preset's pipeline, rules and defining parameters, interpolates only free numeric defaults present in both, and adopts secondary steps only when named. | `preset.py` `merge_presets()` |
| A10 | Pixels are **float32 sRGB in [0, 1]**, straight alpha. Blend modes and tonal ops work in the encoded space, as Photoshop does by default; exposure is the exception and works in linear light. | `curio/core/image.py`, `ops/tonal.py` |
| A11 | Text is laid out with Pillow's **BASIC** engine, so output does not depend on whether Raqm is installed. The cost: kerning comes from the legacy `kern` table, not GPOS, so some fonts will kern slightly less than in a layout tool. | `curio/typography/library.py` `_load()` |
| A12 | **Weights snap to the nearest hundred**, halves up (650 is 700). Variable fonts honour any weight inside their `wght` axis. | `library.py` `snap_weight()` |

## Known gaps in what exists

- **Not built yet** (build steps 5 to 9): asset registry, fetch layer, cache and rights
  manifest; pipeline runner; creative director; critique loop and export (recipe and
  credits files); scrapers. Presets can be resolved into runnable op calls
  (`Preset.resolve().to_calls()`) and run with `run_stack`, but there is no layout,
  no end-to-end runner, and no export yet.
- **Halftone**: the ellipse screen is stylistic (its tone curve is not corrected for the
  elongated shape), and the CMYK mode uses a naive RGB-to-CMYK split with fixed process
  inks. A press-accurate separation would need ICC profiles.
- **`bitmap_threshold` adaptive** uses OpenCV's Gaussian adaptive threshold; there is no
  Sauvola/Niblack option.
- **Text on a path** draws glyph by glyph and drops those past the end of the path; there
  is no justification to a path length.
- **Licensing logic** for assets is not in this package yet. The TypeScript app has its own
  (`lib/sources/license.ts`). The brief wants it in one auditable module, so when step 5 is
  built, decide whether Python ports that module or calls it, rather than letting two
  copies drift.
- **No integration with the Next.js app.** `curio/` is a separate package with its own
  tests. How the app calls it (CLI, small service, queue) is not decided.

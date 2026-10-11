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
| A12 | **Weights snap to the nearest hundred**, halves up (650 is 700). Variable fonts honour any weight inside their `wght` axis. A bare family name ("Arial") prefers the normal width over Narrow or Condensed faces. | `library.py` `snap_weight()`, `matching.py` `resolve_font()` |
| A13 | The runner puts **global texture layers directly above the ground**, below every region, matching the recipes' `layer_order`. A texture type with no procedural source is skipped and reported. | `curio/render/poster.py` |
| A14 | **Colours by palette role:** text is `text`, else `ink`, else black; the ground is `ground`, else `background`, else `paper`, else white. | `curio/render/poster.py` `palette_color()` |
| A15 | A role's **`size_rel` is the largest size**; type shrinks to fit its box (minimum 9 px at the 1080 reference). Tracklists and credits take the column count (1 to 4) that allows the largest size. Type sits at the top of its box. | `curio/render/poster.py` |
| A16 | With no `aspect` in the request, the runner uses the **first of the template's `aspects_seen`** (sorted), else 4:5. | `curio/render/poster.py` `render_poster()` |
| A17 | A **`cutout` step is skipped with a warning** at render time (no matte, open item 1), rather than failing the whole poster. | `curio/render/poster.py` `treatment_calls()` |
| A18 | **The newest release is the current one.** There is no separate "active release" pointer; rolling back means republishing an older release's content. A folder is published only if it loads with no errors. | `curio/store/database.py` `publish()`, `collect_documents()` |
| A19 | **Asset packs bake global textures into the background** and keep every region as its own element. Text is given both as settings and as the engine's raster. Elements carry no transform beyond position; a layer with scale or rotation in its transform is refused rather than approximated. | `curio/render/pack.py`, `curio/docs/ASSET_PACK_SPEC.md` |

## Known gaps in what exists

- **Not built yet**: asset registry, fetch layer, cache and rights manifest; creative
  director; critique loop; scrapers. The runner (`curio/render/`) renders a compiled
  template end to end and writes a record (values, tuning log, fonts, legibility fixes,
  `assets_used`, warnings), but it is not yet a credits or rights file: licences are
  copied from what the caller and the font files say, not verified.
- **Runner limits**: type is always top-aligned in its box; text on a path is not used by
  layouts; each legibility check re-composites the layers beneath it (cheap, because the
  photo treatment runs once before compositing).
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

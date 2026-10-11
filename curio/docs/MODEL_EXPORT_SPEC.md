# Curio Labs: Style Analysis Export Spec

**Audience:** the model (and the people) that analyse reference posters and cluster
them into style families.
**Purpose:** define exactly what to emit so the Curio design engine can turn a user's
prompt into a finished poster without anyone reading prose.

Spec version: `1.0`. Everything you emit must carry `"schema_version": "1.0"`.

---

## 0. How your output is used

```
 reference posters
        |  analyse (you)
        v
 recipes/<id>.json          one per poster: measured evidence
        |  cluster (you)
        v
 clusters/<family>.json     one per style family: statistics + layout variants
 manifest.json, vocab.json, fonts.json
        |  compile  (Curio code, deterministic, no model)
        v
 preset + layouts + templates  ->  validated  ->  published to the database
        |
        v
 at runtime: a user prompt selects a preset, the engine applies its photo
 treatment, layout and typography to the user's own photo
```

**The engine never reads your markdown.** JSON is the source of truth. Any markdown
report is *generated from* the JSON (section 12) so a number can never disagree
between the two.

The engine has **no image-generation model**. Everything it does is deterministic
image processing (halftone, duotone, grain, blend modes, real fonts, vector
shapes). Describe styles in terms of operations that exist (Appendix A). Where a
style needs something the engine cannot do, say so in `unsupported_by_engine`
instead of approximating it silently.

---

## 1. Rules that are never broken

1. **No image data, ever.** No pixels, thumbnails, base64, or links to images.
2. **No file paths or URLs.** Not local paths, not `file://`, not web URLs. Reference
   posters are identified only by an opaque id (section 3.4).
3. **Measure, do not invent.** Every number is either measured from a poster or
   marked `"source": "assumed"`. Never write tolerances like "±2" yourself. Report
   the observed min and max, and the compiler decides margins.
4. **Every number has a unit** (section 3.1). A bare number is rejected.
5. **Use only names from the engine.** Operation names and parameter names must come
   from Appendix A. A name not in the catalog goes in `unsupported_by_engine`, not in
   `photo_pipeline`.
6. **Closed vocabulary.** Moods, genres and subject types must come from
   `vocab.json`. Propose additions in `vocab_proposals`; do not use unlisted words.
7. **Deterministic.** The same inputs and the same `random_seed` must produce
   byte-identical files. Sort keys and lists in a fixed order. Fixed number formatting
   (max 4 significant decimals).
8. **Do not merge or split families to reach a target count.** Report the clusters
   the data supports, and the quality numbers (section 7).
9. **Keep people out of the published fields.** Names of artists or other people
   must not appear in `style_tags`, `selection`, ids or notes. Style is described by
   look and mood only.
10. **Unknown fields are allowed** (the engine keeps and ignores them), but never
    rename or repurpose a field defined here.

---

## 2. Deliverables and layout

```
export/
  manifest.json
  vocab.json
  fonts.json
  recipes/<poster_id>.json          one per reference poster
  clusters/<cluster_id>.json        one per family
  report/<cluster_id>.md            generated from clusters/<cluster_id>.json
```

File names are `<id>.json` where the id matches the `poster_id` / `cluster_id` inside
the file. Ids use `[a-z0-9_]` only.

---

## 3. Conventions

### 3.1 Units (required on every measured number)

All **lengths** are relative to the canvas, so a style looks the same at any output
size. Never store pixels except in `measurement_context`.

| `unit` | Meaning | Conversion from the reference |
| --- | --- | --- |
| `frac_short_edge` | fraction of `min(width, height)` | `px / min(w, h)` |
| `frac_width` | fraction of canvas width | `px / w` |
| `frac_height` | fraction of canvas height | `px / h` |
| `deg` | degrees, counter-clockwise, range -180..180 | as measured |
| `em` | fraction of the font size (tracking) | as measured |
| `ratio` | width divided by height, or a contrast ratio | as measured |
| `levels_0_255` | 8-bit intensity levels (noise standard deviation) | as measured |
| `unitless_0_1` | a 0..1 quantity such as opacity or area share | as measured |
| `count` | whole number | as measured |
| `hex` | `#RRGGBB`, uppercase | as measured |
| `none` | a categorical value | |

### 3.2 Colours

`#RRGGBB`, uppercase. Report colours as they appear **in the poster**, not as printed
ink would. Give a `role` from: `ink`, `paper`, `highlight`, `shadow`, `accent`,
`ground`, `text`, `background`.

### 3.3 Region geometry

All positions and sizes are fractions of the canvas (`frac_width` for `x`/`w`,
`frac_height` for `y`/`h`), origin top-left.

### 3.4 Ids

- `poster_id`: `r_` plus the first 12 hex characters of the SHA-256 of the reference
  image file. An opaque, stable id that reveals nothing about the file.
- `cluster_id`: lowercase snake case describing the look, for example
  `cinema_newsprint_broadsheet`. No people's names.
- `layout_id`: snake case, unique inside its cluster.

### 3.5 Provenance block (every file)

```json
{
  "generated": {
    "tool": "<your model/tool name>",
    "tool_version": "<version>",
    "date": "2026-10-11",
    "random_seed": 20261011,
    "dataset_hash": "<sha256 of the sorted list of poster_ids>"
  }
}
```

---

## 4. Recipe: one file per poster

Keep the **legacy fields** (the engine already validates them) and add the new ones.
Where a legacy field and a new field overlap, the **new, unit-bearing field is
authoritative**.

### 4.1 Fields

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `schema_version` | yes | `"1.0"` | |
| `poster_id` | yes | string | section 3.4 |
| `generated` | yes | object | section 3.5 |
| `measurement_context` | yes | object | `width_px`, `height_px`, `source_kind` (`digital`/`scan`/`unknown`), `resized` (bool), `jpeg_quality_estimate` (number or null) |
| `style_tags` | yes | string[] | look words only (no people) |
| `canvas` | yes | object | `aspect` as `"4:5"`, `margins` (`top`/`right`/`bottom`/`left`, each `frac_short_edge`) |
| `palette` | yes | object[] | `hex`, `role`, `area_pct` (0..100) |
| `color_scheme` | yes | string | for example `duotone`, `monochrome`, `tinted_duotone` |
| `typography` | yes | object[] | section 4.2 |
| `photo_pipeline` | yes | object[] | ordered; section 4.3 |
| `halftone` | yes | object | section 4.4; use `{}` if none |
| `texture_layers` | yes | object[] | `type`, `blend`, `opacity` (0..1), `params` |
| `layer_order` | yes | string[] | bottom to top |
| `essential_ops` / `optional_ops` | yes | string[] | op names |
| `layout` | yes | object | section 5 |
| `measurements` | yes | object[] | descriptive statistics that are not engine parameters (4.5) |
| `unsupported_by_engine` | yes | string[] | capabilities the style needs that Appendix C says are missing |
| `confidence` | yes | number 0..1 | your overall confidence in this recipe |

### 4.2 `typography[]`

| Field | Type | Notes |
| --- | --- | --- |
| `role` | string | one of the slot roles in Appendix B |
| `category` | string | `sans-serif`, `serif`, `display`, `monospace`, `script` |
| `weight` | string or number | `"black"`, `700`, ... |
| `case` | string | `none`, `upper`, `lower`, `title` |
| `tracking` | number | in `em`; negative allowed |
| `rotation_deg` | number | |
| `size_rel` | number | font size as a **fraction of canvas height** |
| `italic` | bool | |
| `outline` | object | `{"stroke_frac_short_edge": 0.001, "fill": "none"}` for hollow type; omit for solid |
| `align` | string | `left`/`center`/`right` |
| `font_matches` | object[] | `[{"name": "Impact", "confidence": 0.8}]`, best first |

### 4.3 `photo_pipeline[]` (ordered)

```json
{ "step": 1, "op": "duotone",
  "params": { "shadow": "#020602", "highlight": "#90E908" },
  "range": { },
  "confidence": 0.8 }
```

- `op` and every key in `params` must exist in Appendix A.
- Length-like params (`pitch_px`, `radius_px`, `spread_px`, `size`) are stored here
  **already converted**: write the value *in pixels at the engine's reference size of
  1080 px on the short edge*, i.e. `measured_frac * 1080`. State this in
  `measurement_context.engine_reference_short_edge_px: 1080`.
- Put steps you cannot express with a real op into `unsupported_by_engine`.

### 4.4 `halftone`

```json
{ "type": "AM", "shape": "round", "pitch_px": 8.0, "pitch_frac_short_edge": 0.0074,
  "angle_deg": 48, "dot_gain": 0.10, "method": "fft_peak", "confidence": 0.85 }
```

`shape` is one of `round`, `square`, `ellipse`, `line`. Use `{}` when the poster is
continuous-tone.

### 4.5 `measurements[]`

Descriptive numbers that are **not** engine parameters. The compiler calibrates them.

```json
{ "key": "grain.sigma", "value": 10.0, "unit": "levels_0_255",
  "method": "highpass_residual_std_in_flat_region", "region": "upper_photo", "confidence": 0.7 }
```

Always include: `grain.sigma`, `contrast.text_vs_background` (WCAG ratio, per text
role), `tonal.black_point` and `tonal.white_point` (0..1), `tonal.clipped_highlights_pct`.

---

## 5. Layout (shared by recipes and clusters)

A layout is a list of **regions**. In a recipe each number is a single measured value.
In a cluster file each becomes a range object (section 8.2).

```json
{
  "layout": {
    "regions": [
      { "id": "photo_window", "role": "photo", "content": "photo",
        "x": 0.08, "y": 0.18, "w": 0.84, "h": 0.42,
        "aspect_ratio": 1.75, "frame": { "stroke_frac_short_edge": 0.004, "color": "#181512" },
        "bleed": [], "z": 1 }
    ],
    "alignment": "center",
    "grid": { "columns": 12, "gutter_frac_width": 0.02 }
  }
}
```

- `role`: `photo`, `solid`, `type`, `frame`, `rule`, `texture`.
- `content`: for `type` regions, a slot role from Appendix B. For `solid`, a hex colour.
- `bleed`: edges the region runs off, from `top`, `right`, `bottom`, `left`.
- Regions must **tile or deliberately overlap**; list `z` for overlaps.
- Include `negative_space_pct` (share of the canvas with no content).

---

## 6. How to measure (guidance; record the `method` you used)

| Quantity | Suggested method |
| --- | --- |
| Halftone pitch and angle | strongest peak of the 2D FFT of a flat-toned patch; pitch = canvas size / peak frequency |
| Dot gain | ratio of measured ink coverage to nominal tone in mid-tone patches |
| Grain sigma | standard deviation of the high-pass residual in a region of near-constant tone |
| Palette | k-means in CIELAB, report area share per cluster centre |
| Contrast | WCAG ratio between text colour and the median background under the text |
| Layout regions | segment photo, flat colour and text areas; report bounding boxes as fractions |
| Font match | rank candidates by visual similarity; report `confidence` honestly, and prefer `category` correctness over a confident wrong name |

Every measured value carries `method` and `confidence` (0..1). If a quantity is not
present in a poster (no halftone, no grain), omit it. Do not write zero.

---

## 7. Clustering requirements

1. Cluster on **look**, not content: palette behaviour, treatment ops, type grammar,
   texture, layout structure. Ignore the subject, the artist and the text content.
2. Use a seeded algorithm and record the seed and parameters in `generated`.
3. **Stable ids.** If a previous export exists, give each new cluster the id of the
   previous cluster it overlaps most. Never reassign ids by algorithm label order.
4. Report for each cluster: `support` (member count), per-member `weight`
   (0..1, how central it is), `silhouette`, and `outliers`.
5. **Soft membership.** If a poster is close to a second cluster (weight above 0.25),
   list it in that member's `also_near`. The engine uses this to blend presets.
6. **Small clusters are allowed but honest.** With `support` below 3 you cannot know
   the spread, so set `spread: "unknown"` and `source: "assumed"` on any range you
   did not directly measure.
7. **Layout clusters:** within each family, cluster the layouts separately. Each
   layout cluster becomes one reusable layout. A continuous difference (a split at
   48% versus 58%) is **not** a new layout; it is a range on one layout.
8. **What varies:** classify every parameter:
   - `defining`: low spread across members; it makes the family recognisable.
   - `free`: higher spread; safe to vary.
   Do not decide thresholds by eye. State the rule you used in `generated.rules`.

---

## 8. Cluster file: one per family

### 8.1 Fields

| Field | Required | Notes |
| --- | --- | --- |
| `schema_version`, `cluster_id`, `generated` | yes | |
| `title` | yes | human-readable, no people's names |
| `support` | yes | integer member count |
| `members` | yes | `[{poster_id, weight, also_near}]` |
| `quality` | yes | `silhouette`, `outliers`, `notes` |
| `pipeline` | yes | ordered `[{id, op, optional, used_by_fraction}]` |
| `params` | yes | engine-mappable parameters (8.2) |
| `measurements` | yes | descriptive statistics (8.2) |
| `colors` | yes | colour rules (8.3) |
| `layout_clusters` | yes | at least one (8.4) |
| `type_roles` | yes | per role: category, case, tracking range, `size_rel` range, outline, `font_matches` |
| `texture_rules` | yes | `[{type, blend, opacity: Range, probability}]` |
| `selection` | yes | when to use it (8.5) |
| `unsupported_by_engine` | yes | union across members |
| `vocab_proposals` | no | new vocabulary terms with a one-line justification |

### 8.2 `params` and `measurements`

A **Range** object: `{"median": n, "min": n, "max": n, "n": count}`. The `min` and
`max` are the observed extremes. **Do not widen them.**

```json
{
  "params": {
    "halftone_screen.pitch_px": {
      "unit": "frac_short_edge", "median": 0.0102, "min": 0.0091, "max": 0.0128, "n": 3,
      "spread": "low", "role": "defining", "source": "measured", "confidence": 0.8
    },
    "halftone_screen.shape": {
      "unit": "none", "values": { "line": 3 }, "role": "defining", "source": "measured"
    }
  }
}
```

- The key is `<step id>.<engine param name>`, using names from Appendix A. The step id
  is the `id` in `pipeline` (default: the op name).
- `unit` says how the stored numbers are expressed. Lengths here are relative
  (`frac_short_edge`); the compiler converts to pixels at render time.
- `spread` is `low`, `medium`, `high`, or `unknown` (when `n` is 1).
- `source` is `measured` or `assumed`.

`measurements` uses the same shape for things like `grain.sigma`, `tonal.black_point`.

### 8.3 `colors`

```json
{ "role": "paper", "center": "#E8E4DC", "max_delta_e": 6.0, "n": 3, "source": "measured" }
```

`center` is the member median in CIELAB, converted to hex. `max_delta_e` is the largest
**observed** CIEDE2000 distance of any member from the centre. Do not add a margin.

### 8.4 `layout_clusters[]`

```json
{
  "layout_id": "inset_window",
  "members": ["r_aaaaaaaaaaaa", "r_bbbbbbbbbbbb"],
  "alignment": "center",
  "negative_space_pct": { "median": 0.41, "min": 0.37, "max": 0.45, "n": 2 },
  "regions": [
    { "id": "photo_window", "role": "photo", "content": "photo",
      "x": { "median": 0.08, "min": 0.07, "max": 0.09, "n": 2 },
      "y": { "median": 0.18, "min": 0.16, "max": 0.2, "n": 2 },
      "w": { "median": 0.84, "min": 0.82, "max": 0.86, "n": 2 },
      "h": { "median": 0.42, "min": 0.38, "max": 0.45, "n": 2 },
      "aspect_ratio": { "median": 1.75, "min": 1.6, "max": 1.8, "n": 2 },
      "bleed": [], "z": 1 }
  ],
  "aspects_seen": ["4:5", "3:4"]
}
```

### 8.5 `selection`

```json
{
  "selection": {
    "moods": ["archival", "tactile", "journalistic"],
    "genres": ["cinema", "documentary", "indie"],
    "subject_types": ["portrait", "scene"],
    "avoid_when": ["needs neon colour", "needs a flat solid background"],
    "director_notes": "One or two sentences, max 300 characters, on what makes this family work.",
    "example_briefs": ["Poster for a retrospective film screening series.",
                       "Tour broadsheet for an indie documentary."]
  }
}
```

`moods`, `genres` and `subject_types` must come from `vocab.json`. Provide at least two
`example_briefs` and one `avoid_when`.

---

## 9. `vocab.json`

A closed list, so selection is reproducible.

```json
{
  "schema_version": "1.0",
  "moods": ["raw", "rebellious", "high-energy", "stark", "minimal", "cold", "archival",
            "tactile", "journalistic", "playful", "romantic", "gritty", "elegant"],
  "genres": ["hyperpop", "club", "techno", "fashion", "cinema", "documentary", "indie",
             "retrospective", "festival", "theatre"],
  "subject_types": ["portrait", "group", "object", "scene", "typographic"]
}
```

Extend only through `vocab_proposals`.

## 10. `fonts.json`

```json
{
  "schema_version": "1.0",
  "fonts": [
    { "family": "Impact", "category": "display", "license": "proprietary (system font)",
      "commercial_use": "unknown", "free_alternatives": ["Anton", "Oswald"] }
  ]
}
```

For every font named in any `font_matches`, give the licence and, where the font is
not freely licensed, **at least one open-licensed alternative** of the same category.

## 11. `manifest.json`

```json
{
  "schema_version": "1.0",
  "generated": { "tool": "...", "tool_version": "...", "date": "2026-10-11",
                 "random_seed": 20261011, "dataset_hash": "..." },
  "counts": { "recipes": 0, "clusters": 0 },
  "files": [ { "path": "clusters/example.json", "sha256": "..." } ]
}
```

List every file with its SHA-256 so the compiler can detect a partial or edited export.

---

## 12. The markdown report

Generate `report/<cluster_id>.md` **from** `clusters/<cluster_id>.json` with a fixed
template. Hand-written numbers are not allowed. Put this at the top:

```
<!-- generated from clusters/<cluster_id>.json, sha256 <hash>. Do not edit. -->
```

Suggested sections: title and support; members (ids only); parameter table (median,
min, max, role, source, spread); colours; layouts; type roles; selection notes;
unsupported capabilities. If the markdown and the JSON ever disagree, the JSON wins.

---

## 13. Self-check before you hand over

Reject your own export if any of these fail:

- [ ] Every file has `schema_version: "1.0"` and a `generated` block.
- [ ] No pixel data, no paths, no URLs anywhere (search for `/`, `\`, `http`, `data:`).
- [ ] Every number in `params`, `measurements`, `layout` has a `unit` or is a Range.
- [ ] Every `op` and param name appears in Appendix A.
- [ ] `min <= median <= max` for every Range, and `n` equals the number of members that
      had the value.
- [ ] `support` equals `len(members)`; every `poster_id` in a cluster has a recipe file.
- [ ] Every `selection` term is in `vocab.json`.
- [ ] Every region is inside the canvas (`x + w <= 1`, `y + h <= 1`, allowing declared bleed).
- [ ] Re-running with the same inputs and seed gives byte-identical files.
- [ ] `manifest.json` hashes match the files.

The Curio compiler runs these checks plus the engine's own validators. A failing file
is reported by file and field path and is **skipped**; it does not stop the others.

---

## Appendix A: engine operation catalog

Generated from the engine's registry. Parameter ranges are the engine's limits; values
outside them are clamped at render time, so stay inside them. Length parameters are in
pixels at the engine reference size (1080 px on the short edge).

### geometry

- **`crop`** _(changes image size)_: Crops to a rectangle, around a focus point, or with the subject on a thirds line.
  - `mode` one of rect, focus, thirds (default rect); `x` float 0..1 (default 0); `y` float 0..1 (default 0); `width` float 0.01..1 (default 1); `height` float 0.01..1 (default 1); `aspect` float 0.1..10 (default 0.8); `focus_x` float 0..1 (default 0.5); `focus_y` float 0..1 (default 0.5); `zoom` float 1..8 (default 1)
- **`flip`**: Mirrors the image.
  - `horizontal` true/false (default false); `vertical` true/false (default false)
- **`perspective`**: Moves the four corners to skew the image in perspective.
  - `corners` list of 8 numbers -0.5..0.5; `fill` hex colour (default #FFFFFF)
- **`resize`** _(changes image size)_: Resizes by size, aspect-preserving width or height, or a scale factor.
  - `width` int 0..32000 (default 0); `height` int 0..32000 (default 0); `scale` float 0.01..16 (default 1); `fit` one of stretch, cover, contain (default stretch); `resample` one of lanczos, cubic, linear, area, nearest (default lanczos); `fill` hex colour (default #FFFFFF)
- **`rotate`** _(changes image size)_: Rotates about the centre.
  - `angle_deg` float -180..180 (default 0); `expand` true/false (default true); `fill` hex colour (default #FFFFFF)

### masking

- **`cutout`** _(writes transparency)_: Isolates the subject by writing a matte into the alpha channel.
  - `matte` texture id (`procedural:paper|grain|scratches|fibers` or a registered id)
- **`drop_shadow`** _(writes transparency)_: Adds a soft shadow behind the opaque shape, clipped to the canvas.
  - `dx` float -300..300 (default 6); `dy` float -300..300 (default 6); `blur_px` float 0..100 (default 8); `opacity` float 0..1 (default 0.5); `color` hex colour (default #000000)
- **`feather`** _(writes transparency)_: Softens the edge of the alpha channel, optionally shrinking it first.
  - `radius_px` float 0..200 (default 4); `shrink_px` float 0..100 (default 0)
- **`mask`** _(writes transparency)_: Builds an alpha channel from luminance, a colour key, or a shape.
  - `kind` one of luminance, color_key, ellipse, rect, linear_gradient (default luminance); `low` float 0..1 (default 0); `high` float 0..1 (default 0.5); `key` hex colour (default #00FF00); `tolerance` float 0..100 (default 20); `cx` float 0..1 (default 0.5); `cy` float 0..1 (default 0.5); `width` float 0.01..2 (default 0.6); `height` float 0.01..2 (default 0.6); `angle_deg` float -180..180 (default 0); `feather_px` float 0..200 (default 0); `invert` true/false (default false); `combine` one of replace, multiply (default replace)
- **`stroke`** _(writes transparency)_: Outlines the opaque shape. An image with no transparency can only be stroked inside.
  - `width_px` float 0..100 (default 4); `color` hex colour (default #000000); `position` one of outside, inside, center (default outside)

### screening

- **`bitmap_threshold`**: Two-colour bitmap, with a global or locally adaptive cutoff.
  - `method` one of global, adaptive (default global); `cutoff` float 0..1 (default 0.5); `block_size` int 3..301 (default 31); `offset` float -0.5..0.5 (default 0.05); `ink` hex colour (default #000000); `paper` hex colour (default #FFFFFF)
- **`blur`**: Gaussian or motion blur.
  - `kind` one of gaussian, motion (default gaussian); `radius` float 0..100 (default 2); `angle_deg` float -180..180 (default 0)
- **`edge_detect`**: Edge map as white lines on black, or dark lines laid over the image.
  - `method` one of sobel, laplacian, canny (default sobel); `strength` float 0..4 (default 1); `low` float 0..1 (default 0.1); `high` float 0..1 (default 0.3); `output` one of edges, overlay (default edges); `invert` true/false (default false)
- **`halftone_screen`**: AM halftone: a regular screen whose dot size follows tone. Multi-angle in CMYK mode.
  - `shape` one of round, square, ellipse, line (default round); `pitch_px` float 2..200 (default 8); `angle_deg` float -90..90 (default 45); `dot_gain` float 0..0.5 (default 0.1); `mode` one of mono, cmyk (default mono); `ink` hex colour (default #000000); `paper` hex colour (default #FFFFFF); `antialias` true/false (default true)
- **`ordered_dither`**: Bayer-matrix dithering.
  - `matrix` one of bayer2, bayer4, bayer8 (default bayer4); `levels` int 2..16 (default 2); `mode` one of mono, color (default mono); `ink` hex colour (default #000000); `paper` hex colour (default #FFFFFF)
- **`sharpen`**: A 3x3 sharpen kernel scaled by ``amount``.
  - `amount` float 0..3 (default 1)
- **`stochastic_dither`** _(uses a seed)_: Dithering against seeded random thresholds.
  - `amount` float 0..1 (default 1); `levels` int 2..16 (default 2); `mode` one of mono, color (default mono); `ink` hex colour (default #000000); `paper` hex colour (default #FFFFFF)
- **`unsharp_mask`**: Sharpens by adding back the difference from a blurred copy.
  - `amount` float 0..5 (default 1); `radius` float 0.1..50 (default 2); `threshold` float 0..0.5 (default 0)

### texture

- **`distress`** _(uses a seed)_: Erodes the image into worn patches and flecks that reveal the paper.
  - `amount` float 0..1 (default 0.3); `scale_px` float 2..400 (default 24); `speckle` float 0..1 (default 0.3); `paper` hex colour (default #F2EBDD)
- **`grain`** _(uses a seed)_: Film-style grain blended over the image.
  - `amount` float 0..1 (default 0.25); `size` float 0.5..12 (default 1.2); `mode` one of mono, chroma (default mono); `blend` one of soft_light, overlay, multiply, screen, linear_dodge (default soft_light); `midtone_bias` float 0..1 (default 0.5)
- **`halation`**: A tinted glow around bright areas.
  - `radius_px` float 1..200 (default 20); `threshold` float 0..0.99 (default 0.7); `strength` float 0..2 (default 0.6); `tint` hex colour (default #FF6A3D)
- **`ink_bleed`** _(uses a seed)_: Dark areas swell outward with an uneven edge, like ink soaking into paper.
  - `spread_px` float 0..30 (default 2); `roughness` float 0..1 (default 0.5); `amount` float 0..1 (default 1); `ink` hex colour (default #000000)
- **`misregistration`**: Shifts each colour channel, like a print plate out of register.
  - `red` list of 2 numbers -100..100; `green` list of 2 numbers -100..100; `blue` list of 2 numbers -100..100
- **`noise`** _(uses a seed)_: Additive noise.
  - `amount` float 0..1 (default 0.1); `kind` one of gaussian, uniform (default gaussian); `mono` true/false (default true)
- **`overlay_texture`** _(uses a seed)_: Lays a texture over the image with a chosen blend mode.
  - `texture` texture id (`procedural:paper|grain|scratches|fibers` or a registered id); `blend` one of normal, multiply, screen, overlay, soft_light, hard_light, difference, exclusion, color_dodge, color_burn, darken, lighten, linear_dodge (default multiply); `opacity` float 0..1 (default 0.5); `zoom` float 1..8 (default 1); `invert` true/false (default false)
- **`paper_texture`** _(uses a seed)_: Procedural paper tooth, blotches and fibres laid over the image.
  - `amount` float 0..1 (default 0.6); `tint` hex colour (default #FFFFFF); `blend` one of multiply, overlay, soft_light, screen (default multiply)
- **`scan_lines`**: Evenly spaced lines, as on a CRT or a line screen.
  - `spacing_px` float 2..64 (default 4); `thickness` float 0.05..0.95 (default 0.4); `opacity` float 0..1 (default 0.3); `angle_deg` float -90..90 (default 0); `color` hex colour (default #000000)
- **`vignette`**: Darkens (or tints) toward the edges.
  - `amount` float 0..1 (default 0.4); `radius` float 0..1.5 (default 0.7); `softness` float 0.05..1.5 (default 0.5); `color` hex colour (default #000000)

### tonal

- **`brightness_contrast`**: Additive brightness and a contrast slope about mid grey.
  - `brightness` float -1..1 (default 0); `contrast` float -1..0.99 (default 0)
- **`channel_mixer`**: Mixes input channels into each output channel.
  - `matrix` list of 9 numbers -2..2; `monochrome` true/false (default false)
- **`color_balance`**: Tints shadows, midtones and highlights independently.
  - `shadows` list of 3 numbers -1..1; `midtones` list of 3 numbers -1..1; `highlights` list of 3 numbers -1..1
- **`curves`**: A smooth tone curve through control points (monotone cubic).
  - `points` list of 4-32 numbers 0..1; `channel` one of rgb, r, g, b, luma (default rgb)
- **`desaturate`**: Greyscale with a choice of conversion.
  - `method` one of luma, average, lightness, red, green, blue (default luma); `amount` float 0..1 (default 1)
- **`duotone`**: Two-colour tone mapping of luminance.
  - `shadow` hex colour (default #1B1340); `highlight` hex colour (default #FFB36B); `contrast` float -0.9..0.9 (default 0); `midpoint` float 0.05..0.95 (default 0.5)
- **`exposure`**: Exposure in stops, applied in linear light.
  - `stops` float -4..4 (default 0); `offset` float -0.5..0.5 (default 0); `gamma` float 0.1..5 (default 1)
- **`gradient_map`**: Maps luminance through a colour ramp.
  - `stops` list of 2-16 hex colours; `positions` list of 0-16 numbers 0..1; `strength` float 0..1 (default 1)
- **`hue_shift`**: Rotates hue.
  - `degrees` float -180..180 (default 0)
- **`invert`**: Inverts all channels, or one.
  - `channel` one of rgb, r, g, b (default rgb)
- **`levels`**: Input and output levels with a midtone gamma.
  - `black` float 0..0.99 (default 0); `white` float 0.01..1 (default 1); `gamma` float 0.1..5 (default 1); `out_black` float 0..1 (default 0); `out_white` float 0..1 (default 1); `channel` one of rgb, r, g, b (default rgb)
- **`posterize`**: Quantises each channel to a number of levels.
  - `levels` int 2..64 (default 4)
- **`saturation`**: Scales distance from grey.
  - `amount` float -1..3 (default 0)
- **`threshold`**: Reduces the image to two colours at a luminance cutoff.
  - `cutoff` float 0..1 (default 0.5); `softness` float 0..0.5 (default 0); `invert` true/false (default false); `dark` hex colour (default #000000); `light` hex colour (default #FFFFFF)
- **`tritone`**: Three-colour tone mapping of luminance.
  - `shadow` hex colour (default #101820); `midtone` hex colour (default #D8784C); `highlight` hex colour (default #F6E7CB); `mid_position` float 0.1..0.9 (default 0.5)
- **`vibrance`**: Saturation that favours muted colours and protects saturated ones.
  - `amount` float -1..2 (default 0)

## Appendix B: vocabularies

**Slot roles** (for `typography[].role` and `type` region `content`):
`kicker`, `headline`, `subhead`, `body`, `tracklist`, `credits`, `date`, `venue`, `url`,
`logo`, `caption`, `price`.

**Region roles:** `photo`, `solid`, `type`, `frame`, `rule`, `texture`.

**Texture layer `type`** (examples, free text allowed): `paper`, `grain`, `scratches`,
`fibers`, `scan_lines`, `halftone_overlay`.

**Blend modes** (for `texture_layers[].blend` and `overlay_texture.blend`):
`normal`, `multiply`, `screen`, `overlay`, `soft_light`, `hard_light`, `difference`, `exclusion`, `color_dodge`, `color_burn`, `darken`, `lighten`, `linear_dodge`

**Font categories:** `sans-serif`, `serif`, `display`, `monospace`, `script`, `symbol`.

## Appendix C: capabilities the engine does NOT have yet

List these in `unsupported_by_engine` when a style needs them. Do not approximate them
with a different operation.

| Capability | State |
| --- | --- |
| Subject isolation (cutting a person or object out of a photo) | not decided; a stub only |
| Automatic layout from regions | not built yet (this export is its input) |
| Hollow / outline-only text (`fill: none`) | planned; the engine currently always fills text |
| Colour-tolerance ranges (`max_delta_e`) | planned in the compiler |
| Real ink or paper scans as textures | only procedural textures for now |
| Text that follows a freeform path | supported for arcs and polylines only |
| Emboss, foil, spot-UV and other physical finishes | not supported |
| Vector illustration generation | not supported; only primitives (rect, circle, line) |

## Appendix D: worked example (illustrative values, not measurements)

The numbers below are **made up to show the shape**. Do not copy them. Real files
must contain measured values.

### D.1 A recipe

```json
{
  "schema_version": "1.0",
  "poster_id": "r_0123456789ab",
  "generated": { "tool": "example", "tool_version": "0", "date": "2026-10-11", "random_seed": 1, "dataset_hash": "0" },
  "measurement_context": { "width_px": 1080, "height_px": 1350, "source_kind": "digital", "resized": false, "jpeg_quality_estimate": 85, "engine_reference_short_edge_px": 1080 },
  "style_tags": ["archival", "newsprint", "letterpress"],
  "canvas": { "aspect": "4:5", "margins": { "top": 0.05, "right": 0.05, "bottom": 0.05, "left": 0.05 } },
  "palette": [
    { "hex": "#E8E4DC", "role": "paper", "area_pct": 62 },
    { "hex": "#101010", "role": "ink", "area_pct": 38 }
  ],
  "color_scheme": "tinted_duotone",
  "typography": [
    { "role": "headline", "category": "display", "weight": "black", "case": "upper", "tracking": -0.01, "rotation_deg": 0, "size_rel": 0.12, "italic": false, "align": "center",
      "font_matches": [ { "name": "Impact", "confidence": 0.7 }, { "name": "Anton", "confidence": 0.6 } ] },
    { "role": "kicker", "category": "serif", "weight": "regular", "case": "none", "tracking": 0.02, "rotation_deg": 0, "size_rel": 0.025, "italic": true, "align": "center",
      "font_matches": [ { "name": "Playfair Display", "confidence": 0.6 } ] }
  ],
  "photo_pipeline": [
    { "step": 1, "op": "levels", "params": { "black": 0.06, "white": 0.94 }, "range": {}, "confidence": 0.6 },
    { "step": 2, "op": "halftone_screen", "params": { "shape": "line", "pitch_px": 11.0, "angle_deg": 0, "ink": "#101010", "paper": "#E8E4DC" }, "range": {}, "confidence": 0.7 },
    { "step": 3, "op": "grain", "params": { "amount": 0.3 }, "range": {}, "confidence": 0.5 }
  ],
  "halftone": { "type": "line", "shape": "line", "pitch_px": 11.0, "pitch_frac_short_edge": 0.0102, "angle_deg": 0, "dot_gain": 0.1, "method": "fft_peak", "confidence": 0.8 },
  "texture_layers": [ { "type": "paper", "blend": "multiply", "opacity": 0.5, "params": {} } ],
  "layer_order": ["paper", "photo", "type"],
  "essential_ops": ["halftone_screen"],
  "optional_ops": ["grain"],
  "layout": {
    "regions": [
      { "id": "photo_window", "role": "photo", "content": "photo", "x": 0.08, "y": 0.18, "w": 0.84, "h": 0.42, "aspect_ratio": 1.75,
        "frame": { "stroke_frac_short_edge": 0.004, "color": "#101010" }, "bleed": [], "z": 1 },
      { "id": "headline", "role": "type", "content": "headline", "x": 0.06, "y": 0.64, "w": 0.88, "h": 0.14, "bleed": [], "z": 2 }
    ],
    "alignment": "center",
    "negative_space_pct": 0.41
  },
  "measurements": [
    { "key": "grain.sigma", "value": 10.0, "unit": "levels_0_255", "method": "highpass_residual_std_in_flat_region", "region": "photo_window", "confidence": 0.6 }
  ],
  "unsupported_by_engine": [],
  "confidence": 0.7
}
```

### D.2 A cluster (one layout, two members)

```json
{
  "schema_version": "1.0",
  "cluster_id": "example_newsprint_family",
  "generated": { "tool": "example", "tool_version": "0", "date": "2026-10-11", "random_seed": 1, "dataset_hash": "0",
                 "rules": "defining if (max-min)/median < 0.15 across members, else free" },
  "title": "Example newsprint family",
  "support": 2,
  "members": [
    { "poster_id": "r_0123456789ab", "weight": 0.93, "also_near": {} },
    { "poster_id": "r_ba9876543210", "weight": 0.81, "also_near": { "example_split_family": 0.3 } }
  ],
  "quality": { "silhouette": 0.6, "outliers": [], "notes": "support below 3: spreads are not reliable" },
  "pipeline": [
    { "id": "levels", "op": "levels", "optional": false, "used_by_fraction": 1.0 },
    { "id": "halftone_screen", "op": "halftone_screen", "optional": false, "used_by_fraction": 1.0 },
    { "id": "grain", "op": "grain", "optional": true, "used_by_fraction": 1.0 }
  ],
  "params": {
    "halftone_screen.pitch_px": { "unit": "frac_short_edge", "median": 0.0105, "min": 0.0091, "max": 0.0128, "n": 2, "spread": "unknown", "role": "defining", "source": "measured", "confidence": 0.7 },
    "halftone_screen.angle_deg": { "unit": "deg", "median": 0, "min": 0, "max": 90, "n": 2, "spread": "unknown", "role": "defining", "source": "measured", "confidence": 0.7 },
    "halftone_screen.shape": { "unit": "none", "values": { "line": 2 }, "role": "defining", "source": "measured" },
    "grain.amount": { "unit": "unitless_0_1", "median": 0.3, "min": 0.2, "max": 0.4, "n": 2, "spread": "unknown", "role": "free", "source": "assumed", "confidence": 0.4 }
  },
  "measurements": {
    "grain.sigma": { "unit": "levels_0_255", "median": 10, "min": 8, "max": 12, "n": 2, "spread": "unknown", "source": "measured" }
  },
  "colors": [
    { "role": "paper", "center": "#E8E4DC", "max_delta_e": 6.0, "n": 2, "source": "measured" },
    { "role": "ink", "center": "#101010", "max_delta_e": 3.0, "n": 2, "source": "measured" }
  ],
  "layout_clusters": [
    {
      "layout_id": "inset_window",
      "members": ["r_0123456789ab", "r_ba9876543210"],
      "alignment": "center",
      "negative_space_pct": { "median": 0.41, "min": 0.37, "max": 0.45, "n": 2 },
      "regions": [
        { "id": "photo_window", "role": "photo", "content": "photo",
          "x": { "median": 0.08, "min": 0.07, "max": 0.09, "n": 2 },
          "y": { "median": 0.18, "min": 0.16, "max": 0.2, "n": 2 },
          "w": { "median": 0.84, "min": 0.82, "max": 0.86, "n": 2 },
          "h": { "median": 0.42, "min": 0.38, "max": 0.45, "n": 2 },
          "aspect_ratio": { "median": 1.75, "min": 1.6, "max": 1.8, "n": 2 },
          "bleed": [], "z": 1 }
      ],
      "aspects_seen": ["4:5"]
    }
  ],
  "type_roles": [
    { "role": "headline", "category": "display", "case": "upper",
      "tracking": { "median": -0.01, "min": -0.02, "max": 0.0, "n": 2 },
      "size_rel": { "median": 0.12, "min": 0.1, "max": 0.14, "n": 2 },
      "font_matches": [ { "name": "Impact", "confidence": 0.7 }, { "name": "Anton", "confidence": 0.6 } ] }
  ],
  "texture_rules": [ { "type": "paper", "blend": "multiply", "opacity": { "median": 0.5, "min": 0.4, "max": 0.6, "n": 2 }, "probability": 1.0 } ],
  "selection": {
    "moods": ["archival", "tactile"],
    "genres": ["cinema", "documentary"],
    "subject_types": ["portrait"],
    "avoid_when": ["needs a flat neon background"],
    "director_notes": "Warm paper, one dark ink, line-screen photo in a framed window. Works for cinema and print-ephemera briefs.",
    "example_briefs": ["Poster for a retrospective film screening series.", "Tour broadsheet for an indie documentary."]
  },
  "unsupported_by_engine": []
}
```

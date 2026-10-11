# curio/assets: the supplied texture and halftone library

Original procedural output (seeded, deterministic), released as **CC0-1.0**. No
third-party images, no real photos, no generative model. The parameters were
taken from the analysed reference styles; the source posters are not included
and are not named here.

```
assets_manifest.json   every asset: id, file, kind, size, blend_hint, tileable, target params vs baked values, licence
verification.json      independent measurements (FFT pitch and angle, grain std dev, wrap-seam test)
style_links.json       which assets each analysed reference style uses, under opaque ids
halftone/              threshold maps (and a cmyk/ screen set), 2048x2048, tileable
patterns/              checkerboard, CRT scanlines, interference rings
grain/                 mono film, silver gelatin, toner grit, chroma, airbrush, 1024x1024, tileable
paper/                 uncoated, newsprint, aged, ivory, 2048x2048, tileable
overlays/              photocopy creases, edge blotch, toner speckle, cloud smoke
vector/                wireframe grid, flower of life, concentric target (PNG + SVG)
tools/                 the generator and checks: make_assets.py, verify_assets.py, link_recipes.py, apply_demo.py
```

## Using them in the engine

Refer to an asset by id as `asset:<id>`. The loader is `curio/core/assets.py`.

| Where | How |
| --- | --- |
| Any texture parameter (`overlay_texture.texture`, `resolve_texture`) | `"asset:paper_newsprint_r5"` |
| A style's texture layer (export `texture_rules[]`, compiled `texture_rules.layers[]`) | add `"asset": "grain_silver_gelatin_std12"`; the blend defaults to the asset's `blend_hint` |
| A layout `texture` region | `content: "asset:overlay_toner_speckle"` |
| A photo pipeline step | `{"op": "halftone_map", "params": {"map": "asset:ht_line_p13p8_h", "ink": "#080806", "paper": "#E0DED6"}}` |

Asset pixels are at the engine's reference size (1080 px on the short edge), so
tileable assets are **tiled, not stretched**: a 7.8 px screen stays 7.8 px. At other
output sizes they resample by the same factor as every other length. Non-tileable
overlays are fitted to cover the canvas.

The validator rejects an export that names an asset not in this manifest, or that
uses a halftone map as a texture layer. Every asset used in a render is listed in the
render record's `assets_used`, with its licence.

## Conventions

| Kind | Convention |
|---|---|
| `halftone_threshold` | Grey map, high at dot centres. Light where luminance > map. `halftone_map` adds a soft edge of `softness` 8-bit levels, and squeezes the map so pure black is solid ink and pure white is clean paper |
| angle | Lattice-row direction in **image coordinates** (x right, y down, clockwise on screen), mod 90. Line screens are horizontal |
| `grain` | Centred on 128. Use **overlay** or soft light; opacity comes from the style |
| `paper`, multiply `pattern` / `overlay` | 255 = no effect. **Multiply**, then tint with the style's paper colour |
| `screen` overlays (creases, grids) | 0 = no effect. **Screen** |
| tiling | Every `tileable: true` asset repeats seamlessly. Halftone pitch and angle are snapped to a rational lattice so the tile closes exactly, so the baked value can differ slightly from the target (`params` vs `achieved`) |

## Things to know

- **`angle_deg` is not consistent across the analysed styles.** The newsprint line screen reports 90 and the CRT scanlines report 0, and both are horizontal lines. Each asset follows its style's `shape` text. The analysis prompt should define the convention (suggested: the direction the lines or rows run, image coordinates, y down).
- If the analysis measured angles counter-clockwise, the 51.3 degree round-dot screen is really its mirror image (38.7 degrees); `np.fliplr` flips it.
- `ht_line_p4_h` has only 4 tone steps, because 4 px rows cannot carry more. It is a scanline texture, not a photo screen; for a CRT look use `pattern_scanlines_crt_p4`.
- The CMYK set (`halftone/cmyk/`) is one map per process plate. `halftone_map` screens one plate at a time; a four-plate CMYK mode using these maps is not built yet (`halftone_screen` has its own procedural CMYK mode).
- Regenerate with `python curio/assets/tools/make_assets.py --out <dir>` (about 2 minutes), then check with `verify_assets.py`.

# Curio asset pack: format spec

**Audience:** frontend developers putting engine output on the freeform canvas.
**Status:** format `curio.asset_pack` version `1.0`. The engine side is built and tested; the website does not read packs yet.

The Python engine (`curio/`) can render a poster as one flat PNG. For editing, it
can instead write an **asset pack**: the same poster split into separate elements
(background, photo, blocks, frames, text), each with its own position, so a user
can move, resize, restyle and retype them.

```bash
python -m curio render STYLES TEMPLATE out/poster.png --photo photo.jpg --license CC0-1.0 \
  --text headline="Night Shift" --text "tracklist=One|Two|Three" --pack out/pack
```

In Python: `write_pack(render_poster(...), "out/pack")`.

---

## 1. Folder

```
pack/
  manifest.json        the only file you need to parse
  preview.png          the engine's flattened render: what the poster looked like before any edit
  record.json          the engine's full record (values, legibility fixes, licences, warnings); optional to read
  layers/
    background.png     present only when the style has paper/grain textures
    <element id>.png   pixels for image elements, and a raster of each text element
```

Every path in the manifest is relative to the pack folder and uses forward slashes.

## 2. Coordinates

- Units are **canvas pixels**: `canvas.width` x `canvas.height` (for example 1080 x 1350).
  To show the poster at another size, scale everything by the same factor.
- Origin top left; `x`, `y` are the element's top-left corner; `w`, `h` its size.
- `rotation_deg` is clockwise about the element's centre (only text elements use it; it is `0` elsewhere).
- Elements may extend past the canvas edge (negative `x`, or `x + w > width`). That is deliberate bleed; clip to the canvas when exporting.

## 3. Drawing order and compositing

1. Fill the canvas with `background.color`, then draw `background.file` over it if it is not `null`. This is the paper or grain texture already baked onto the ground colour. Treat it as a locked bottom layer.
2. Draw `elements` **in array order: first is bottom, last is top.**
3. Apply each element's `opacity` (0 to 1).
4. Apply each element's `blend`. In version 1.0 it is `"normal"` for everything except `role: "texture"` elements, which are `"multiply"` (CSS `mix-blend-mode: multiply`). If your renderer cannot blend, draw those elements normally. They are subtle overlays, so the poster still reads correctly.

Following these rules reproduces `preview.png` up to 8-bit rounding. The engine's
test suite checks this for every template (`curio/render/pack.py` `compose_pack`
is the reference implementation, about 25 lines).

## 4. `manifest.json`

```json
{
  "format": "curio.asset_pack",
  "version": "1.0",
  "template_id": "synth_newsprint__inset_window",
  "preset_id": "synth_newsprint",
  "layout_id": "inset_window",
  "seed": 0,
  "canvas": { "width": 1080, "height": 1350, "aspect": "4:5", "unit": "px" },
  "background": { "color": "#E8E4DC", "file": "layers/background.png" },
  "elements": [ ... section 5 ... ],
  "fonts": [ { "family": "Anton", "style": "Regular", "weight": 400, "italic": false, "file": "Anton-Regular.ttf", "license": "OFL-1.1" } ],
  "assets_used": [ { "kind": "photo", "source": "photo.jpg", "license": "CC0-1.0" } ],
  "warnings": [ "photo upscaled x1.35: ..." ],
  "preview": "preview.png",
  "record": "record.json"
}
```

Check `format` and the major `version` before reading. A minor version (`1.1`)
only adds fields; ignore fields you do not know.

## 5. Elements

All elements share:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Unique within the pack, stable across re-renders of the same template, for example `photo-photo_window`, `type-headline` |
| `kind` | `image` / `rect` / `text` | How to draw it |
| `role` | string | What it is in the design: `photo`, `texture`, `solid`, `rule`, `frame`, `plate`, `type` |
| `region` | string | The layout region it came from |
| `x`, `y`, `w`, `h` | number | Position and size, section 2 |
| `rotation_deg` | number | Section 2 |
| `opacity` | number | 0 to 1 |
| `blend` | string | Section 3 |

### `kind: "image"` (`role` is `photo` or `texture`)

| Field | Meaning |
| --- | --- |
| `file` | PNG, exactly `w` x `h` pixels, RGB or RGBA |
| `treatment` | photo only: the ordered engine operations already applied to the pixels (halftone, duotone, grain, ...). Informational now; a later server endpoint can re-render the photo at a new size from this |
| `source`, `license` | photo only: where the user's photo came from and its licence, if supplied |
| `texture` | texture only: which procedural texture |

The treatment is **baked into the pixels**. Moving the photo is lossless. Scaling
it also scales the halftone dots and grain. Small changes look fine, but doubling
the size makes the dots visibly coarser.

### `kind: "rect"` (`role` is `solid`, `rule`, `frame` or `plate`)

| Field | Meaning |
| --- | --- |
| `fill` | `#RRGGBB` (solid, rule, plate) |
| `stroke`, `stroke_px` | `#RRGGBB` and width in pixels, drawn **inside** the box (frame) |
| `linked_to` | plate only: the `id` of the text element it sits behind |

These are plain vectors, so recolouring and resizing are lossless. A **plate** is a
backing block the engine added so text stays readable over a busy photo. Keep it
grouped with its `linked_to` text: move them together, and delete the plate if the
user moves the text somewhere legible.

### `kind: "text"` (`role: "type"`)

Text is given **both** as editable settings and as a pixel-exact `raster`.

| Field | Meaning |
| --- | --- |
| `slot` | `headline`, `kicker`, `tracklist`, `credits`, `date`, `venue`, ... |
| `text` | The words as the user wrote them: a string, or a list of lines for `tracklist` / `credits` |
| `case` | `none`, `upper`, `lower` or `title`, applied at display time (CSS `text-transform`). Edit `text`, not the cased form |
| `font` | `{family, style, weight, italic, file, license}`: the face the engine actually used, after any fallback |
| `size_px` | Font size in canvas pixels |
| `tracking_em` | Letter spacing in em (CSS `letter-spacing: <tracking_em>em`); may be negative |
| `leading` | Line height as a multiple of the size (CSS `line-height`) |
| `align` | `left`, `center` or `right` within the box |
| `columns` | 1 to 4; list slots are split evenly into this many columns |
| `color` | `#RRGGBB` fill |
| `hollow` | `true` means outline-only lettering: no fill, a ring of `outline.px` in `outline.color` |
| `outline` | `null`, or `{px, color}`: a stroke around the glyphs (hollow type, or the engine's legibility fix) |
| `fits` | `false` if the engine could not fit the text in its box even at the minimum size |
| `x, y, w, h` | The **text box** (the layout region). Text sits at the top of the box and wraps to `w` |
| `raster` | `{file, x, y, w, h}`: the engine's rendering as a transparent PNG and **its own** placement. Rotation is already baked in, so draw it unrotated |

**Use the raster** until your canvas has the font loaded, or whenever the text is
unchanged. It is exactly what the engine drew. **Switch to live text** once the user
edits it. Your browser's layout will differ slightly from the engine's (kerning and
line breaks), which is expected.

## 6. Mapping to tldraw

tldraw's built-in shapes use a fixed named colour palette and four font styles
(draw, sans, serif, mono), so they cannot show these colours or fonts exactly.
Suggested mapping:

| Pack | tldraw |
| --- | --- |
| `background` | A locked image shape at `(0, 0)`, canvas size, at the bottom; or the frame's background |
| `image` | Image asset from `file`, image shape at `x, y, w, h`, `opacity` |
| `rect` | A small custom shape that draws a `<rect>` with hex `fill` / `stroke`. Built-in geo shapes cannot take hex colours |
| `text` | A custom shape that renders HTML/SVG text with the pack's font, size, tracking, leading, case, colour and outline. Until it exists, show `raster` as an image shape (movable, not retypeable) |
| `plate` + its `linked_to` | Group them |
| `blend: "multiply"` | `mix-blend-mode: multiply` in the custom shape's style, or ignore |

Keep the pack's `id` in each shape's `meta` so edits can be sent back to the engine later.

## 7. Fonts and licences

- `font.file` is a file name only. The website must serve the same font as a web font for live text. The font list shared between the engine and the website is not settled yet: the engine reads font files from disk, and the website ships its own in `public/fonts`.
- Check `font.license` before serving a font file to browsers. Some faces the engine can use (for example Windows system fonts such as Arial) **must not** be served on the web. For those, keep showing the raster, or substitute an open-licensed face of the same category.
- `assets_used` lists every photo and font with its licence as the engine knew it. It is copied from what the caller and the font files said; nothing has been verified.

## 8. What the pack does not do (version 1.0)

- No live re-render: changing the photo's size or crop does not re-run the treatment. That needs the engine running as a service (planned, not built).
- No re-check of legibility after the user moves text. The engine checked contrast once, at render time.
- No editable vector illustration: shapes are rectangles and frames only.
- No groups or masks beyond `plate` / `linked_to`.

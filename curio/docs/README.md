# curio/docs: the style ingestion pipeline

This folder documents the **offline** side of Curio: how reference posters become
the "taste" data (style presets, layouts and templates) that the design engine
uses. It is a batch job run by hand. It is **not part of the website** and must not
run on the production server or in the deploy pipeline.

| File | What it is |
| --- | --- |
| `MODEL_EXPORT_SPEC.md` | The contract for the analysis and clustering model: exactly which JSON files it emits (`recipes/`, `clusters/`, `manifest.json`, `vocab.json`, `fonts.json`) and the rules they must follow |

## Where it sits

```
 reference posters                       (offline, on a dev or worker machine)
        |  analysis + clustering model    -> export/ JSON, per MODEL_EXPORT_SPEC.md
        v
 python -m curio validate export/        reject bad files by field path
 python -m curio compile  export/ compiled/
        |                                 presets/, layouts/, templates/
        v
 publish to TigerData (PostgreSQL)       NOT BUILT YET
        |
 ------ | ------------------------------- boundary: everything above is offline
        v
 website / engine at runtime             reads the published styles, read-only
```

## Rules

- **Run it offline.** Analysis, clustering, validation and compiling are heavy,
  occasional, and deterministic. They run on a developer or worker machine, never
  in a request handler and never on the Vultr server. `deploy.yml` does not run them
  and should not be changed to.
- **The website only reads.** At runtime the app and engine select from published
  styles; they never analyse posters or write style data.
- **JSON is the source of truth.** Markdown reports are generated from it
  (`python -m curio report`) and are never edited by hand.
- **No images, paths, URLs or people's names** in the export or the database
  (spec section 1). Posters are identified only by an opaque hash id.
- **Credentials.** The publish step will need write access to TigerData. Read the
  connection string from the environment (`DATABASE_URL`, or a separate write-only
  variable if one is added) and never commit it or print it.

## Not built yet

- The **publish step** into TigerData. `curio/store/` loads a compiled folder through
  `DirectorySource`; `StyleSource` is the seam where a database source goes. The table
  layout for published styles is undecided.
- The analysis and clustering model itself. It is produced elsewhere; this repo only
  defines its output contract and consumes it.

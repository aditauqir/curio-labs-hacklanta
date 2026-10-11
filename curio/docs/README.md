# curio/docs: the style ingestion pipeline

This folder documents the **offline** side of Curio: how reference posters become
the "taste" data (style presets, layouts and templates) that the design engine
uses. It is a batch job run by hand. It is **not part of the website** and must not
run on the production server or in the deploy pipeline.

| File | What it is |
| --- | --- |
| `MODEL_EXPORT_SPEC.md` | The contract for the analysis and clustering model: exactly which JSON files it emits (`recipes/`, `clusters/`, `manifest.json`, `vocab.json`, `fonts.json`) and the rules they must follow |
| `ASSET_PACK_SPEC.md` | The other end: the format the engine writes when it renders a poster as separate movable elements (`render --pack`), for the freeform editor. Written for frontend developers |

## Where it sits

```
 reference posters                       (offline, on a dev or worker machine)
        |  analysis + clustering model    -> export/ JSON, per MODEL_EXPORT_SPEC.md
        v
 python -m curio validate export/        reject bad files by field path
 python -m curio compile  export/ compiled/
        |                                 presets/, layouts/, templates/
        v
 python -m curio publish compiled/      one new numbered release in TigerData
        |
 ------ | ------------------------------- boundary: everything above is offline
        v
 engine at runtime                       DatabaseSource(): newest release, read-only
```

## Commands

```bash
.venv/Scripts/python -m pip install -e ".[db]"       # adds the psycopg driver
export CURIO_DATABASE_URL=...                         # or DATABASE_URL; never commit or print it

python -m curio publish compiled/ --note "first families"   # --dry-run checks without connecting
python -m curio releases                                    # newest first
python -m curio pull pulled/ [--release N]                  # a release back as a compiled folder
python -m curio render db  TEMPLATE out.png ...             # render from the newest release
python -m curio render db:N TEMPLATE out.png ...            # or from a specific one
```

In code: `DatabaseSource()` (or `DatabaseSource(release_id)`) is a `StyleSource`,
so `DatabaseSource().load()` returns the same `CompiledStyles` as
`DirectorySource(folder).load()`.

## How it is stored

| Table | Contents |
| --- | --- |
| `curio_style_releases` | One row per publish: `id`, `set_hash` (SHA-256 over every document), `counts`, `note`, `created_at` |
| `curio_style_documents` | `(release_id, kind, doc_id)` -> `body` (the exact canonical JSON text) and its `sha256` |

- **Releases are immutable sets.** Templates point at presets and layouts, so a
  release is published whole, in one transaction, or not at all. Readers use the
  newest release, so they never see a half-written set. Older releases stay loadable
  by id; to roll back, `pull` an old one and `publish` it again.
- **Only clean folders are published.** A folder with any load error (a template
  whose preset or layout is missing, a rejected override, a duplicate id) or with no
  templates is refused and nothing is written.
- **Republishing unchanged content is a no-op**: it reports the existing release.
- **Integrity.** Bodies are stored as text, not JSONB, so the stored bytes are what
  was hashed. A reader skips and reports any document that no longer matches its hash.
- The tables are created by the publisher on first use (`CREATE TABLE IF NOT
  EXISTS`). They are not in `db/schema.sql`, because the website does not own them.
- Concurrent publishers are serialised with a Postgres advisory lock.

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
- **Credentials.** Publishing needs write access to TigerData. The connection
  string comes from `CURIO_DATABASE_URL`, else `DATABASE_URL`, and is never printed:
  connection failures are reported without the driver's message. TLS is required
  unless the URL sets its own `sslmode`.

## Testing

`curio/tests/test_database.py` tests the conversion without a database. The
round trip through Postgres runs only when `CURIO_TEST_DATABASE_URL` is set. It
works in a throwaway `curio_test_<random>` schema, which it drops afterwards.

## Not built yet

- The website does not read these tables yet. The Python engine is not connected
  to the Next.js app; when it is, it should use `DatabaseSource` read-only.
- A separate read-only database role for runtime readers. Today everything uses
  the same credential.
- Pruning old releases.
- The analysis and clustering model itself. It is produced elsewhere; this repo only
  defines its output contract and consumes it.

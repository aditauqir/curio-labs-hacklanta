# Styles (data, not code)

Drop style JSON files here. The engine loads every `*.json` under this folder
(sub-folders included) and re-reads changed files without a restart.

Two kinds of file are recognised, told apart by their id field:

- **Preset** (has `preset_id`): a style family the director selects from.
- **Recipe** (has `poster_id`): the reverse-engineered description of one poster.

Rules the loader follows:

- `schema_version` is `"MAJOR.MINOR"`. Major must match the engine (currently
  `1`). A newer minor loads, with a warning.
- Unknown fields are kept and ignored. Missing optional fields take defaults.
- A file with an error is skipped and reported with its file name and field
  path. Every other file still loads.
- Files and folders starting with `.` or `_` are ignored (handy for drafts).

Change the folder with the `CURIO_STYLES_DIR` environment variable.

Nothing in `curio/` code defines a specific style. The only styles that exist in
code are the generic `fallback_*` test presets in
`curio/style_schema/fallback.py`, and they are never loaded unless asked for.

See `curio/README.md` for the parameter-path conventions presets use.

"""Command line: ``python -m curio <command>``.

validate EXPORT_DIR          check a model export; print each problem as file: field: message
compile  EXPORT_DIR OUT_DIR  validate, then write presets, layouts and templates
report   EXPORT_DIR OUT_DIR  write the markdown report for each cluster
render   STYLES TEMPLATE OUT.png --photo P --text slot=value ...
                             render a compiled template; writes OUT.png and OUT.json (the record).
                             STYLES is a compiled folder, or db (newest release) or db:N.
                             --pack DIR also writes the poster as separate elements for an editor
publish  COMPILED_DIR        upload a compiled folder to TigerData as a new release
pull     OUT_DIR             download a release (default: newest) as a compiled folder
releases                     list published releases, newest first
assets                       check and list the asset library (curio/assets)
publish-library              upsert the asset library into the website's shared library table
ops                          list the engine's operations

publish, pull, releases and db styles read the connection string from
CURIO_DATABASE_URL, else DATABASE_URL. They are offline tools, not run by the website.

Exit status: 0 when nothing was skipped and there were no errors, 1 otherwise.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from curio.compiler import load_export
from curio.compiler.compile import compile_bundle, write_compiled
from curio.compiler.report import render_report


def _print_issues(issues, stream=None) -> None:
    # Resolve stdout at call time: a default of sys.stdout is bound at import and
    # would miss any later redirection.
    stream = stream or sys.stdout
    for issue in sorted(issues, key=lambda i: (i.severity != "error", i.file, i.path)):
        print(issue, file=stream)


def cmd_validate(args: argparse.Namespace) -> int:
    bundle = load_export(args.export)
    _print_issues(bundle.issues)
    print(f"\n{len(bundle.recipes)} recipe(s) and {len(bundle.clusters)} cluster(s) valid; {len(bundle.skipped)} file(s) skipped; {len(bundle.errors)} error(s).")
    return 0 if bundle.ok and not bundle.skipped else 1


def cmd_compile(args: argparse.Namespace) -> int:
    bundle = load_export(args.export)
    result = compile_bundle(bundle)
    _print_issues(result.issues)
    written = write_compiled(result, args.out)
    print(f"\ncompiled {len(result.presets)} preset(s), {len(result.layouts)} layout(s), {len(result.templates)} template(s); wrote {len(written)} file(s) to {args.out}.")
    return 0 if result.ok and not result.skipped else 1


def cmd_report(args: argparse.Namespace) -> int:
    bundle = load_export(args.export)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for cluster_id, cluster in sorted(bundle.clusters.items()):
        (out / f"{cluster_id}.md").write_text(render_report(cluster), encoding="utf-8")
    _print_issues(bundle.issues)
    print(f"\nwrote {len(bundle.clusters)} report(s) to {out}.")
    return 0 if bundle.ok else 1


def cmd_render(args: argparse.Namespace) -> int:
    import json

    from curio.core.image import load_image, save_image
    from curio.render import Photo, RenderRequest, render_poster
    from curio.typography import FontLibrary

    styles = _style_source(args.styles).load()
    _print_issues(styles.issues, sys.stderr)
    content: dict[str, object] = {}
    for item in args.text:
        slot, sep, value = item.partition("=")
        if not sep:
            print(f"--text expects slot=value, got {item!r}", file=sys.stderr)
            return 1
        # Tracklists and credits are lists; give them as one value separated by |.
        content[slot] = value.split("|") if slot in ("tracklist", "credits") else value
    fonts = FontLibrary.from_directories(args.fonts) if args.fonts else FontLibrary.from_system()
    photo = Photo(load_image(args.photo), (args.focus_x, args.focus_y), source=args.photo, license=args.license) if args.photo else None
    request = RenderRequest(args.template, content, photo, aspect=args.aspect, short_edge=args.short_edge, seed=args.seed)
    result = render_poster(request, styles, fonts)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    save_image(result.image, out)
    out.with_suffix(".json").write_text(json.dumps(result.record, indent=2, sort_keys=True), encoding="utf-8")
    if args.pack:
        from curio.render import write_pack

        print(f"wrote the asset pack {write_pack(result, args.pack)}")
    for warning in result.warnings:
        print(f"warning: {warning}", file=sys.stderr)
    print(f"wrote {out} ({result.record['canvas'][0]}x{result.record['canvas'][1]}) and {out.with_suffix('.json')}")
    return 0


def _style_source(spec: str):
    from curio.store import DatabaseSource, DirectorySource

    if spec == "db":
        return DatabaseSource()
    if spec.startswith("db:"):
        return DatabaseSource(int(spec[3:]))
    return DirectorySource(spec)


def _db_command(fn):
    """Runs a database command, reporting failures without the connection string."""

    def run(args: argparse.Namespace) -> int:
        from curio.store.database import DatabaseNotConfigured

        try:
            import psycopg
        except ImportError:
            print('psycopg is not installed: pip install -e ".[db]"', file=sys.stderr)
            return 1
        try:
            return fn(args)
        except DatabaseNotConfigured as error:
            print(error, file=sys.stderr)
        except psycopg.OperationalError:
            # The driver's message can echo connection details; keep them out of logs.
            print("cannot reach the database; check CURIO_DATABASE_URL / DATABASE_URL and the network", file=sys.stderr)
        except psycopg.Error as error:
            print(f"database error: {type(error).__name__}: {error}", file=sys.stderr)
        return 1

    return run


def _describe(release) -> str:
    counts = ", ".join(f"{n} {kind}(s)" for kind, n in release.counts.items())
    note = f"  {release.note}" if release.note else ""
    return f"release {release.id}  {release.created_at:%Y-%m-%d %H:%M}  {counts}  {release.set_hash[:12]}{note}"


@_db_command
def cmd_publish(args: argparse.Namespace) -> int:
    from curio.store.database import PublishRefused, collect_documents, connect, publish

    try:
        docs = collect_documents(args.compiled)
    except PublishRefused as refused:
        _print_issues(refused.issues, sys.stderr)
        print(f"\nnot published: {len(refused.issues)} problem(s). Fix them and compile again.", file=sys.stderr)
        return 1
    if args.dry_run:
        print(f"would publish {len(docs)} document(s) from {args.compiled}; nothing written (--dry-run).")
        return 0
    with connect() as conn:
        result = publish(conn, docs, args.note)
    verb = "published" if result.created else "unchanged; the newest release already matches:"
    print(f"{verb} {_describe(result.release)}")
    return 0


@_db_command
def cmd_pull(args: argparse.Namespace) -> int:
    from curio.store import DatabaseSource
    from curio.store.database import styles_from_documents, write_documents

    source = DatabaseSource(args.release)
    docs = source.documents()
    if source.release is None:
        print("no such release has been published" if args.release else "nothing has been published yet", file=sys.stderr)
        return 1
    styles = styles_from_documents(docs)
    _print_issues(styles.issues, sys.stderr)
    written = write_documents(docs, args.out)
    print(f"pulled {_describe(source.release)}\nwrote {len(written)} file(s) to {args.out}")
    return 0 if not styles.errors else 1


@_db_command
def cmd_releases(args: argparse.Namespace) -> int:
    from curio.store.database import tables_exist, connect, list_releases

    with connect() as conn:
        releases = list_releases(conn, args.limit) if tables_exist(conn) else []
    for release in releases:
        print(_describe(release))
    if not releases:
        print("nothing has been published yet")
    return 0


def cmd_assets(args: argparse.Namespace) -> int:
    from curio.core.assets import AssetLibrary

    library = AssetLibrary(args.dir) if args.dir else AssetLibrary()
    for issue in library.issues:
        print(issue, file=sys.stderr)
    for asset in sorted(library.assets.values(), key=lambda a: (a.kind, a.id)):
        print(f"{asset.kind:18} {asset.reference:38} {asset.width}x{asset.height}  {asset.blend_hint:10} {'tileable' if asset.tileable else 'fitted':8} {asset.license}")
    print(f"\n{len(library.assets)} asset(s) in {library.directory}; {len(library.issues)} problem(s).")
    return 0 if not library.issues else 1


def cmd_publish_library(args: argparse.Namespace) -> int:
    from curio.core.assets import AssetLibrary
    from curio.store.library_assets import rows_for

    library = AssetLibrary(args.dir) if args.dir else AssetLibrary()
    if library.issues:
        for issue in library.issues:
            print(issue, file=sys.stderr)
        print("\nnot published: fix the manifest first.", file=sys.stderr)
        return 1
    rows = rows_for(library)
    size = sum(r.size_bytes for r in rows) / 1e6
    if args.dry_run:
        for row in rows:
            print(f"{row.id:46} {row.content_type:14} {row.size_bytes:>9}  {', '.join(row.tags)}")
        print(f"\nwould upsert {len(rows)} row(s), {size:.1f} MB, into curio_library_assets; nothing written (--dry-run).")
        return 0
    return _db_command(_publish_rows)(argparse.Namespace(rows=rows, prune=args.prune))


def _publish_rows(args: argparse.Namespace) -> int:
    from curio.store.database import connect
    from curio.store.library_assets import publish_library

    with connect() as conn:
        s = publish_library(conn, args.rows, prune=args.prune)
    print(f"library: {s.inserted} inserted, {s.updated} updated, {s.unchanged} unchanged, {s.removed} removed ({s.total_bytes / 1e6:.1f} MB)")
    return 0


def cmd_ops(args: argparse.Namespace) -> int:
    from curio.ops import list_ops

    for spec in list_ops():
        print(f"{spec.category:10} {spec.name:22} {spec.doc}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="curio", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, fn, helptext, needs_out in (
        ("validate", cmd_validate, "check a model export", False),
        ("compile", cmd_compile, "compile an export into presets, layouts and templates", True),
        ("report", cmd_report, "write markdown reports from the cluster JSON", True),
    ):
        p = sub.add_parser(name, help=helptext)
        p.add_argument("export", help="path to the export folder")
        if needs_out:
            p.add_argument("out", help="output folder")
        p.set_defaults(fn=fn)
    r = sub.add_parser("render", help="render a compiled template to a PNG and its record")
    r.add_argument("styles", help="compiled styles folder (presets/, layouts/, templates/), or db / db:N for a published release")
    r.add_argument("template", help="template id")
    r.add_argument("out", help="output PNG path; the record is written next to it as .json")
    r.add_argument("--photo", help="photo file")
    r.add_argument("--license", help="the photo's licence, recorded in assets_used")
    r.add_argument("--focus-x", type=float, default=0.5)
    r.add_argument("--focus-y", type=float, default=0.5)
    r.add_argument("--text", action="append", default=[], metavar="SLOT=VALUE", help="content for a slot; repeatable. Lists use |")
    r.add_argument("--fonts", action="append", metavar="DIR", help="font folder (repeatable); default: system fonts")
    r.add_argument("--aspect", help="for example 4:5; default: the template's first seen aspect")
    r.add_argument("--short-edge", type=int, default=1080)
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--pack", metavar="DIR", help="also write an asset pack (separate movable elements) to DIR")
    r.set_defaults(fn=cmd_render)
    pub = sub.add_parser("publish", help="upload a compiled folder to TigerData as a new release")
    pub.add_argument("compiled", help="compiled styles folder (output of compile)")
    pub.add_argument("--note", help="a short note stored with the release")
    pub.add_argument("--dry-run", action="store_true", help="check the folder without connecting")
    pub.set_defaults(fn=cmd_publish)
    pull = sub.add_parser("pull", help="download a published release as a compiled folder")
    pull.add_argument("out", help="output folder")
    pull.add_argument("--release", type=int, help="release id (default: newest)")
    pull.set_defaults(fn=cmd_pull)
    rel = sub.add_parser("releases", help="list published releases, newest first")
    rel.add_argument("--limit", type=int, default=20)
    rel.set_defaults(fn=cmd_releases)
    assets = sub.add_parser("assets", help="check and list the asset library (curio/assets)")
    assets.add_argument("--dir", help="library folder (default: curio/assets or $CURIO_ASSETS_DIR)")
    assets.set_defaults(fn=cmd_assets)
    lib = sub.add_parser("publish-library", help="upsert the asset library into the website's curio_library_assets table")
    lib.add_argument("--dir", help="library folder (default: curio/assets or $CURIO_ASSETS_DIR)")
    lib.add_argument("--dry-run", action="store_true", help="list the rows without connecting")
    lib.add_argument("--prune", action="store_true", help="also delete engine: rows the manifest no longer lists")
    lib.set_defaults(fn=cmd_publish_library)
    ops = sub.add_parser("ops", help="list engine operations")
    ops.set_defaults(fn=cmd_ops)
    args = parser.parse_args(argv)
    if args.fn is cmd_render and args.styles.partition(":")[0] == "db":
        return _db_command(cmd_render)(args)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())

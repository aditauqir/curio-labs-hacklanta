"""Command line: ``python -m curio <command>``.

validate EXPORT_DIR          check a model export; print each problem as file: field: message
compile  EXPORT_DIR OUT_DIR  validate, then write presets, layouts and templates
report   EXPORT_DIR OUT_DIR  write the markdown report for each cluster
ops                          list the engine's operations

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
    ops = sub.add_parser("ops", help="list engine operations")
    ops.set_defaults(fn=cmd_ops)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())

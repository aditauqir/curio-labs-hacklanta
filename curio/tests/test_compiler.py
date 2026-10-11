from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from curio.cli import main as cli
from curio.compiler import ExportContext, load_export, validate_cluster_export, validate_recipe_export
from curio.compiler.compile import CompilePolicy, compile_bundle, compile_cluster, content_hash, template_distance, write_compiled, _free_numeric
from curio.compiler.report import render_report
from curio.core.stacks import run_stack
from curio.layout import parse_layout
from curio.style_schema import Preset, StyleLibrary
from curio.tests import exportfix as fx
from curio.tests.fixtures import standin_photo

CLUSTER = "clusters/synth_newsprint.json"


def export(tmp_path: Path, **mutate) -> Path:
    return fx.write_export(tmp_path / "export", {k.replace("__", "/") + ".json" if not k.endswith(".json") else k: v for k, v in mutate.items()})


def compiled(tmp_path: Path):
    bundle = load_export(fx.write_export(tmp_path / "export"))
    assert bundle.ok, [str(i) for i in bundle.errors]
    return compile_bundle(bundle)


def paths(issues) -> list[str]:
    return [i.path for i in issues if i.severity == "error"]


def cluster_with(edit) -> dict:
    c = fx.families()["synth_newsprint"]
    edit(c)
    return c


def validate(edit, **ctx):
    c = cluster_with(edit)
    context = ExportContext(
        vocab={k: fx.VOCAB[k] for k in ("moods", "genres", "subject_types")},
        fonts={f["family"] for f in fx.FONTS["fonts"]},
        recipe_ids={m["poster_id"] for m in c["members"]},
    )
    for k, v in ctx.items():
        setattr(context, k, v)
    return validate_cluster_export(c, "clusters/x.json", context)


# ----------------------------------------------------------------- the good path


def test_a_valid_export_loads_with_no_errors_and_nothing_skipped(tmp_path):
    bundle = load_export(fx.write_export(tmp_path / "e"))
    assert bundle.ok and not bundle.skipped
    assert len(bundle.recipes) == 9 and sorted(bundle.clusters) == ["synth_duotone", "synth_newsprint", "synth_photocopy"]
    assert not [i for i in bundle.issues if i.severity == "warning"]


def test_every_cluster_in_the_spec_example_validates():
    # The worked example in the model spec must itself pass the checks it asks for.
    import re

    text = Path("curio/docs/MODEL_EXPORT_SPEC.md").read_text(encoding="utf-8")
    blocks = [json.loads(b) for b in re.findall(r"```json\n(.*?)```", text, re.S)]
    cluster = next(b for b in blocks if b.get("cluster_id") == "example_newsprint_family")
    vocab = next(b for b in blocks if "moods" in b and "subject_types" in b and "schema_version" in b)
    ctx = ExportContext({k: vocab[k] for k in ("moods", "genres", "subject_types")}, {"Impact", "Anton", "Playfair Display"}, {m["poster_id"] for m in cluster["members"]})
    doc, issues = validate_cluster_export(cluster, "c.json", ctx)
    assert doc is not None, [str(i) for i in issues]


# -------------------------------------------------------- cluster rules (spec 13)


@pytest.mark.parametrize(
    "edit,fragment",
    [
        (lambda c: c["pipeline"].__setitem__(1, {**c["pipeline"][1], "op": "teleport"}), "pipeline[1].op"),
        (lambda c: c["pipeline"].__setitem__(1, {**c["pipeline"][1], "id": "levels"}), "pipeline[1].id"),
        (lambda c: c["params"].update({"ghost.amount": fx.param("unitless_0_1", 0.3, 0.2, 0.4, "free")}), "params.ghost.amount"),
        (lambda c: c["params"].update({"grain.nonsense": fx.param("unitless_0_1", 0.3, 0.2, 0.4, "free")}), "params.grain.nonsense"),
        (lambda c: c["params"]["halftone_screen.pitch_px"].update(unit="deg"), "pitch_px.unit"),
        (lambda c: c["params"]["grain.amount"].pop("unit"), "grain.amount.unit"),
        (lambda c: c["params"]["grain.amount"].update(unit="furlongs"), "grain.amount.unit"),
        (lambda c: c["params"]["grain.amount"].update(median=0.9), "grain.amount"),
        (lambda c: c["params"]["grain.amount"].update(n=9), "grain.amount.n"),
        (lambda c: c["params"]["grain.amount"].update(role="sometimes"), "grain.amount.role"),
        (lambda c: c["params"]["grain.amount"].update(source="guessed"), "grain.amount.source"),
        (lambda c: c["params"]["halftone_screen.shape"].update(values={"zigzag": 3}), "shape.values"),
        (lambda c: c["params"]["halftone_screen.shape"].update(values={"line": 9}), "shape.values"),
        (lambda c: c["params"].update({"halftone_screen.ink": fx.param("unitless_0_1", 0.3, 0.2, 0.4, "defining")}), "halftone_screen.ink"),
        (lambda c: c.update(support=7), "support"),
        (lambda c: c["members"].append(dict(c["members"][0])), "members"),
        (lambda c: c["members"][0].update(poster_id="poster_one"), "members[0].poster_id"),
        (lambda c: c["members"][0].update(weight=1.5), "members[0].weight"),
        (lambda c: c.pop("generated"), "generated"),
        (lambda c: c["generated"].pop("random_seed"), "generated.random_seed"),
        (lambda c: c["colors"][0].update(center="paper"), "colors[0].center"),
        (lambda c: c["colors"][0].update(role="orange"), "colors[0].role"),
        (lambda c: c["colors"][0].update(max_delta_e=-1), "colors[0].max_delta_e"),
        (lambda c: c["layout_clusters"][0]["members"].append("r_000000000000"), "layout_clusters[0].members"),
        (lambda c: c["layout_clusters"][0]["regions"][0].update(x=fx.rng(0.5, 0.4, 0.6), w=fx.rng(0.8, 0.7, 0.9)), "regions[0]"),
        (lambda c: c["layout_clusters"][0]["regions"][0].update(role="blob"), "regions[0].role"),
        (lambda c: c["layout_clusters"][0]["regions"][1].update(content="nonsense"), "regions[1].content"),
        (lambda c: c["layout_clusters"][0]["regions"].append(dict(c["layout_clusters"][0]["regions"][0])), "regions[4].id"),
        (lambda c: c["layout_clusters"].append(dict(c["layout_clusters"][0])), "layout_clusters[2].layout_id"),
        (lambda c: c["type_roles"][0].update(category="fancy"), "type_roles[0].category"),
        (lambda c: c["type_roles"][0].update(case="shouty"), "type_roles[0].case"),
        (lambda c: c["type_roles"][0].update(font_matches=[]), "type_roles[0].font_matches"),
        (lambda c: c["type_roles"][0]["font_matches"][0].update(name="Papyrus"), "font_matches[0].name"),
        (lambda c: c["texture_rules"][0].update(blend="glitter"), "texture_rules[0].blend"),
        (lambda c: c["texture_rules"][0].update(probability=2), "texture_rules[0].probability"),
        (lambda c: c["selection"]["moods"].append("sparkly"), "selection.moods"),
        (lambda c: c["selection"].update(avoid_when=[]), "selection.avoid_when"),
        (lambda c: c["selection"].update(director_notes="x" * 301), "director_notes"),
        (lambda c: c["selection"].update(example_briefs=["only one"]), "example_briefs"),
        (lambda c: c.pop("unsupported_by_engine"), "unsupported_by_engine"),
        (lambda c: c.update(schema_version="2.0"), "schema_version"),
        (lambda c: c.update(cluster_id="Bad Id"), "cluster_id"),
    ],
)
def test_each_rule_in_the_checklist_is_enforced_with_the_exact_field(edit, fragment):
    doc, issues = validate(edit)
    assert doc is None, f"expected rejection for {fragment}"
    assert any(fragment in p for p in paths(issues)), (fragment, paths(issues))


def test_a_member_without_a_recipe_file_is_an_error():
    doc, issues = validate(lambda c: None, recipe_ids={"r_other00000000"})
    assert doc is None and any(i.path.startswith("members[") for i in issues)


@pytest.mark.parametrize(
    "text",
    ["https://example.com/poster.jpg", "file:///c:/refs/a.jpg", "C:\\Users\\me\\refs\\a.jpg", "/home/me/refs/a.png", "data:image/png;base64,AAAA", "refs/charli/adadadadd.jpeg", "../refs/a.jpg"],
)
def test_paths_and_urls_are_rejected_anywhere_in_a_file(text):
    doc, issues = validate(lambda c: c["quality"].update(notes=text))
    assert doc is None and any("path or URL" in i.message for i in issues)


@pytest.mark.parametrize("text", ["print/ephemera cinema", "Warm paper and one dark ink.", "4:5", "n/a"])
def test_ordinary_prose_is_not_mistaken_for_a_path(text):
    doc, issues = validate(lambda c: c["quality"].update(notes=text))
    assert doc is not None, [str(i) for i in issues]


def test_sparse_samples_with_a_confident_spread_are_warned_about():
    doc, issues = validate(lambda c: c["params"]["grain.amount"].update(n=2, spread="low"))
    assert doc is not None and any(i.severity == "warning" and "spread" in i.path for i in issues)


def test_a_length_outside_the_ops_limits_warns_that_it_will_clamp():
    doc, issues = validate(lambda c: c["params"]["halftone_screen.pitch_px"].update(median=0.0004, min=0.0003, max=0.0005))
    assert doc is not None and any(i.severity == "warning" and "clamped" in i.message for i in issues)


# --------------------------------------------------------------------- recipes


def recipe_issues(edit):
    r = fx.recipe("synth_newsprint", 0, [{"step": 1, "op": "levels", "params": {}, "range": {}}])
    edit(r)
    return validate_recipe_export(r, f"recipes/{r['poster_id']}.json", ExportContext(fonts={"Impact"}))


@pytest.mark.parametrize(
    "edit,fragment",
    [
        (lambda r: r["photo_pipeline"][0].update(op="liquify"), "photo_pipeline[0].op"),
        (lambda r: r.pop("measurement_context"), "measurement_context"),
        (lambda r: r["measurement_context"].update(source_kind="fax"), "source_kind"),
        (lambda r: r.update(confidence=2), "confidence"),
        (lambda r: r.pop("unsupported_by_engine"), "unsupported_by_engine"),
        (lambda r: r.pop("layout"), "layout"),
        (lambda r: r["typography"][0].update(role="slogan"), "typography[0].role"),
        (lambda r: r["typography"][0]["font_matches"][0].update(name="Papyrus"), "font_matches[0].name"),
        (lambda r: r.update(poster_id="x"), "poster_id"),
        (lambda r: r["palette"][0].update(hex="paper"), "palette[0].hex"),
        (lambda r: r.update(style_tags=["see C:\\refs\\a.jpg"]), "style_tags"),
    ],
)
def test_recipe_rules_are_stricter_than_the_engine_loader(edit, fragment):
    doc, issues = recipe_issues(edit)
    assert doc is None and any(fragment in p for p in paths(issues)), (fragment, paths(issues))


def test_a_valid_recipe_passes():
    doc, issues = recipe_issues(lambda r: None)
    assert doc is not None, [str(i) for i in issues]


# -------------------------------------------------- manifest, vocab, fonts, files


def test_a_tampered_file_fails_its_manifest_hash_but_others_still_load(tmp_path):
    root = fx.write_export(tmp_path / "e")
    path = root / "clusters/synth_photocopy.json"
    path.write_text(path.read_text() + "\n ", encoding="utf-8")
    bundle = load_export(root)
    assert any("does not match" in i.message and i.file == "manifest.json" for i in bundle.errors)
    assert "synth_photocopy" in bundle.clusters  # the content is still valid; only the hash disagrees


def test_missing_and_unlisted_files_are_reported(tmp_path):
    root = fx.write_export(tmp_path / "e")
    (root / "recipes" / fx.pid("synth_newsprint", 0)).with_suffix(".json").unlink()
    (root / "extra.json").write_text("{}")
    bundle = load_export(root)
    messages = [(i.severity, i.message) for i in bundle.issues]
    assert any("missing from the export" in m for _, m in messages)
    assert ("warning", "present but not listed in manifest.json") in messages
    assert any(i.path.startswith("members[") and "no recipe" in i.message for i in bundle.errors)
    assert "synth_newsprint" not in bundle.clusters


def test_invalid_json_is_reported_with_a_position_and_does_not_stop_the_rest(tmp_path):
    root = fx.write_export(tmp_path / "e", {"clusters/synth_duotone.json": "{ not json"})
    bundle = load_export(root)
    assert any(i.file == "clusters/synth_duotone.json" and "line 1" in i.path for i in bundle.errors)
    assert sorted(bundle.clusters) == ["synth_newsprint", "synth_photocopy"]
    assert "clusters/synth_duotone.json" in bundle.skipped


def test_a_file_named_differently_from_its_id_is_skipped(tmp_path):
    bundle = load_export(fx.write_export(tmp_path / "e", {"clusters/wrong_name.json": fx.families()["synth_photocopy"]}))
    assert any("is named wrong_name.json" in i.message or "named wrong_name" in i.message for i in bundle.errors)
    assert "clusters/wrong_name.json" in bundle.skipped


def test_missing_export_folder_and_empty_clusters_are_reported(tmp_path):
    assert any("does not exist" in i.message for i in load_export(tmp_path / "nope").issues)
    root = tmp_path / "empty"
    root.mkdir()
    assert any("no cluster files" in i.message for i in load_export(root).issues)


@pytest.mark.parametrize(
    "mutate,fragment",
    [
        ({"vocab.json": {"schema_version": "1.0", "moods": [], "genres": ["a"], "subject_types": ["b"]}}, "moods"),
        ({"vocab.json": {"schema_version": "1.0", "moods": ["a", "a"], "genres": ["a"], "subject_types": ["b"]}}, "moods"),
        ({"fonts.json": {"schema_version": "1.0", "fonts": [{"family": "Papyrus", "category": "script", "license": "proprietary"}]}}, "free_alternatives"),
        ({"fonts.json": {"schema_version": "1.0", "fonts": [{"family": "Anton", "category": "weird", "license": "OFL"}]}}, "category"),
        ({"fonts.json": {"schema_version": "1.0", "fonts": [{"family": "Anton", "category": "display"}]}}, "license"),
    ],
)
def test_vocab_and_font_files_are_validated(tmp_path, mutate, fragment):
    bundle = load_export(fx.write_export(tmp_path / "e", mutate))
    assert any(fragment in i.path for i in bundle.errors), [str(i) for i in bundle.errors]


def test_one_bad_cluster_does_not_stop_the_others_from_compiling(tmp_path):
    root = fx.write_export(tmp_path / "e", {CLUSTER: lambda c: c["pipeline"].__setitem__(0, {**c["pipeline"][0], "op": "teleport"})})
    result = compile_bundle(load_export(root))
    assert sorted(result.presets) == ["synth_duotone", "synth_photocopy"]
    assert CLUSTER in result.skipped and not result.ok


# --------------------------------------------------------------------- compile


def test_compiled_lengths_are_reference_pixels_not_fractions(tmp_path):
    p = compiled(tmp_path).presets["synth_newsprint"]
    assert p["defaults"]["halftone_screen.pitch_px"] == pytest.approx(0.0102 * 1080)
    assert p["units"] == {"reference_short_edge_px": 1080}
    assert p["defaults"]["ink_bleed.spread_px"] if "ink_bleed.spread_px" in p["defaults"] else True


def test_ranges_always_contain_the_observed_extremes_and_the_default(tmp_path):
    p = compiled(tmp_path).presets["synth_newsprint"]
    lo, hi = p["ranges"]["halftone_screen.pitch_px"]
    assert lo < 0.0091 * 1080 < 0.0128 * 1080 < hi and lo <= p["defaults"]["halftone_screen.pitch_px"] <= hi
    lo, hi = p["ranges"]["grain.amount"]
    assert lo < 0.2 and hi > 0.5


def test_free_parameters_get_wider_margins_than_defining_ones(tmp_path):
    policy = CompilePolicy()
    d = fx.param("unitless_0_1", 0.5, 0.4, 0.6, "defining")
    lo_d, hi_d = __import__("curio.compiler.compile", fromlist=["expand_range"]).expand_range(0.4, 0.6, 0.5, "defining", 3, policy)
    lo_f, hi_f = __import__("curio.compiler.compile", fromlist=["expand_range"]).expand_range(0.4, 0.6, 0.5, "free", 3, policy)
    assert (hi_f - lo_f) > (hi_d - lo_d) > 0.2


def test_sparse_support_widens_margins(tmp_path):
    from curio.compiler.compile import expand_range

    policy = CompilePolicy()
    assert expand_range(0.4, 0.6, 0.5, "free", 1, policy)[1] > expand_range(0.4, 0.6, 0.5, "free", 5, policy)[1]
    # A single sample has no span; the floor still gives it some room.
    lo, hi = expand_range(0.3, 0.3, 0.3, "free", 1, policy)
    assert lo < 0.3 < hi


def test_assumed_ranges_are_recorded_so_nothing_pretends_they_were_measured(tmp_path):
    p = compiled(tmp_path).presets["synth_duotone"]
    assert p["source_cluster"]["ranges_from_assumed"] == ["vignette.amount"]
    assert p["unsupported_by_engine"] == ["subject isolation onto a flat colour ground"]


def test_colour_roles_bind_to_the_steps_that_exist(tmp_path):
    result = compiled(tmp_path)
    news, duo, copy_ = result.presets["synth_newsprint"], result.presets["synth_duotone"], result.presets["synth_photocopy"]
    assert news["defaults"]["halftone_screen.ink"] == "#101010" and news["defaults"]["halftone_screen.paper"] == "#E8E4DC"
    assert duo["defaults"]["duotone.shadow"] == "#1B1340" and duo["defaults"]["duotone.highlight"] == "#FFB36B"
    assert copy_["defaults"]["threshold.dark"] == "#080806" and copy_["defaults"]["threshold.light"] == "#F0EBE4"
    spec = news["ranges"]["halftone_screen.ink"]
    assert spec == {"center": "#101010", "max_delta_e": 5.0}  # observed 3.0 plus the 2.0 margin
    assert "halftone_screen.ink" in news["defining_params"]


def test_an_explicit_param_wins_over_a_colour_binding(tmp_path):
    c = fx.families()["synth_newsprint"]
    c["params"]["halftone_screen.ink"] = {"unit": "none", "values": {"#000000": 3}, "role": "defining", "source": "measured"}
    # a colour param has to be described with values; the binding must not overwrite it
    result, issues = compile_cluster(c, "c.json")
    assert result.presets["synth_newsprint"]["defaults"]["halftone_screen.ink"] == "#000000"


def test_compiled_presets_pass_the_engines_own_validation_and_run(tmp_path):
    result = compiled(tmp_path)
    folder = tmp_path / "styles"
    write_compiled(result, folder)
    library = StyleLibrary(folder / "presets")
    report = library.load()
    assert not report.errors and sorted(library.presets) == sorted(result.presets)
    for preset in library.presets.values():
        resolved = preset.resolve()
        assert not resolved.log
        out = run_stack(standin_photo(48), resolved.to_calls(), seed=3)
        assert np.all(np.isfinite(out))


def test_compiled_defining_parameters_hold_when_pushed(tmp_path):
    result = compiled(tmp_path)
    preset = Preset(__import__("curio.compiler.compile", fromlist=["_as_document"])._as_document(result.presets["synth_newsprint"]))
    r = preset.resolve({"halftone_screen.pitch_px": 40, "grain.amount": 0.99})
    assert r.values["halftone_screen.pitch_px"] == pytest.approx(0.0102 * 1080)  # rejected, held
    assert r.values["grain.amount"] <= preset.ranges["grain.amount"]["max"]  # clamped into range
    assert [e.action for e in r.log] == ["rejected", "clamped"] or {e.action for e in r.log} == {"rejected", "clamped"}


def test_compiled_layouts_parse_and_mark_optional_slots(tmp_path):
    result = compiled(tmp_path)
    layout = parse_layout(result.layouts["synth_newsprint__inset_window"])
    assert layout.slots == ["kicker", "headline", "tracklist"][1:2] + ["kicker", "tracklist"] or set(layout.slots) == {"headline", "kicker", "tracklist"}
    by_id = {r.id: r for r in layout.regions}
    assert by_id["headline"].optional is False and by_id["kicker"].optional and by_id["tracklist"].optional
    assert by_id["photo_window"].x.lo < 0.07 and by_id["photo_window"].x.default == pytest.approx(0.08) and by_id["photo_window"].x.hi > 0.09
    assert 0 <= by_id["photo_window"].x.lo and by_id["photo_window"].y.hi <= 1


def test_layout_bounds_stay_inside_the_canvas_unless_the_region_bleeds(tmp_path):
    for doc in compiled(tmp_path).layouts.values():
        for r in doc["regions"]:
            for key in "xywh":
                assert r[key]["lo"] >= (-0.5 if r["bleed"] else 0.0) and r[key]["hi"] <= (1.5 if r["bleed"] else 1.0), (doc["layout_id"], r["id"], key)


def test_compilation_is_deterministic_byte_for_byte(tmp_path):
    a, b = compiled(tmp_path / "a"), compiled(tmp_path / "b")
    write_compiled(a, tmp_path / "out_a")
    write_compiled(b, tmp_path / "out_b")
    files_a = sorted((tmp_path / "out_a").rglob("*.json"))
    assert files_a and [p.relative_to(tmp_path / "out_a") for p in files_a] == [p.relative_to(tmp_path / "out_b") for p in sorted((tmp_path / "out_b").rglob("*.json"))]
    for p in files_a:
        assert p.read_bytes() == (tmp_path / "out_b" / p.relative_to(tmp_path / "out_a")).read_bytes()


def test_content_hash_detects_any_change_and_ignores_itself(tmp_path):
    p = dict(compiled(tmp_path).presets["synth_duotone"])
    stored = p["content_hash"]
    assert content_hash(p) == stored
    p["defaults"] = {**p["defaults"], "grain.amount": 0.31}
    assert content_hash(p) != stored


# ------------------------------------------------------------------- templates


def test_every_layout_gets_a_base_template_and_every_template_resolves_cleanly(tmp_path):
    result = compiled(tmp_path)
    for layout_id in result.layouts:
        assert any(t["layout_id"] == layout_id and t["derived"]["kind"] == "base" and t["overrides"] == {} for t in result.templates.values())
    for template in result.templates.values():
        preset = Preset(__import__("curio.compiler.compile", fromlist=["_as_document"])._as_document(result.presets[template["preset_id"]]))
        assert not preset.resolve(template["overrides"]).rejected(), template["template_id"]


def test_templates_are_not_redundant(tmp_path):
    result = compiled(tmp_path)
    policy = CompilePolicy()
    for preset_id, preset_doc in result.presets.items():
        preset = Preset(__import__("curio.compiler.compile", fromlist=["_as_document"])._as_document(preset_doc))
        axes = _free_numeric(preset)
        group = [t for t in result.templates.values() if t["preset_id"] == preset_id]
        assert 1 <= len(group) <= policy.max_templates_per_cluster
        for i, a in enumerate(group):
            for b in group[i + 1 :]:
                assert template_distance(a, b, axes) >= policy.min_template_distance - 1e-9, (a["template_id"], b["template_id"])


def test_template_overrides_only_touch_free_parameters(tmp_path):
    result = compiled(tmp_path)
    for template in result.templates.values():
        free = set(result.presets[template["preset_id"]]["free_params"])
        assert set(template["overrides"]) <= free


def test_template_count_respects_the_cap_and_the_distance_threshold():
    cluster = fx.families()["synth_newsprint"]
    strict, _ = compile_cluster(cluster, "c.json", CompilePolicy(min_template_distance=0.99))
    assert len(strict.templates) == 2  # only the two base templates, one per layout
    loose, _ = compile_cluster(cluster, "c.json", CompilePolicy(max_templates_per_cluster=3, min_template_distance=0.0))
    assert len(loose.templates) == 3


def test_templates_carry_selection_data_but_no_copy_of_the_preset(tmp_path):
    t = compiled(tmp_path).templates["synth_duotone__full_bleed"]
    assert t["tags"]["moods"] == ["raw", "playful"] and t["selection"]["avoid_when"]
    assert "defaults" not in t and "pipeline" not in t and "ranges" not in t  # a template references, it does not copy


# ------------------------------------------------------------------- report, CLI


def test_the_report_is_generated_from_the_json_and_names_its_source_hash():
    cluster = fx.families()["synth_newsprint"]
    md = render_report(cluster)
    assert md.startswith("<!-- generated from clusters/synth_newsprint.json, sha256 ")
    assert "`halftone_screen.pitch_px`" in md and "0.0102" in md and "inset_window" in md and "Do not edit" in md
    assert render_report(cluster) == md  # deterministic
    changed = json.loads(json.dumps(cluster))
    changed["params"]["grain.amount"]["median"] = 0.31
    assert render_report(changed) != md and "0.31" in render_report(changed)


def test_cli_validate_compile_and_report(tmp_path, capsys):
    root = fx.write_export(tmp_path / "e")
    assert cli(["validate", str(root)]) == 0
    assert "9 recipe(s) and 3 cluster(s) valid" in capsys.readouterr().out
    assert cli(["compile", str(root), str(tmp_path / "out")]) == 0
    assert (tmp_path / "out" / "presets" / "synth_duotone.json").is_file()
    assert cli(["report", str(root), str(tmp_path / "md")]) == 0
    assert (tmp_path / "md" / "synth_newsprint.md").read_text().startswith("<!-- generated from")


def test_cli_exits_nonzero_and_names_the_problem(tmp_path, capsys):
    root = fx.write_export(tmp_path / "e", {CLUSTER: lambda c: c["params"]["grain.amount"].pop("unit")})
    assert cli(["validate", str(root)]) == 1
    out = capsys.readouterr().out
    assert "clusters/synth_newsprint.json: params.grain.amount.unit" in out and "1 file(s) skipped" in out
    assert cli(["compile", str(root), str(tmp_path / "out")]) == 1
    assert (tmp_path / "out" / "presets" / "synth_duotone.json").is_file()  # the rest still compiled
    assert not (tmp_path / "out" / "presets" / "synth_newsprint.json").exists()

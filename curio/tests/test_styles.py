from __future__ import annotations

import copy
import json
import os
import time
from pathlib import Path

import numpy as np
import pytest

from curio.core.stacks import run_stack
from curio.style_schema import (
    FALLBACK_PRESETS,
    Preset,
    StyleLibrary,
    fallback_presets,
    merge_presets,
    parse_style_text,
    validate_preset,
    validate_recipe,
)
from curio.tests.fixtures import standin_photo
from curio.tests.golden import check_golden


def good_preset(**overrides) -> dict:
    data = {
        "schema_version": "1.0",
        "preset_id": "test_riso",
        "family": "riso",
        "when_to_use": {"genres": ["gig"], "moods": ["raw"], "subject_types": ["portrait"]},
        "defining_params": ["duotone.shadow", "halftone_screen.pitch_px"],
        "free_params": ["grain.amount", "levels.gamma"],
        "defaults": {
            "duotone": {"shadow": "#1B1340", "highlight": "#FFB36B"},
            "halftone_screen": {"pitch_px": 8},
            "grain": {"amount": 0.3},
            "levels": {"gamma": 1.0},
        },
        "ranges": {
            "duotone": {"shadow": {"choices": ["#1B1340", "#101A3A"]}},
            "halftone_screen": {"pitch_px": [6, 10]},
            "grain": {"amount": [0.1, 0.6]},
            "levels": {"gamma": [0.8, 1.4]},
        },
        "pipeline": [{"op": "levels"}, {"op": "duotone"}, {"op": "halftone_screen"}, {"op": "grain", "optional": True}],
        "layout_rules": {"margin_pct": 6},
        "type_rules": {},
        "texture_rules": {},
    }
    data.update(overrides)
    return data


def good_recipe(**overrides) -> dict:
    data = {
        "schema_version": "1.0",
        "poster_id": "poster_001",
        "style_tags": ["punk", "photocopy"],
        "canvas": {"aspect": "3:4", "margins": {"top": 0.04}},
        "palette": [{"hex": "#111111", "role": "ink", "area_pct": 60}, {"hex": "#F4EFE3", "role": "paper", "area_pct": 40}],
        "color_scheme": "monochrome",
        "typography": [
            {"role": "headline", "category": "sans-serif", "weight": "black", "case": "upper", "tracking": -0.02, "rotation_deg": 0, "size_rel": 0.12, "font_matches": [{"name": "Impact", "confidence": 0.8}]}
        ],
        "photo_pipeline": [{"step": 1, "op": "threshold", "params": {"cutoff": 0.5}, "range": {"cutoff": [0.4, 0.6]}}],
        "halftone": {"type": "AM", "shape": "round", "pitch_px": 8, "angle_deg": 45, "dot_gain": 0.1},
        "texture_layers": [{"type": "paper", "blend": "multiply", "opacity": 0.5, "params": {}}],
        "layer_order": ["background", "photo", "type"],
        "essential_ops": ["threshold"],
        "optional_ops": ["grain"],
    }
    data.update(overrides)
    return data


def write(directory: Path, name: str, content) -> Path:
    path = directory / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
    return path


def errors(issues):
    return [i for i in issues if i.severity == "error"]


def warnings(issues):
    return [i for i in issues if i.severity == "warning"]


def paths(issues):
    return [i.path for i in issues]


def preset(**overrides) -> Preset:
    doc, issues = parse_style_text(json.dumps(good_preset(**overrides)), "x.json")
    assert doc is not None, [str(i) for i in issues]
    return Preset(doc)


# ---------------------------------------------------------------- valid presets


def test_a_valid_preset_loads_and_is_normalised():
    doc, issues = parse_style_text(json.dumps(good_preset()), "riso.json")
    assert doc is not None and doc.kind == "preset" and doc.id == "test_riso" and not errors(issues)
    ids = [s["id"] for s in doc.data["pipeline"]]
    assert ids == ["levels", "duotone", "halftone_screen", "grain"]
    assert doc.data["pipeline"][3]["optional"] is True and doc.data["pipeline"][0]["optional"] is False


def test_unknown_fields_are_preserved_at_every_level_and_never_rejected():
    raw = good_preset(future_field={"a": [1, 2]}, notes="hello")
    raw["when_to_use"]["extra"] = ["kept"]
    raw["pipeline"][0]["note"] = "step note"
    raw["layout_rules"]["new_rule"] = {"deep": True}
    doc, issues = parse_style_text(json.dumps(raw), "x.json")
    assert doc is not None and not errors(issues)
    assert doc.data["future_field"] == {"a": [1, 2]} and doc.data["notes"] == "hello"
    assert doc.data["when_to_use"]["extra"] == ["kept"] and doc.data["pipeline"][0]["note"] == "step note"
    assert doc.data["layout_rules"]["new_rule"] == {"deep": True}


def test_validation_never_mutates_the_input():
    raw = good_preset()
    before = copy.deepcopy(raw)
    validate_preset(raw, "x.json")
    assert raw == before


def test_missing_optional_fields_take_defaults():
    doc, issues = parse_style_text(json.dumps({"schema_version": "1.0", "preset_id": "bare"}), "bare.json")
    assert doc is not None and not errors(issues)
    d = doc.data
    assert d["family"] == "" and d["pipeline"] == [] and d["defaults"] == {} and d["ranges"] == {}
    assert d["when_to_use"] == {"genres": [], "moods": [], "subject_types": []}
    assert d["defining_params"] == [] and d["free_params"] == [] and d["layout_rules"] == {}


def test_a_bom_prefixed_file_still_loads(tmp_path):
    (tmp_path / "bom.json").write_bytes(b"\xef\xbb\xbf" + json.dumps(good_preset()).encode())
    assert "test_riso" in _load(tmp_path).presets


def _load(directory: Path, **kwargs) -> StyleLibrary:
    library = StyleLibrary(directory, **kwargs)
    library.load()
    return library


# -------------------------------------------------------------------- versions


def test_missing_version_is_a_warning_not_an_error():
    raw = good_preset()
    del raw["schema_version"]
    doc, issues = parse_style_text(json.dumps(raw), "x.json")
    assert doc is not None and doc.schema_version == "1.0"
    assert [i.path for i in warnings(issues)] == ["schema_version"]


def test_a_newer_minor_version_loads_with_a_warning():
    doc, issues = parse_style_text(json.dumps(good_preset(schema_version="1.7")), "x.json")
    assert doc is not None and doc.schema_version == "1.7"
    assert any("newer" in i.message for i in warnings(issues))


@pytest.mark.parametrize("version", ["2.0", "0.9", "v1", "1", "", 1.0])
def test_an_unsupported_or_malformed_version_skips_the_file(version):
    doc, issues = parse_style_text(json.dumps(good_preset(schema_version=version)), "x.json")
    assert doc is None and "schema_version" in paths(errors(issues))


# ---------------------------------------------------------- per-file reporting


def test_invalid_json_reports_the_line_and_column():
    doc, issues = parse_style_text('{\n  "preset_id": "a",\n  oops\n}', "broken.json")
    assert doc is None and issues[0].file == "broken.json" and "line 3" in issues[0].path and "invalid JSON" in issues[0].message


@pytest.mark.parametrize("text,fragment", [("[1, 2]", "one JSON object"), ('"text"', "one JSON object"), ("{}", "cannot tell"), ('{"preset_id": "a", "poster_id": "b"}', "ambiguous")])
def test_files_that_are_not_a_style_are_reported(text, fragment):
    doc, issues = parse_style_text(text, "x.json")
    assert doc is None and fragment in issues[0].message


def test_one_bad_file_skips_only_that_file(tmp_path):
    write(tmp_path, "good.json", good_preset(preset_id="good"))
    write(tmp_path, "also_good.json", good_preset(preset_id="also_good"))
    bad = good_preset(preset_id="bad")
    bad["pipeline"][0]["params"] = {"gamma": 99}
    write(tmp_path, "bad_param.json", bad)
    write(tmp_path, "bad_op.json", good_preset(preset_id="bad_op", pipeline=[{"op": "teleport"}]))
    write(tmp_path, "bad_json.json", "{nope")

    lib = _load(tmp_path)
    report = lib.report()
    assert sorted(lib.presets) == ["also_good", "good"]
    assert sorted(report.skipped) == ["bad_json.json", "bad_op.json", "bad_param.json"]
    by_file = {(i.file, i.path) for i in report.errors}
    assert ("bad_param.json", "pipeline[0].params.gamma") in by_file
    assert ("bad_op.json", "pipeline[0].op") in by_file
    assert any(f == "bad_json.json" for f, _ in by_file)


def test_issues_name_the_file_the_field_and_the_problem():
    raw = good_preset()
    raw["pipeline"][1]["params"] = {"shadow": "teal"}
    doc, issues = parse_style_text(json.dumps(raw), "styles/riso.json")
    assert doc is None
    issue = errors(issues)[0]
    assert issue.file == "styles/riso.json" and issue.path == "pipeline[1].params.shadow" and "#RRGGBB" in issue.message
    assert "styles/riso.json" in str(issue) and "pipeline[1].params.shadow" in str(issue)


# ------------------------------------------------------------- preset errors


def _preset_errors(**overrides):
    doc, issues = parse_style_text(json.dumps(good_preset(**overrides)), "x.json")
    return doc, errors(issues), warnings(issues)


def test_missing_or_empty_preset_id_is_an_error():
    for value in (None, "", "   ", 5):
        raw = good_preset()
        raw["preset_id"] = value
        doc, issues = parse_style_text(json.dumps(raw), "x.json")
        # "preset_id" key present, so it is classified as a preset and then rejected
        assert doc is None and "preset_id" in paths(errors(issues)), value


def test_unknown_ops_and_params_are_errors_in_a_preset():
    assert "pipeline[0].op" in paths(_preset_errors(pipeline=[{"op": "sparkle"}])[1])
    doc, errs, _ = _preset_errors(pipeline=[{"op": "levels", "params": {"blackness": 0.1}}])
    assert doc is None and "pipeline[0].params.blackness" in paths(errs)


def test_param_values_are_checked_against_the_op_schema():
    for params, field in (({"gamma": 99}, "gamma"), ({"gamma": "bright"}, "gamma"), ({"channel": "x"}, "channel")):
        doc, errs, _ = _preset_errors(pipeline=[{"op": "levels", "params": params}], defaults={}, ranges={}, defining_params=[], free_params=[])
        assert doc is None and f"pipeline[0].params.{field}" in paths(errs), params


def test_defaults_are_checked_too_because_they_overlay_the_step():
    doc, errs, _ = _preset_errors(defaults={"levels": {"gamma": 99}}, ranges={}, defining_params=[], free_params=["levels.gamma"])
    assert doc is None and any(e.path == "pipeline[0].params.gamma" for e in errs)


@pytest.mark.parametrize(
    "field,value",
    [("when_to_use", []), ("defining_params", "duotone.shadow"), ("pipeline", {"op": "levels"}), ("defaults", [1]), ("layout_rules", "x"), ("family", 5), ("free_params", [1, 2])],
)
def test_wrongly_typed_fields_are_errors(field, value):
    doc, errs, _ = _preset_errors(**{field: value})
    assert doc is None and field in " ".join(paths(errs))


def test_a_parameter_cannot_be_both_defining_and_free():
    doc, errs, _ = _preset_errors(free_params=["duotone.shadow", "grain.amount"])
    assert doc is None and any("both defining and free" in e.message for e in errs)


@pytest.mark.parametrize("bad", [[5, 1], [1], "wide", {"min": 5}, {"choices": []}, {"min": "a", "max": 2}])
def test_malformed_ranges_are_errors(bad):
    raw = good_preset()
    raw["ranges"]["grain"]["amount"] = bad
    doc, issues = parse_style_text(json.dumps(raw), "x.json")
    assert doc is None and any(i.path.startswith("ranges.grain.amount") for i in errors(issues))


def test_a_default_outside_its_own_range_is_an_error():
    raw = good_preset()
    raw["defaults"]["grain"]["amount"] = 0.9
    doc, issues = parse_style_text(json.dumps(raw), "x.json")
    assert doc is None and any("outside its own range" in i.message for i in errors(issues))


def test_step_ids_are_assigned_validated_and_unique():
    doc, _ , _ = _preset_errors(pipeline=[{"op": "grain"}, {"op": "grain"}, {"op": "grain", "id": "fine"}], defaults={}, ranges={}, defining_params=[], free_params=[])
    assert [s["id"] for s in doc.data["pipeline"]] == ["grain", "grain_2", "fine"]
    doc, errs, _ = _preset_errors(pipeline=[{"op": "grain", "id": "a"}, {"op": "blur", "id": "a"}], defaults={}, ranges={}, defining_params=[], free_params=[])
    assert doc is None and any("duplicate step id" in e.message for e in errs)
    doc, errs, _ = _preset_errors(pipeline=[{"op": "grain", "id": "has space"}], defaults={}, ranges={}, defining_params=[], free_params=[])
    assert doc is None and "pipeline[0].id" in paths(errs)


def test_range_and_path_oddities_are_warnings_that_still_load():
    raw = good_preset(free_params=["grain.amount", "nonexistent.thing"], defining_params=["duotone.shadow", "halftone_screen.pitch_px", "levels.black"])
    raw["ranges"]["grain"]["amount"] = [0.0, 5.0]  # beyond the op's own 0..1
    raw["defaults"]["mystery"] = {"x": 1}
    doc, issues = parse_style_text(json.dumps(raw), "x.json")
    assert doc is not None and not errors(issues)
    messages = " | ".join(w.message for w in warnings(issues))
    assert "beyond the op's own limits" in messages and "no range" in messages and "does not match any pipeline" in messages


# --------------------------------------------------------------------- recipes


def test_a_valid_recipe_loads_with_unknown_fields_kept():
    raw = good_recipe(extra_analysis={"confidence": 0.9})
    doc, issues = parse_style_text(json.dumps(raw), "poster.json")
    assert doc is not None and doc.kind == "recipe" and doc.id == "poster_001" and not errors(issues)
    assert doc.data["extra_analysis"] == {"confidence": 0.9} and doc.data["palette"][0]["hex"] == "#111111"


def test_missing_recipe_sections_take_defaults():
    doc, issues = parse_style_text(json.dumps({"schema_version": "1.0", "poster_id": "p"}), "p.json")
    assert doc is not None and not errors(issues)
    assert doc.data["palette"] == [] and doc.data["typography"] == [] and doc.data["halftone"]["pitch_px"] == 0
    assert doc.data["canvas"] == {"aspect": "", "margins": {}} and doc.data["layer_order"] == []


def test_recipe_errors_point_at_the_exact_field():
    raw = good_recipe()
    raw["palette"][1]["hex"] = "paper"
    raw["typography"][0]["font_matches"][0]["confidence"] = 1.7
    raw["typography"][0]["size_rel"] = -1
    raw["texture_layers"][0]["opacity"] = 3
    raw["halftone"]["pitch_px"] = "fine"
    doc, issues = parse_style_text(json.dumps(raw), "poster.json")
    assert doc is None
    assert {"palette[1].hex", "typography[0].font_matches[0].confidence", "typography[0].size_rel", "texture_layers[0].opacity", "halftone.pitch_px"} <= set(paths(errors(issues)))


def test_recipes_with_ops_this_build_lacks_still_load_with_a_warning():
    raw = good_recipe(photo_pipeline=[{"step": 1, "op": "liquify", "params": {}, "range": {}}])
    doc, issues = parse_style_text(json.dumps(raw), "p.json")
    assert doc is not None and any(w.path == "photo_pipeline[0].op" and "kept as data" in w.message for w in warnings(issues))


def test_the_blank_recipe_template_from_the_brief_is_rejected_with_clear_reasons():
    template = {
        "schema_version": "1.0", "poster_id": "", "style_tags": [], "canvas": {"aspect": "", "margins": {}},
        "palette": [{"hex": "", "role": "", "area_pct": 0}], "color_scheme": "",
        "typography": [{"role": "", "category": "", "weight": "", "case": "", "tracking": "", "rotation_deg": 0, "size_rel": 0, "font_matches": [{"name": "", "confidence": 0}]}],
        "photo_pipeline": [{"step": 1, "op": "", "params": {}, "range": {}}], "halftone": {"type": "", "shape": "", "pitch_px": 0, "angle_deg": 0, "dot_gain": 0},
        "texture_layers": [{"type": "", "blend": "", "opacity": 0, "params": {}}], "layer_order": [], "essential_ops": [], "optional_ops": [],
    }
    doc, issues = parse_style_text(json.dumps(template), "template.json")
    assert doc is None and {"poster_id", "palette[0].hex", "photo_pipeline[0].op"} <= set(paths(errors(issues)))


def test_recipe_validation_does_not_mutate_input():
    raw = good_recipe()
    before = copy.deepcopy(raw)
    validate_recipe(raw, "p.json")
    assert raw == before


# ------------------------------------------------------------------- directory


def test_presets_and_recipes_load_together_from_nested_folders(tmp_path):
    write(tmp_path, "presets/riso.json", good_preset())
    write(tmp_path, "recipes/2026/p1.json", good_recipe())
    lib = _load(tmp_path)
    assert list(lib.presets) == ["test_riso"] and list(lib.recipes) == ["poster_001"]
    assert sorted(lib.report().loaded) == ["presets/riso.json", "recipes/2026/p1.json"]


def test_hidden_and_underscore_files_are_ignored(tmp_path):
    write(tmp_path, "_draft.json", good_preset(preset_id="draft"))
    write(tmp_path, ".hidden/x.json", good_preset(preset_id="hidden"))
    write(tmp_path, "notes.txt", "not json")
    write(tmp_path, "ok.json", good_preset())
    assert list(_load(tmp_path).presets) == ["test_riso"]


def test_missing_and_empty_directories_are_fine(tmp_path):
    assert _load(tmp_path / "nowhere").presets == {} and _load(tmp_path).report().loaded == []
    assert StyleLibrary(None).load().loaded == []


def test_duplicate_ids_keep_the_first_file_and_report_the_second(tmp_path):
    write(tmp_path, "a.json", good_preset())
    write(tmp_path, "b.json", good_preset(family="other"))
    lib = _load(tmp_path)
    assert lib.presets["test_riso"].family == "riso"
    report = lib.report()
    assert report.skipped == ["b.json"] and any("duplicate preset id" in i.message and "a.json" in i.message for i in report.errors)


def test_get_preset_error_lists_what_is_loaded(tmp_path):
    write(tmp_path, "a.json", good_preset())
    with pytest.raises(KeyError, match="test_riso"):
        _load(tmp_path).get_preset("missing")


# ------------------------------------------------------------------ hot reload


def _bump(path: Path) -> None:
    """Forces a distinct mtime even on filesystems with coarse timestamps."""
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))


def test_refresh_reports_nothing_when_nothing_changed(tmp_path):
    write(tmp_path, "a.json", good_preset())
    lib = _load(tmp_path)
    assert not lib.refresh()


def test_refresh_picks_up_added_changed_and_removed_files(tmp_path):
    a = write(tmp_path, "a.json", good_preset(preset_id="a"))
    lib = _load(tmp_path)
    assert list(lib.presets) == ["a"]

    write(tmp_path, "b.json", good_preset(preset_id="b"))
    changes = lib.refresh()
    assert changes.added == ["b.json"] and sorted(lib.presets) == ["a", "b"]

    write(tmp_path, "a.json", good_preset(preset_id="a", family="changed"))
    _bump(a)
    changes = lib.refresh()
    assert changes.updated == ["a.json"] and lib.presets["a"].family == "changed"

    (tmp_path / "b.json").unlink()
    changes = lib.refresh()
    assert changes.removed == ["b.json"] and list(lib.presets) == ["a"]


def test_a_file_that_becomes_invalid_is_dropped_and_recovers_when_fixed(tmp_path):
    path = write(tmp_path, "a.json", good_preset(preset_id="a"))
    lib = _load(tmp_path)
    write(tmp_path, "a.json", "{broken")
    _bump(path)
    lib.refresh()
    assert lib.presets == {} and lib.report().skipped == ["a.json"]
    write(tmp_path, "a.json", good_preset(preset_id="a"))
    _bump(path)
    _bump(path)
    lib.refresh()
    assert list(lib.presets) == ["a"] and not lib.report().errors


def test_duplicate_ownership_is_re_resolved_when_the_first_file_goes(tmp_path):
    write(tmp_path, "a.json", good_preset())
    write(tmp_path, "b.json", good_preset(family="second"))
    lib = _load(tmp_path)
    assert lib.presets["test_riso"].family == "riso" and lib.report().skipped == ["b.json"]
    (tmp_path / "a.json").unlink()
    lib.refresh()
    assert lib.presets["test_riso"].family == "second" and lib.report().skipped == []


def test_the_watcher_applies_changes_in_the_background(tmp_path):
    write(tmp_path, "a.json", good_preset(preset_id="a"))
    lib = _load(tmp_path)
    seen = []
    lib.watch(interval=0.05, on_change=seen.append)
    try:
        write(tmp_path, "late.json", good_preset(preset_id="late"))
        deadline = time.time() + 3
        while time.time() < deadline and "late" not in lib.presets:
            time.sleep(0.05)
    finally:
        lib.stop_watching()
    assert "late" in lib.presets and seen and seen[0].added == ["late.json"]


# ------------------------------------------------------------------- resolving


def test_resolve_applies_defaults_over_step_params_and_marks_optional_steps():
    resolved = preset().resolve()
    steps = {s.id: s for s in resolved.steps}
    assert steps["duotone"].params == {"shadow": "#1B1340", "highlight": "#FFB36B"}
    assert steps["halftone_screen"].params["pitch_px"] == 8
    assert steps["grain"].optional and not steps["levels"].optional
    assert resolved.values["grain.amount"] == 0.3 and resolved.log == []


def test_essential_ops_win_over_optional_ops_and_matching_works_by_op_name():
    p = preset(optional_ops=["grain", "levels"], essential_ops=["levels"])
    assert not p.is_essential({"id": "grain", "op": "grain"}) and p.is_essential({"id": "levels", "op": "levels"})
    assert p.resolve(drop=["grain"]).dropped == ["grain"]


def test_resolved_steps_run_through_the_real_ops():
    out = run_stack(standin_photo(48), preset().resolve().to_calls(), seed=5)
    assert out.shape == (48, 48, 3) and np.all(np.isfinite(out))


# ---------------------------------------------------------------------- tuning


def test_free_parameters_are_set_within_range_and_clamped_outside_it():
    resolved = preset().resolve({"grain.amount": 0.5, "levels.gamma": 3.0})
    values = resolved.values
    assert values["grain.amount"] == 0.5 and values["levels.gamma"] == 1.4
    events = {e.path: e for e in resolved.log}
    assert events["grain.amount"].action == "set" and events["levels.gamma"].action == "clamped"
    assert events["levels.gamma"].requested == 3.0 and events["levels.gamma"].applied == 1.4
    assert {s.id: s for s in resolved.steps}["levels"].params["gamma"] == 1.4


def test_defining_parameters_move_only_inside_their_range_and_are_otherwise_rejected():
    ok = preset().resolve({"halftone_screen.pitch_px": 9})
    assert ok.values["halftone_screen.pitch_px"] == 9 and ok.log[0].action == "set"

    outside = preset().resolve({"halftone_screen.pitch_px": 40})
    assert outside.values["halftone_screen.pitch_px"] == 8  # untouched, not clamped
    assert outside.rejected()[0].reason.startswith("outside the defining range")
    assert {s.id: s for s in outside.steps}["halftone_screen"].params["pitch_px"] == 8


def test_a_defining_choice_cannot_leave_its_allowed_values():
    assert preset().resolve({"duotone.shadow": "#101A3A"}).values["duotone.shadow"] == "#101A3A"
    rejected = preset().resolve({"duotone.shadow": "#FF0000"})
    assert rejected.values["duotone.shadow"] == "#1B1340" and rejected.rejected()


def test_a_defining_parameter_without_a_range_is_fixed():
    p = preset(defining_params=["duotone.shadow", "halftone_screen.pitch_px", "levels.black"], free_params=["grain.amount"])
    r = p.resolve({"levels.black": 0.1})
    assert r.rejected() and "no range" in r.rejected()[0].reason


def test_parameters_that_are_not_tunable_are_rejected_and_logged():
    r = preset().resolve({"duotone.highlight": "#FFFFFF", "nonsense.path": 1})
    assert len(r.rejected()) == 2 and all("not a tunable parameter" in e.reason for e in r.rejected())
    assert r.values["duotone.highlight"] == "#FFB36B"


def test_wrongly_typed_overrides_are_rejected_not_coerced():
    r = preset().resolve({"grain.amount": "lots", "levels.gamma": True})
    assert len(r.rejected()) == 2 and r.values["grain.amount"] == 0.3


def test_op_limits_still_apply_when_a_range_is_wider_than_the_op():
    raw = good_preset()
    raw["ranges"]["grain"]["amount"] = [0.0, 5.0]
    doc, _ = parse_style_text(json.dumps(raw), "x.json")
    r = Preset(doc).resolve({"grain.amount": 3.0})
    assert r.values["grain.amount"] == 1.0 and r.log[0].action == "clamped"


def test_nested_overrides_are_accepted():
    assert preset().resolve({"grain": {"amount": 0.45}}).values["grain.amount"] == 0.45


def test_overrides_are_deterministic_and_do_not_leak_between_resolves():
    p = preset()
    a = run_stack(standin_photo(32), p.resolve({"grain.amount": 0.5}).to_calls(), seed=9)
    b = run_stack(standin_photo(32), p.resolve({"grain.amount": 0.5}).to_calls(), seed=9)
    assert np.array_equal(a, b)
    assert p.resolve().values["grain.amount"] == 0.3  # the earlier override did not stick


def test_dropping_optional_steps_works_and_essential_steps_refuse():
    r = preset().resolve(drop=["grain", "levels", "ghost"])
    assert r.dropped == ["grain"] and [s.id for s in r.steps] == ["levels", "duotone", "halftone_screen"]
    reasons = {e.path: e.reason for e in r.rejected()}
    assert "essential" in reasons["levels"] and "no such step" in reasons["ghost"]


# --------------------------------------------------------------------- merging


def _two_presets():
    a = preset()
    raw_b = good_preset(preset_id="other", family="other-family")
    raw_b["defaults"]["grain"]["amount"] = 0.6
    raw_b["defaults"]["levels"]["gamma"] = 1.4
    raw_b["defaults"]["halftone_screen"]["pitch_px"] = 10
    raw_b["pipeline"].append({"op": "vignette", "optional": True})
    raw_b["defaults"]["vignette"] = {"amount": 0.4}
    raw_b["ranges"]["vignette"] = {"amount": [0.0, 0.6]}
    raw_b["free_params"].append("vignette.amount")
    doc, issues = parse_style_text(json.dumps(raw_b), "b.json")
    assert doc is not None, [str(i) for i in issues]
    return a, Preset(doc)


def test_merge_interpolates_free_numeric_defaults_and_logs_each_decision():
    a, b = _two_presets()
    merged, log = merge_presets(a, b, weight=0.5)
    assert merged.defaults["grain.amount"] == pytest.approx(0.45) and merged.defaults["levels.gamma"] == pytest.approx(1.2)
    actions = {(e.path, e.action) for e in log}
    assert ("grain.amount", "blended") in actions and ("levels.gamma", "blended") in actions


def test_merge_never_changes_the_primary_styles_defining_parameters():
    a, b = _two_presets()
    merged, log = merge_presets(a, b, weight=1.0)
    assert merged.defaults["halftone_screen.pitch_px"] == 8 and merged.defining == a.defining
    kept = [e for e in log if e.action == "kept"]
    assert any(e.path == "halftone_screen.pitch_px" and "defining" in e.reason for e in kept)


def test_weight_zero_is_the_primary_and_the_weight_is_validated():
    a, b = _two_presets()
    merged, _ = merge_presets(a, b, weight=0.0)
    assert merged.defaults["grain.amount"] == a.defaults["grain.amount"]
    for bad in (-0.1, 1.1):
        with pytest.raises(ValueError):
            merge_presets(a, b, weight=bad)


def test_merge_holds_blended_values_inside_the_primary_range():
    a, b = _two_presets()
    raw = good_preset(preset_id="wide")
    raw["defaults"]["grain"]["amount"] = 0.6
    raw["ranges"]["grain"]["amount"] = [0.1, 0.6]
    doc, _ = parse_style_text(json.dumps(raw), "w.json")
    narrow = good_preset(preset_id="narrow")
    narrow["ranges"]["grain"]["amount"] = [0.1, 0.35]
    narrow["defaults"]["grain"]["amount"] = 0.3
    narrow_doc, _ = parse_style_text(json.dumps(narrow), "n.json")
    merged, log = merge_presets(Preset(narrow_doc), Preset(doc), weight=1.0)
    assert merged.defaults["grain.amount"] == pytest.approx(0.35)
    assert any(e.action == "clamped" and e.path == "grain.amount" for e in log)


def test_merge_can_adopt_a_step_from_the_secondary_and_it_stays_optional_and_free():
    a, b = _two_presets()
    merged, log = merge_presets(a, b, weight=0.5, adopt_steps=["vignette"])
    ids = [s["id"] for s in merged.steps]
    assert ids[-1] == "vignette" and merged.steps[-1]["optional"] is True
    assert "vignette.amount" in merged.free and merged.ranges["vignette.amount"]["max"] == 0.6
    assert any(e.action == "adopted" for e in log)
    resolved = merged.resolve()
    assert "vignette" in [s.id for s in resolved.steps]
    assert merged.resolve(drop=["vignette"]).dropped == ["vignette"]


def test_adopting_a_clashing_step_id_renames_it():
    a, b = _two_presets()
    merged, _ = merge_presets(a, b, adopt_steps=["grain"])
    assert [s["id"] for s in merged.steps].count("grain") == 1 and merged.steps[-1]["id"] == "grain_other"


def test_adopting_a_missing_step_raises():
    a, b = _two_presets()
    with pytest.raises(ValueError, match="no step"):
        merge_presets(a, b, adopt_steps=["teleport"])


def test_merge_is_recorded_on_the_result_and_the_result_is_runnable():
    a, b = _two_presets()
    merged, _ = merge_presets(a, b, weight=0.3, adopt_steps=["vignette"])
    assert merged.id == "test_riso+other" and merged.data["merged_from"] == {"primary": "test_riso", "secondary": "other", "weight": 0.3, "adopted_steps": ["vignette"]}
    out = run_stack(standin_photo(40), merged.resolve().to_calls(), seed=2)
    assert out.shape == (40, 40, 3)
    assert a.defaults["grain.amount"] == 0.3  # the originals are untouched


# ------------------------------------------------------------------- fallbacks


def test_the_fallback_presets_are_valid_and_few():
    presets = fallback_presets()
    assert 2 <= len(presets) <= 3 and len({p.id for p in presets}) == len(presets)
    for p in presets:
        assert p.id.startswith("fallback_") and p.tunable_paths()


def test_fallbacks_exist_only_when_asked_for(tmp_path):
    assert _load(tmp_path).presets == {}
    assert len(_load(tmp_path, include_fallbacks=True).presets) == len(FALLBACK_PRESETS)


def test_every_fallback_preset_runs_on_a_stand_in_photo_and_looks_different():
    outputs = {}
    for p in fallback_presets():
        resolved = p.resolve()
        outputs[p.id] = run_stack(standin_photo(64), resolved.to_calls(), seed=7)
        assert np.all(np.isfinite(outputs[p.id])) and not resolved.log
    ids = list(outputs)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            assert np.abs(outputs[ids[i]] - outputs[ids[j]]).mean() > 0.02


@pytest.mark.parametrize("preset_id", [p["preset_id"] for p in FALLBACK_PRESETS])
def test_fallback_presets_golden(preset_id, update_golden):
    p = next(x for x in fallback_presets() if x.id == preset_id)
    check_golden(f"preset__{preset_id}", run_stack(standin_photo(96), p.resolve().to_calls(), seed=20260101), update_golden)


def test_fallback_defining_parameters_hold_when_the_director_pushes_them():
    p = next(x for x in fallback_presets() if x.id == "fallback_mono_halftone")
    r = p.resolve({"halftone_screen.pitch_px": 40, "halftone_screen.angle_deg": 90, "halftone_screen.dot_gain": 0.9, "grain.amount": 0.9})
    assert r.values["halftone_screen.pitch_px"] == 8.0 and r.values["halftone_screen.angle_deg"] == 45.0  # defining: held
    assert r.values["halftone_screen.dot_gain"] == 0.3 and r.values["grain.amount"] == 0.5  # free: clamped to range
    assert len(r.rejected()) == 2

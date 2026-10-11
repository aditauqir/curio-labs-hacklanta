"use client";

import { useCallback, useEffect, useState, type Dispatch } from "react";
import { askCoach, CoachError, type CoachReply } from "@/lib/coach-client";
import type { DesignState } from "@/lib/design-types";
import type { CopyKey, StudioAction } from "@/lib/design-state";
import { colorPalettes, directionConfigs, directionOrder, fontPairs } from "@/lib/design-presets";
import { exportPoster } from "@/lib/export";
import {
  createPosterLayerEdit,
  type PosterEdits,
  type PosterLayerEdit,
  type PosterTool,
} from "@/lib/poster-editor";
import { Poster } from "./poster";
import {
  GridIcon,
  PanelRightIcon,
  ResetIcon,
  SlidersIcon,
  SparkleIcon,
} from "./icons";
import { ColorField, Field, SegmentedControl, inputClass } from "./ui";

type InspectorTab = "layers" | "reference";

const COPY_FIELDS: { key: CopyKey; label: string }[] = [
  { key: "venue", label: "Venue" },
  { key: "subtitle", label: "Subtitle" },
  { key: "date", label: "Date" },
  { key: "time", label: "Time" },
  { key: "footer", label: "Footer" },
];

type TextLayerKey = Exclude<CopyKey, "projectName">;

const TEXT_LAYERS: { key: TextLayerKey; label: string }[] = [
  { key: "headline", label: "Headline" },
  { key: "venue", label: "Venue" },
  { key: "subtitle", label: "Subtitle" },
  { key: "date", label: "Date" },
  { key: "time", label: "Time" },
  { key: "footer", label: "Footer" },
];

function writeClipboard(value: string) {
  if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
    return Promise.resolve(false);
  }

  return navigator.clipboard
    .writeText(value)
    .then(() => true)
    .catch(() => false);
}

function textKeyForLayer(id: string | null): TextLayerKey | null {
  if (!id) return null;
  if (id.startsWith("headline-")) return "headline";
  return TEXT_LAYERS.some((layer) => layer.key === id) ? (id as TextLayerKey) : null;
}

export function DesignCanvas({
  design,
  dispatch,
  posterEdits,
  selectedLayerId,
  activeTool,
  onToolChange,
  onSelectLayer,
  onChangeLayer,
  onDeleteLayer,
  onToggleInspector,
}: {
  design: DesignState;
  dispatch: Dispatch<StudioAction>;
  posterEdits: PosterEdits;
  selectedLayerId: string | null;
  activeTool: PosterTool;
  onToolChange: (tool: PosterTool) => void;
  onSelectLayer: (id: string | null) => void;
  onChangeLayer: (id: string, patch: Partial<PosterLayerEdit>) => void;
  onDeleteLayer: (id: string) => void;
  onToggleInspector?: (tab?: InspectorTab) => void;
}) {
  const [coach, setCoach] = useState<CoachReply | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [canvasStatus, setCanvasStatus] = useState<string | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [editStatus, setEditStatus] = useState("Nothing selected");

  const selectedEdit = selectedLayerId
    ? { ...createPosterLayerEdit(), ...(posterEdits[selectedLayerId] ?? {}) }
    : null;
  const selectedTextLayer = textKeyForLayer(selectedLayerId);

  const selectedText = selectedTextLayer ? design[selectedTextLayer] : "";
  const selectedTextLabel =
    TEXT_LAYERS.find((layer) => layer.key === selectedTextLayer)?.label ?? "text";

  function selectLayer(id: string | null) {
    onSelectLayer(id);
    const nextTextLayer = textKeyForLayer(id);
    setEditStatus(nextTextLayer ? `Selected ${TEXT_LAYERS.find((layer) => layer.key === nextTextLayer)?.label}` : id ? `Selected ${id}` : "Nothing selected");
  }

  function editTextLayer(id: string) {
    selectLayer(id);
    setPropertiesOpen(true);
  }

  const copySelectedText = useCallback(async () => {
    if (!selectedTextLayer || !selectedText) return;
    const copied = await writeClipboard(selectedText);
    setEditStatus(copied ? `Copied ${selectedTextLabel}` : "Copy unavailable");
  }, [selectedText, selectedTextLabel, selectedTextLayer]);

  const cutSelectedText = useCallback(async () => {
    if (!selectedTextLayer || !selectedText) return;
    const copied = await writeClipboard(selectedText);
    if (!copied) {
      setEditStatus("Cut unavailable");
      return;
    }
    dispatch({ type: "setCopy", key: selectedTextLayer, value: "" });
    setEditStatus(`Cut ${selectedTextLabel}`);
  }, [dispatch, selectedText, selectedTextLabel, selectedTextLayer]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editingField = target?.matches("input, textarea, select, [contenteditable='true']");

      if (event.key === "Escape") {
        onSelectLayer(null);
        setEditStatus("Nothing selected");
        return;
      }

      if (editingField || !selectedTextLayer || !(event.metaKey || event.ctrlKey)) return;

      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copySelectedText();
      }
      if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        void cutSelectedText();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copySelectedText, cutSelectedText, onSelectLayer, selectedTextLayer]);

  async function checkLayout() {
    setChecking(true);
    setCoachError(null);
    try {
      setCoach(await askCoach({ design, question: "Check the hierarchy and placement of this poster." }));
    } catch (error) {
      setCoachError(
        error instanceof CoachError && error.code === "not_configured"
          ? "Layout review is not available right now."
          : "Layout review could not finish right now.",
      );
    } finally {
      setChecking(false);
    }
  }

  function restylePoster() {
    const currentIndex = directionOrder.indexOf(design.direction);
    const nextDirection = directionOrder[(currentIndex + 1) % directionOrder.length];
    dispatch({ type: "setDirection", direction: nextDirection });
    setCanvasStatus(`Direction: ${directionConfigs[nextDirection].label}`);
  }

  function shufflePalette() {
    const currentIndex = colorPalettes.findIndex(
      (palette) => palette.colors.background === design.colors.background,
    );
    const nextPalette = colorPalettes[(currentIndex + 1) % colorPalettes.length];
    dispatch({ type: "setPalette", id: nextPalette.id });
    setCanvasStatus(`Palette: ${nextPalette.name}`);
  }

  async function exportCanvas() {
    setExporting(true);
    setCanvasStatus("Exporting PNG...");
    try {
        await exportPoster(design, "png", posterEdits);
      setCanvasStatus("PNG downloaded");
    } catch {
      setCanvasStatus("Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section aria-label="Design canvas" className="design-canvas">
      <header className="design-canvas-header">
        <div className="design-canvas-heading">
          <span className="design-canvas-live-dot" aria-hidden="true" />
          <div>
            <p className="studio-eyebrow">Poster</p>
            <p className="design-canvas-title">{design.projectName || "Untitled poster"}</p>
          </div>
        </div>

        <SegmentedControl
          label="Visual direction"
          value={design.direction}
          options={directionOrder.map((direction) => ({
            value: direction,
            label: directionConfigs[direction].label,
          }))}
          onChange={(direction) => dispatch({ type: "setDirection", direction })}
          tone="dark"
        />

        <div className="design-canvas-header-actions">
          <button
            type="button"
            className={`studio-tool-button ${propertiesOpen ? "is-active" : ""}`}
            onClick={() => setPropertiesOpen((open) => !open)}
            aria-pressed={propertiesOpen}
          >
            <SlidersIcon />
            <span>Properties</span>
          </button>
          {onToggleInspector ? (
            <button
              type="button"
              className="studio-tool-button studio-inspector-toggle"
              onClick={() => onToggleInspector("reference")}
            >
              <PanelRightIcon />
              <span>References</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="design-canvas-edit-toolbar" aria-label="Text editing controls">
        <label className="studio-edit-field">
          <span>Text layer</span>
          <select
            aria-label="Select text layer"
            className="studio-edit-select"
            value={selectedTextLayer ?? ""}
            onChange={(event) => {
              const value = event.target.value as TextLayerKey | "";
              selectLayer(value ? (value === "headline" ? "headline-0" : value) : null);
            }}
          >
            <option value="">Select text</option>
            {TEXT_LAYERS.map((layer) => (
              <option key={layer.key} value={layer.key}>
                {layer.label}
              </option>
            ))}
          </select>
        </label>
        <div className="studio-edit-actions">
          <button
            type="button"
            className="studio-edit-button"
            onClick={() => {
              onSelectLayer(null);
              setEditStatus("Nothing selected");
            }}
            disabled={!selectedTextLayer}
          >
            Deselect
          </button>
          <button
            type="button"
            className="studio-edit-button"
            onClick={() => void copySelectedText()}
            disabled={!selectedTextLayer || !selectedText}
          >
            Copy
          </button>
          <button
            type="button"
            className="studio-edit-button studio-edit-button-primary"
            onClick={() => void cutSelectedText()}
            disabled={!selectedTextLayer || !selectedText}
          >
            Cut
          </button>
        </div>
        <span className="studio-edit-status" role="status" aria-live="polite">
          {editStatus}
        </span>
        <span className="studio-edit-shortcuts">⌘/Ctrl C · ⌘/Ctrl X · Esc</span>
      </div>

      <div className="design-canvas-main">
        <nav className="design-canvas-tool-rail" aria-label="Canvas tools">
          <button
            type="button"
            className={`studio-rail-tool ${activeTool === "select" ? "is-active" : ""}`}
            aria-label="Select and move tool"
            title="Select and move"
            onClick={() => onToolChange("select")}
          >
            <GridIcon />
          </button>
          <button
            type="button"
            className={`studio-rail-tool studio-rail-text-tool ${activeTool === "text" ? "is-active" : ""}`}
            aria-label="Text tool"
            title="Text tool"
            onClick={() => onToolChange("text")}
          >
            T
          </button>
          <button
            type="button"
            className={`studio-rail-tool ${propertiesOpen ? "is-active" : ""}`}
            aria-label="Toggle poster properties"
            title="Toggle poster properties"
            onClick={() => setPropertiesOpen((open) => !open)}
          >
            <SlidersIcon />
          </button>
          <span className="studio-rail-divider" aria-hidden="true" />
          <button
            type="button"
            className={`studio-rail-tool ${checking ? "is-active" : ""}`}
            aria-label="Review layout"
            title="Review layout"
            onClick={() => void checkLayout()}
            disabled={checking}
          >
            <SparkleIcon />
          </button>
          <button
            type="button"
            className="studio-rail-tool"
            aria-label="Reset design"
            title="Reset design"
            onClick={() => dispatch({ type: "resetDesign" })}
          >
            <ResetIcon />
          </button>
        </nav>

        <div className="design-canvas-stage">
          <div className="design-canvas-poster-frame">
            <div className="design-canvas-poster-meta">
              <span>Poster / live</span>
              <span>1080 × 1350</span>
            </div>
            <div className="design-canvas-poster">
              <Poster
                design={design}
                edits={posterEdits}
                selectedLayerId={selectedLayerId}
                activeTool={activeTool}
                onSelectLayer={selectLayer}
                onChangeLayer={onChangeLayer}
                onEditText={editTextLayer}
                onDeleteLayer={onDeleteLayer}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="studio-canvas-action-bar" aria-label="Canvas actions">
        <button
          type="button"
          onClick={() => onToggleInspector?.("reference")}
          disabled={!onToggleInspector}
        >
          Inspire
        </button>
        <button type="button" onClick={restylePoster}>
          Restyle
        </button>
        <button type="button" onClick={shufflePalette}>
          Shuffle
        </button>
        <button
          type="button"
          onClick={() => onToggleInspector?.("layers")}
          disabled={!onToggleInspector}
        >
          Layers
        </button>
        <button type="button" onClick={() => void exportCanvas()} disabled={exporting}>
          {exporting ? "Exporting" : "Export"}
        </button>
      </div>

      <footer className="design-canvas-footer">
        <div className="design-canvas-footer-meta">
          <span className="design-canvas-footer-status" aria-hidden="true" />
          <span>
            {checking
              ? "Reviewing layout"
              : canvasStatus ?? (coach ? "Layout review ready" : "Saved")}
          </span>
        </div>
        <div className="design-canvas-footer-info" aria-label="Document information">
          <span>RGB / 8-bit</span>
          <span>100%</span>
          <span>1080 × 1350</span>
        </div>
      </footer>

      {coach ? (
        <div className="studio-coach-card">
          <div className="studio-coach-heading">
            <span>Layout review</span>
            <span>{coach.focus}</span>
          </div>
          <p>{coach.feedback}</p>
          {coach.assets.length > 0 ? (
            <small>Related references: {coach.assets.map((asset) => asset.name).join(", ")}</small>
          ) : null}
        </div>
      ) : null}
      {coachError ? <p className="studio-coach-error" role="status">{coachError}</p> : null}

      {propertiesOpen ? (
        <section className="studio-properties-panel" aria-label="Poster properties">
          <div className="studio-properties-heading">
            <div>
              <p className="studio-eyebrow">Poster properties</p>
              <p>Fine-tune the poster in place.</p>
            </div>
            <button type="button" className="studio-footer-button" onClick={() => setPropertiesOpen(false)}>
              Done
            </button>
          </div>

          {selectedLayerId && selectedEdit ? (
            <div className="studio-transform-panel" aria-label="Selected layer controls">
              <div className="studio-transform-heading">
                <span>Selected layer</span>
                <strong>{selectedLayerId}</strong>
              </div>
              <div className="studio-transform-grid">
                <label>
                  <span>X</span>
                  <input
                    type="number"
                    value={Math.round(selectedEdit.x)}
                    onChange={(event) => onChangeLayer(selectedLayerId, { x: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>Y</span>
                  <input
                    type="number"
                    value={Math.round(selectedEdit.y)}
                    onChange={(event) => onChangeLayer(selectedLayerId, { y: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>Scale</span>
                  <input
                    type="number"
                    min="0.05"
                    max="12"
                    step="0.05"
                    value={selectedEdit.scale}
                    onChange={(event) => onChangeLayer(selectedLayerId, { scale: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>Rotate</span>
                  <input
                    type="number"
                    min="-360"
                    max="360"
                    value={Math.round(selectedEdit.rotation)}
                    onChange={(event) => onChangeLayer(selectedLayerId, { rotation: Number(event.target.value) })}
                  />
                </label>
              </div>
              <label className="studio-opacity-control">
                <span>Opacity {Math.round(selectedEdit.opacity * 100)}%</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={selectedEdit.opacity}
                  onChange={(event) => onChangeLayer(selectedLayerId, { opacity: Number(event.target.value) })}
                />
              </label>
              <div className="studio-transform-actions">
                <button type="button" onClick={() => onChangeLayer(selectedLayerId, { visible: !selectedEdit.visible })}>
                  {selectedEdit.visible ? "Hide" : "Show"}
                </button>
                <button type="button" onClick={() => onChangeLayer(selectedLayerId, { locked: !selectedEdit.locked })}>
                  {selectedEdit.locked ? "Unlock" : "Lock"}
                </button>
                <button type="button" onClick={() => onChangeLayer(selectedLayerId, createPosterLayerEdit())}>
                  Reset transform
                </button>
              </div>
            </div>
          ) : null}

          {selectedTextLayer ? (
            <div className="studio-selected-text-editor">
              <Field label={`Edit ${selectedTextLabel}`} hint="Edit directly on the selected layer.">
                <textarea
                  rows={2}
                  maxLength={selectedTextLayer === "headline" ? 80 : 200}
                  value={selectedText}
                  onChange={(event) => dispatch({ type: "setCopy", key: selectedTextLayer, value: event.target.value })}
                  className={`${inputClass} resize-none`}
                />
              </Field>
            </div>
          ) : null}

          <div className="studio-properties-grid">
            <Field label="Headline" hint="Press Enter for a new line.">
              <textarea
                rows={2}
                maxLength={80}
                value={design.headline}
                onChange={(event) =>
                  dispatch({ type: "setCopy", key: "headline", value: event.target.value })
                }
                className={`${inputClass} resize-none`}
              />
            </Field>

            <div className="studio-properties-options">
              <Field label="Font pairing" hint="Applies to the whole poster.">
                <select
                  aria-label="Font pairing"
                  className={inputClass}
                  value={design.typography.id}
                  onChange={(event) => dispatch({ type: "setFontPair", id: event.target.value })}
                >
                  {fontPairs.map((pair) => (
                    <option key={pair.id} value={pair.id}>
                      {pair.name}
                    </option>
                  ))}
                </select>
              </Field>
              <ColorField
                label="Accent color"
                value={design.colors.accent}
                onChange={(value) => dispatch({ type: "setColor", key: "accent", value })}
              />
              <div className="grid gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Alignment</span>
                <SegmentedControl
                  label="Text alignment"
                  value={design.layout.alignment}
                  options={[
                    { value: "left", label: "Left" },
                    { value: "center", label: "Center" },
                    { value: "right", label: "Right" },
                  ]}
                  onChange={(value) => dispatch({ type: "setAlignment", value })}
                />
              </div>
              <div className="grid gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Spacing</span>
                <SegmentedControl
                  label="Layout spacing"
                  value={design.layout.spacing}
                  options={[
                    { value: "compact", label: "Compact" },
                    { value: "normal", label: "Normal" },
                    { value: "spacious", label: "Spacious" },
                  ]}
                  onChange={(value) => dispatch({ type: "setSpacing", value })}
                />
              </div>
            </div>
          </div>

          <details className="studio-copy-details">
            <summary>Edit poster copy</summary>
            <div className="studio-copy-grid">
              {COPY_FIELDS.map((field) => (
                <Field key={field.key} label={field.label}>
                  <input
                    type="text"
                    value={design[field.key]}
                    onChange={(event) =>
                      dispatch({ type: "setCopy", key: field.key, value: event.target.value })
                    }
                    className={inputClass}
                  />
                </Field>
              ))}
            </div>
          </details>
        </section>
      ) : null}
    </section>
  );
}

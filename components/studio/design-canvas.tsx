"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { askCoach, CoachError, type CoachReply } from "@/lib/coach-client";
import type { DesignState } from "@/lib/design-types";
import type { CopyKey, StudioAction } from "@/lib/design-state";
import { colorPalettes, directionConfigs, directionOrder, fontPairs } from "@/lib/design-presets";
import { exportPoster } from "@/lib/export";
import { getPosterDimensions } from "@/lib/poster-layout";
import {
  createPosterLayerEdit,
  type PosterEdits,
  type PosterLayerEdit,
  type PosterTool,
} from "@/lib/poster-editor";
import { Poster, type BrushStroke } from "./poster";
import {
  CopyIcon,
  CropIcon,
  DropIcon,
  EraserIcon,
  ExportIcon,
  HandIcon,
  LayersIcon,
  MagicWandIcon,
  MinusIcon,
  MoveIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PaintBrushIcon,
  PaintBucketIcon,
  PaletteIcon,
  PlusIcon,
  RectangleSelectIcon,
  ResetIcon,
  RedoIcon,
  RestyleIcon,
  SaveIcon,
  ScissorsIcon,
  SlidersIcon,
  SparkleIcon,
  StampIcon,
  ShuffleIcon,
  TextIcon,
  TrashIcon,
} from "./icons";
import { ColorField, Field, SegmentedControl, inputClass } from "./ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FloatingButtonGroup } from "@/components/ui/floating-button-group";
import type { ImportedReference } from "@/lib/image-import-client";

type InspectorTab = "layers" | "reference";
type CanvasActionDialog = "reset-design" | "reset-project" | "delete-layer" | "save";
type ToolOptions = "brush" | "fill" | "colors" | "palette" | null;

const MIN_CANVAS_SCALE = 0.5;
const MAX_CANVAS_SCALE = 3;

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
  selectedPaletteId,
  dispatch,
  posterEdits,
  layerOrder,
  selectedLayerId,
  importedReference,
  activeTool,
  onToolChange,
  onSelectLayer,
  onChangeLayer,
  onDeleteLayer,
  onResetProject,
  onSaveProject,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  referenceOpen,
  layersOpen,
  onToggleInspector,
}: {
  design: DesignState;
  selectedPaletteId: string | null;
  dispatch: Dispatch<StudioAction>;
  posterEdits: PosterEdits;
  layerOrder: string[];
  selectedLayerId: string | null;
  importedReference: ImportedReference | null;
  activeTool: PosterTool;
  onToolChange: (tool: PosterTool) => void;
  onSelectLayer: (id: string | null) => void;
  onChangeLayer: (id: string, patch: Partial<PosterLayerEdit>) => void;
  onDeleteLayer: (id: string) => void;
  onResetProject: () => void;
  onSaveProject: () => Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  referenceOpen?: boolean;
  layersOpen?: boolean;
  onToggleInspector?: (tab?: InspectorTab) => void;
}) {
  const [coach, setCoach] = useState<CoachReply | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [canvasStatus, setCanvasStatus] = useState<string | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [toolOptions, setToolOptions] = useState<ToolOptions>(null);
  const [actionDialog, setActionDialog] = useState<CanvasActionDialog | null>(null);
  const [pendingLayerId, setPendingLayerId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [editStatus, setEditStatus] = useState("Nothing selected");
  const [canvasScale, setCanvasScale] = useState(1);
  const [brushSize, setBrushSize] = useState(24);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushStrokes, setBrushStrokes] = useState<BrushStroke[]>([]);
  const touchPointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);

  const selectedEdit = selectedLayerId
    ? { ...createPosterLayerEdit(), ...(posterEdits[selectedLayerId] ?? {}) }
    : null;
  const selectedTextLayer = textKeyForLayer(selectedLayerId);

  const selectedText = selectedTextLayer ? design[selectedTextLayer] : "";
  const posterDimensions = getPosterDimensions(design);
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

  function applyPalette(id: string) {
    const palette = colorPalettes.find((item) => item.id === id);
    if (!palette) return;
    dispatch({ type: "setPalette", id });
    setToolOptions(null);
    setCanvasStatus(`Palette: ${palette.name}`);
  }

  function openActionDialog(action: CanvasActionDialog, layerId: string | null = null) {
    if (action === "delete-layer" && !layerId) return;
    setPendingLayerId(layerId);
    setActionDialog(action);
  }

  async function confirmActionDialog() {
    if (!actionDialog || actionBusy) return;
    setActionBusy(true);

    try {
      if (actionDialog === "reset-design") {
        dispatch({ type: "resetDesign" });
        setCanvasScale(1);
        setBrushStrokes([]);
        setCanvasStatus("Design reset");
      } else if (actionDialog === "reset-project") {
        onResetProject();
        setCanvasScale(1);
        setBrushStrokes([]);
        setCanvasStatus("Project reset");
      } else if (actionDialog === "delete-layer" && pendingLayerId) {
        onDeleteLayer(pendingLayerId);
        setCanvasStatus("Layer hidden");
      } else if (actionDialog === "save") {
        await onSaveProject();
        setCanvasStatus("Saved");
      }

      setActionDialog(null);
      setPendingLayerId(null);
    } finally {
      setActionBusy(false);
    }
  }

  const actionDialogCopy =
    actionDialog === "reset-design"
      ? {
          title: "Reset design?",
          description: "Restore the poster to its original visual direction. Your conversation stays intact.",
          confirm: "Reset design",
          variant: "destructive" as const,
        }
      : actionDialog === "reset-project"
        ? {
            title: "Reset project?",
            description: "This removes the current design changes and conversation from this workspace.",
            confirm: "Reset project",
            variant: "destructive" as const,
          }
        : actionDialog === "delete-layer"
          ? {
              title: "Hide layer?",
              description: "The layer will leave the poster but remain in Layers so you can restore it later.",
              confirm: "Hide layer",
              variant: "destructive" as const,
            }
          : actionDialog === "save"
            ? {
                title: "Save project?",
                description: "Save the current design and conversation to this workspace.",
                confirm: "Save project",
                variant: "default" as const,
              }
            : null;

  function applyCanvasScale(value: number, announce = false) {
    const nextScale = Number(Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, value)).toFixed(2));
    setCanvasScale(nextScale);
    if (announce) setCanvasStatus(`Canvas zoom ${Math.round(nextScale * 100)}%`);
  }

  function adjustCanvasScale(delta: number) {
    applyCanvasScale(canvasScale + delta, true);
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    applyCanvasScale(canvasScale * Math.exp(-delta / 320));
  }

  function touchDistance() {
    const points = Array.from(touchPointers.current.values());
    if (points.length < 2) return 0;
    return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    event.stopPropagation();
    touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointers.current.size === 2) {
      pinchStart.current = { distance: Math.max(1, touchDistance()), scale: canvasScale };
    }
  }

  function handleStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || !touchPointers.current.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointers.current.size < 2 || !pinchStart.current) return;
    applyCanvasScale(pinchStart.current.scale * (touchDistance() / pinchStart.current.distance));
  }

  function handleStagePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    event.stopPropagation();
    touchPointers.current.delete(event.pointerId);
    if (touchPointers.current.size < 2) pinchStart.current = null;
  }

  async function exportCanvas() {
    setExporting(true);
    setCanvasStatus("Exporting PNG...");
    try {
        await exportPoster(design, "png", posterEdits, layerOrder);
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

        <FloatingButtonGroup
          label="Canvas panels"
          size="sm"
          className="design-canvas-header-actions"
          items={[
            {
              id: "properties",
              label: "Properties",
              icon: <SlidersIcon />,
              iconOnly: true,
              pressed: propertiesOpen,
              onSelect: () => setPropertiesOpen((open) => !open),
            },
            ...(onToggleInspector
              ? [
                  {
                    id: "references",
                    label: "References",
                    icon: <PanelRightIcon />,
                    iconOnly: true,
                    onSelect: () => onToggleInspector("reference"),
                  },
                ]
              : []),
          ]}
        />
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
        <FloatingButtonGroup
          label="Text editing actions"
          size="sm"
          className="studio-edit-actions"
          items={[
            {
              id: "deselect",
              label: "Deselect",
              disabled: !selectedTextLayer,
              onSelect: () => {
                onSelectLayer(null);
                setEditStatus("Nothing selected");
              },
            },
            {
              id: "copy",
              label: "Copy",
              disabled: !selectedTextLayer || !selectedText,
              onSelect: () => void copySelectedText(),
            },
            {
              id: "cut",
              label: "Cut",
              disabled: !selectedTextLayer || !selectedText,
              onSelect: () => void cutSelectedText(),
            },
          ]}
        />
        <span className="studio-edit-status sr-only" role="status" aria-live="polite">
          {editStatus}
        </span>
        <span className="studio-edit-shortcuts">⌘/Ctrl C · ⌘/Ctrl X · Esc</span>
      </div>

      <div className="design-canvas-main">
        <div className="design-canvas-tool-dock">
          <FloatingButtonGroup
          label="Canvas tools"
          variant="floating"
          orientation="vertical"
          iconOnly
          showHighlight={false}
          className="design-canvas-tool-rail"
          items={[
            {
              id: "move",
              label: "Select and move",
              icon: <MoveIcon />,
              pressed: activeTool === "select",
              onSelect: () => onToolChange("select"),
            },
            {
              id: "rectangle-select",
              label: "Rectangle select",
              icon: <RectangleSelectIcon />,
              pressed: activeTool === "rectangle-select",
              onSelect: () => {
                onToolChange("rectangle-select");
                setCanvasStatus("Rectangle select");
              },
            },
            {
              id: "magic-wand",
              label: "Review layout",
              icon: <MagicWandIcon />,
              disabled: checking,
              pressed: checking,
              onSelect: () => void checkLayout(),
            },
            { type: "separator", id: "canvas-select-divider" },
            {
              id: "crop",
              label: "Resize selected layer",
              icon: <CropIcon />,
              pressed: activeTool === "crop",
              onSelect: () => {
                onToolChange("crop");
                setPropertiesOpen(true);
                setCanvasStatus("Resize selected layer");
              },
            },
            {
              id: "brush",
              label: "Brush options",
              icon: <PaintBrushIcon />,
              pressed: activeTool === "brush" || toolOptions === "brush",
              onSelect: () => {
                setPropertiesOpen(false);
                setToolOptions((current) => (current === "brush" ? null : "brush"));
                onToolChange("brush");
                setCanvasStatus("Brush options");
              },
            },
            {
              id: "eraser",
              label: "Hide selected layer",
              icon: <EraserIcon />,
              pressed: activeTool === "eraser",
              onSelect: () => onToolChange("eraser"),
            },
            {
              id: "stamp",
              label: "Copy selected text",
              icon: <StampIcon />,
              disabled: !selectedTextLayer || !selectedText,
              onSelect: () => void copySelectedText(),
            },
            {
              id: "dropper",
              label: "Sample poster color",
              icon: <DropIcon />,
              pressed: activeTool === "dropper",
              onSelect: () => onToolChange("dropper"),
            },
            {
              id: "fill",
              label: "Fill options",
              icon: <PaintBucketIcon />,
              pressed: activeTool === "fill" || toolOptions === "fill",
              onSelect: () => {
                setPropertiesOpen(false);
                setToolOptions((current) => (current === "fill" ? null : "fill"));
                onToolChange("fill");
                setCanvasStatus("Fill options");
              },
            },
            {
              id: "palette",
              label: "Color palettes",
              icon: <PaletteIcon />,
              pressed: toolOptions === "palette",
              onSelect: () => setToolOptions((current) => (current === "palette" ? null : "palette")),
            },
            {
              id: "color-properties",
              label: "Open color properties",
              icon: <PaletteIcon />,
              pressed: propertiesOpen,
              onSelect: () => {
                setToolOptions(null);
                setPropertiesOpen(true);
              },
            },
            {
              id: "copy",
              label: "Copy selected text",
              icon: <CopyIcon />,
              disabled: !selectedTextLayer || !selectedText,
              onSelect: () => void copySelectedText(),
            },
            {
              id: "text",
              label: "Text tool",
              icon: <TextIcon />,
              pressed: activeTool === "text",
              onSelect: () => onToolChange("text"),
            },
            { type: "separator", id: "canvas-navigation-divider" },
            {
              id: "hand",
              label: "Hand tool",
              icon: <HandIcon />,
              pressed: activeTool === "hand",
              onSelect: () => onToolChange("hand"),
            },
            {
              id: "zoom-out",
              label: "Zoom out",
              icon: <MinusIcon />,
              disabled: canvasScale <= MIN_CANVAS_SCALE,
              onSelect: () => adjustCanvasScale(-0.1),
            },
            {
              id: "zoom-level",
              label: `Canvas zoom ${Math.round(canvasScale * 100)}% — reset to 100%`,
              icon: <span className="studio-zoom-level">{Math.round(canvasScale * 100)}%</span>,
              onSelect: () => applyCanvasScale(1, true),
            },
            {
              id: "zoom-in",
              label: "Zoom in",
              icon: <PlusIcon />,
              disabled: canvasScale >= MAX_CANVAS_SCALE,
              onSelect: () => adjustCanvasScale(0.1),
            },
            {
              id: "reset",
              label: "Reset design",
              icon: <ResetIcon />,
              onSelect: () => {
                openActionDialog("reset-design");
              },
            },
          ]}
          />
          <div className="studio-color-control" aria-label="Current colors">
            <button
              type="button"
              className="studio-color-stack studio-color-stack-foreground"
              aria-label={`Foreground color ${design.colors.accent}`}
              aria-pressed={toolOptions === "colors"}
              style={{ backgroundColor: design.colors.accent }}
              onClick={() => setToolOptions((current) => (current === "colors" ? null : "colors"))}
            />
            <button
              type="button"
              className="studio-color-stack studio-color-stack-background"
              aria-label={`Background color ${design.colors.background}`}
              aria-pressed={toolOptions === "colors"}
              style={{ backgroundColor: design.colors.background }}
              onClick={() => setToolOptions((current) => (current === "colors" ? null : "colors"))}
            />
            <button
              type="button"
              className="studio-color-swap"
              aria-label="Swap foreground and background colors"
              onClick={() => {
                dispatch({ type: "setColor", key: "accent", value: design.colors.background });
                dispatch({ type: "setColor", key: "background", value: design.colors.accent });
                setCanvasStatus("Swapped colors");
              }}
            >
              <RestyleIcon />
            </button>
          </div>

          {toolOptions ? (
            <section
              className="studio-tool-options"
              role="dialog"
              aria-label={`${toolOptions[0].toUpperCase()}${toolOptions.slice(1)} options`}
            >
              <div className="studio-tool-options-heading">
                <div>
                  <span className="studio-tool-options-kicker">Tool options</span>
                  <strong>
                    {toolOptions === "brush"
                      ? "Brush"
                      : toolOptions === "fill"
                        ? "Paint bucket"
                        : toolOptions === "colors"
                          ? "Colors"
                          : "Palettes"}
                  </strong>
                </div>
                <button
                  type="button"
                  className="studio-tool-options-close"
                  aria-label="Close tool options"
                  onClick={() => setToolOptions(null)}
                >
                  ×
                </button>
              </div>

              {toolOptions === "brush" ? (
                <div className="studio-tool-options-content">
                  <label className="studio-tool-slider">
                    <span>Size <strong>{brushSize}px</strong></span>
                    <input
                      type="range"
                      min="2"
                      max="96"
                      step="1"
                      value={brushSize}
                      onChange={(event) => setBrushSize(Number(event.target.value))}
                    />
                  </label>
                  <label className="studio-tool-slider">
                    <span>Opacity <strong>{Math.round(brushOpacity * 100)}%</strong></span>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={brushOpacity}
                      onChange={(event) => setBrushOpacity(Number(event.target.value))}
                    />
                  </label>
                  <label className="studio-tool-color-field">
                    <span>Brush color</span>
                    <span>
                      <input
                        type="color"
                        value={design.colors.accent}
                        aria-label="Brush color"
                        onChange={(event) => dispatch({ type: "setColor", key: "accent", value: event.target.value })}
                      />
                      <code>{design.colors.accent.toUpperCase()}</code>
                    </span>
                  </label>
                </div>
              ) : null}

              {toolOptions === "fill" ? (
                <div className="studio-tool-options-content">
                  <label className="studio-tool-color-field">
                    <span>Fill color</span>
                    <span>
                      <input
                        type="color"
                        value={design.colors.accent}
                        aria-label="Fill color"
                        onChange={(event) => dispatch({ type: "setColor", key: "accent", value: event.target.value })}
                      />
                      <code>{design.colors.accent.toUpperCase()}</code>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="studio-tool-option-action"
                    onClick={() => {
                      dispatch({ type: "setColor", key: "background", value: design.colors.accent });
                      setCanvasStatus(`Background set to ${design.colors.accent}`);
                    }}
                  >
                    Set poster background
                  </button>
                  <span className="studio-tool-option-hint">Choose a color, then click the poster to apply it.</span>
                </div>
              ) : null}

              {toolOptions === "colors" ? (
                <div className="studio-tool-options-content">
                  {(["accent", "background"] as const).map((key) => (
                    <label className="studio-tool-color-field" key={key}>
                      <span>{key === "accent" ? "Foreground" : "Background"}</span>
                      <span>
                        <input
                          type="color"
                          value={design.colors[key]}
                          aria-label={`${key === "accent" ? "Foreground" : "Background"} color`}
                          onChange={(event) => dispatch({ type: "setColor", key, value: event.target.value })}
                        />
                        <code>{design.colors[key].toUpperCase()}</code>
                      </span>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="studio-tool-option-action"
                    onClick={() => {
                      dispatch({ type: "setColor", key: "accent", value: design.colors.background });
                      dispatch({ type: "setColor", key: "background", value: design.colors.accent });
                    }}
                  >
                    Swap colors
                  </button>
                </div>
              ) : null}

              {toolOptions === "palette" ? (
                <div className="studio-tool-options-palette-grid">
                  {colorPalettes.map((palette) => (
                    <button
                      key={palette.id}
                      type="button"
                      className={`studio-palette-option ${selectedPaletteId === palette.id ? "is-selected" : ""}`}
                      aria-label={`Use ${palette.name} palette`}
                      aria-pressed={selectedPaletteId === palette.id}
                      title={`${palette.name}: ${palette.note}`}
                      onClick={() => applyPalette(palette.id)}
                    >
                      {Object.values(palette.colors).map((color, index) => (
                        <span key={`${palette.id}-${index}-${color}`} className="studio-palette-swatch" style={{ backgroundColor: color }} />
                      ))}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <div
          className="design-canvas-stage"
          style={{ touchAction: "none", overscrollBehavior: "contain" }}
          onWheel={handleCanvasWheel}
          onPointerDownCapture={handleStagePointerDown}
          onPointerMoveCapture={handleStagePointerMove}
          onPointerUpCapture={handleStagePointerEnd}
          onPointerCancelCapture={handleStagePointerEnd}
        >
          <div className="design-canvas-poster-frame" style={{ transform: `scale(${canvasScale})` }}>
            <div
              className="design-canvas-poster"
              style={{ aspectRatio: `${posterDimensions.width} / ${posterDimensions.height}` }}
            >
              <Poster
                design={design}
                referenceImage={importedReference}
                edits={posterEdits}
                layerOrder={layerOrder}
                selectedLayerId={selectedLayerId}
                activeTool={activeTool}
                brushStrokes={brushStrokes}
                brushColor={design.colors.accent}
                brushSize={brushSize}
                brushOpacity={brushOpacity}
                onChangeBrushStrokes={setBrushStrokes}
                onSelectLayer={selectLayer}
                onChangeLayer={onChangeLayer}
                onEditText={editTextLayer}
                onDeleteLayer={onDeleteLayer}
                onPickColor={(value) => {
                  dispatch({ type: "setColor", key: "accent", value });
                  setCanvasStatus(`Sampled ${value}`);
                }}
                onFill={() => {
                  dispatch({ type: "setColor", key: "background", value: design.colors.accent });
                  setCanvasStatus(`Filled background with ${design.colors.accent}`);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <FloatingButtonGroup
        label="Canvas actions"
        variant="floating"
        size="sm"
        className="studio-canvas-action-bar"
        items={[
            {
              id: "layers",
              label: "Layers",
              icon: <LayersIcon />,
              iconOnly: true,
              pressed: layersOpen,
            onSelect: () => onToggleInspector?.("layers"),
            disabled: !onToggleInspector,
          },
          {
            id: "reference",
            label: "Reference",
            icon: <PanelRightIcon />,
            iconOnly: true,
            pressed: referenceOpen,
            onSelect: () => onToggleInspector?.("reference"),
            disabled: !onToggleInspector,
          },
          {
            id: "sidebar",
            label: "Toggle side panels",
            icon: <PanelLeftIcon />,
            iconOnly: true,
            pressed: Boolean(referenceOpen || layersOpen),
            onSelect: () => {
              if (referenceOpen || layersOpen) {
                if (referenceOpen) onToggleInspector?.("reference");
                if (layersOpen) onToggleInspector?.("layers");
              } else {
                onToggleInspector?.("reference");
              }
            },
            disabled: !onToggleInspector,
          },
          { id: "reset", label: "Reset", icon: <ResetIcon />, onSelect: () => openActionDialog("reset-project") },
          { type: "separator", id: "canvas-actions-divider" },
          {
            id: "copy-text",
            label: "Copy selected text",
            icon: <CopyIcon />,
            iconOnly: true,
            disabled: !selectedTextLayer || !selectedText,
            onSelect: () => void copySelectedText(),
          },
          {
            id: "cut-text",
            label: "Cut selected text",
            icon: <ScissorsIcon />,
            iconOnly: true,
            disabled: !selectedTextLayer || !selectedText,
            onSelect: () => void cutSelectedText(),
          },
          {
            id: "hide-layer",
            label: "Hide selected layer",
            icon: <TrashIcon />,
            iconOnly: true,
            disabled: !selectedLayerId || selectedLayerId === "background",
            onSelect: () => {
              openActionDialog("delete-layer", selectedLayerId);
            },
          },
          { type: "separator", id: "canvas-edit-divider" },
          {
            id: "undo",
            label: "Undo",
            icon: <ResetIcon />,
            iconOnly: true,
            disabled: !canUndo,
            shortcut: "⌘/Ctrl Z",
            onSelect: onUndo,
          },
          {
            id: "redo",
            label: "Redo",
            icon: <RedoIcon />,
            iconOnly: true,
            disabled: !canRedo,
            shortcut: "⌘/Ctrl Shift Z",
            onSelect: onRedo,
          },
          { type: "separator", id: "canvas-reference-divider" },
          {
            id: "inspire",
            label: "Inspire",
            icon: <SparkleIcon />,
            iconOnly: true,
            disabled: !onToggleInspector,
            onSelect: () => onToggleInspector?.("reference"),
          },
          { id: "restyle", label: "Restyle", icon: <RestyleIcon />, iconOnly: true, onSelect: restylePoster },
          { id: "shuffle", label: "Shuffle", icon: <ShuffleIcon />, iconOnly: true, onSelect: shufflePalette },
          {
            id: "save",
            label: "Save",
            icon: <SaveIcon />,
            iconOnly: true,
            onSelect: () => openActionDialog("save"),
          },
          {
            id: "export",
            label: exporting ? "Exporting" : "Export",
            icon: <ExportIcon />,
            iconOnly: true,
            reserveLabels: ["Export", "Exporting"],
            disabled: exporting,
            onSelect: () => void exportCanvas(),
          },
        ]}
      />

      <footer className="design-canvas-footer">
        <div className="design-canvas-footer-info" aria-label="Document information">
          <span>RGB / 8-bit</span>
          <span>{Math.round(canvasScale * 100)}%</span>
          <span>{posterDimensions.width} × {posterDimensions.height}</span>
        </div>
      </footer>

      {canvasStatus ? (
        <span className="sr-only" role="status" aria-live="polite">
          {canvasStatus}
        </span>
      ) : null}

      <Dialog
        open={Boolean(actionDialogCopy)}
        onOpenChange={(open) => {
          if (!open && !actionBusy) {
            setActionDialog(null);
            setPendingLayerId(null);
          }
        }}
      >
        {actionDialogCopy ? (
          <DialogContent
            className="studio-action-dialog"
            showCloseButton={false}
            style={{
              width: "min(26rem, calc(100vw - 2rem))",
              gap: "1rem",
              border: "1px solid rgba(255, 255, 255, 0.14)",
              borderRadius: "0.7rem",
              background: "#1b1b1b",
              padding: "1.2rem",
              color: "#f4f3ee",
              fontFamily: "var(--curio-body-font)",
              boxShadow: "0 1.5rem 4rem rgba(0, 0, 0, 0.46)",
            }}
          >
            <DialogHeader style={{ gap: "0.5rem" }}>
              <DialogTitle
                style={{
                  color: "#f4f3ee",
                  fontFamily: "var(--curio-heading-font)",
                  fontSize: "1rem",
                  fontWeight: 500,
                  lineHeight: 1.2,
                }}
              >
                {actionDialogCopy.title}
              </DialogTitle>
              <DialogDescription
                style={{
                  color: "rgba(244, 243, 238, 0.62)",
                  fontFamily: "var(--curio-body-font)",
                  fontSize: "0.82rem",
                  lineHeight: 1.45,
                }}
              >
                {actionDialogCopy.description}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter
              style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: "0.45rem",
                margin: 0,
                border: 0,
                borderRadius: 0,
                background: "transparent",
                padding: 0,
              }}
            >
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={actionBusy}
                  className="studio-action-dialog-cancel"
                  style={{
                    minHeight: "2rem",
                    borderRadius: "0.35rem",
                    color: "rgba(244, 243, 238, 0.68)",
                    fontFamily: "var(--curio-body-font)",
                    fontSize: "0.72rem",
                  }}
                >
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant={actionDialogCopy.variant}
                disabled={actionBusy}
                className="studio-action-dialog-confirm"
                style={{
                  minHeight: "2rem",
                  borderRadius: "0.35rem",
                  fontFamily: "var(--curio-body-font)",
                  fontSize: "0.72rem",
                  ...(actionDialogCopy.variant === "destructive"
                    ? { background: "rgba(224, 112, 88, 0.16)", color: "#f4a28f" }
                    : { background: "#f4f3ee", color: "#171717" }),
                }}
                onClick={() => void confirmActionDialog()}
              >
                {actionBusy ? "Working…" : actionDialogCopy.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

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
            <button
              type="button"
              className="studio-footer-button"
              onClick={() => {
                setPropertiesOpen(false);
                onToolChange("select");
              }}
            >
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

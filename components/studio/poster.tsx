"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DesignState } from "@/lib/design-types";
import type { ImportedReference } from "@/lib/image-import-client";
import {
  POSTER_HEIGHT,
  POSTER_WIDTH,
  buildPoster,
  normalizeLayerOrder,
  type PosterShape,
  type PosterText,
} from "@/lib/poster-layout";
import { createPosterLayerEdit, type PosterEdits, type PosterTool } from "@/lib/poster-editor";

type Bounds = { x: number; y: number; width: number; height: number };
type DragMode = "move" | "scale";
type SelectionMode = "rectangle-select";
type BrushPoint = { x: number; y: number };

export type BrushStroke = {
  id: string;
  points: BrushPoint[];
  color: string;
  size: number;
  opacity: number;
};

type LayerInteraction = {
  kind: "layer";
  id: string;
  mode: DragMode;
  pointerId: number;
  start: { x: number; y: number };
  original: ReturnType<typeof createPosterLayerEdit>;
  bounds: Bounds;
};

type PanInteraction = {
  kind: "pan";
  pointerId: number;
  start: { x: number; y: number };
  scroll: { left: number; top: number };
  stage: HTMLElement;
};

type SelectionInteraction = {
  kind: "selection";
  mode: SelectionMode;
  pointerId: number;
  start: { x: number; y: number };
  current: { x: number; y: number };
  points: { x: number; y: number }[];
};

type BrushInteraction = {
  kind: "brush";
  pointerId: number;
  strokeId: string;
  points: BrushPoint[];
};

type Interaction = LayerInteraction | PanInteraction | SelectionInteraction | BrushInteraction;

type SelectionPreview = {
  mode: SelectionMode;
  start: { x: number; y: number };
  current: { x: number; y: number };
  points: { x: number; y: number }[];
};

type PosterProps = {
  design: DesignState;
  edits?: PosterEdits;
  layerOrder?: string[];
  selectedLayerId?: string | null;
  referenceImage?: ImportedReference | null;
  activeTool?: PosterTool;
  onSelectLayer?: (id: string | null) => void;
  onChangeLayer?: (id: string, patch: Partial<ReturnType<typeof createPosterLayerEdit>>) => void;
  onEditText?: (id: string) => void;
  onDeleteLayer?: (id: string) => void;
  onPickColor?: (value: string) => void;
  onFill?: () => void;
  brushStrokes?: BrushStroke[];
  brushColor?: string;
  brushSize?: number;
  brushOpacity?: number;
  onChangeBrushStrokes?: (
    update: BrushStroke[] | ((current: BrushStroke[]) => BrushStroke[]),
  ) => void;
};

function editFor(edits: PosterEdits | undefined, id: string) {
  return { ...createPosterLayerEdit(), ...(edits?.[id] ?? {}) };
}

function boundsForShape(shape: PosterShape): Bounds {
  if (shape.kind === "rect") {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
  if (shape.kind === "circle") {
    return { x: shape.cx - shape.r, y: shape.cy - shape.r, width: shape.r * 2, height: shape.r * 2 };
  }
  return {
    x: Math.min(shape.x1, shape.x2) - 8,
    y: Math.min(shape.y1, shape.y2) - 8,
    width: Math.abs(shape.x2 - shape.x1) + 16,
    height: Math.abs(shape.y2 - shape.y1) + 16,
  };
}

function boundsForText(item: PosterText): Bounds {
  const width = Math.max(
    item.size * 0.8,
    item.text.length * item.size * 0.56 + item.tracking * item.text.length,
  );
  const x = item.anchor === "start" ? item.x : item.anchor === "middle" ? item.x - width / 2 : item.x - width;
  return { x, y: item.y - item.size, width, height: item.size * 1.2 };
}

function transformFor(bounds: Bounds, edit: ReturnType<typeof createPosterLayerEdit>) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return `translate(${edit.x} ${edit.y}) translate(${cx} ${cy}) rotate(${edit.rotation}) scale(${edit.scale}) translate(${-cx} ${-cy})`;
}

function localPoint(svg: SVGSVGElement, event: ReactPointerEvent<SVGElement>) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function brushPath(points: BrushPoint[]) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join("")}`;
}

function renderShape(shape: PosterShape) {
  if (shape.kind === "rect") {
    return (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        fill={shape.fill ?? "none"}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        opacity={shape.opacity}
      />
    );
  }
  if (shape.kind === "circle") {
    return (
      <circle
        cx={shape.cx}
        cy={shape.cy}
        r={shape.r}
        fill={shape.fill ?? "none"}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        opacity={shape.opacity}
      />
    );
  }
  return (
    <line
      x1={shape.x1}
      y1={shape.y1}
      x2={shape.x2}
      y2={shape.y2}
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      opacity={shape.opacity}
    />
  );
}

/**
 * Lightweight canvas interaction layer. The poster model stays intact while
 * edits are non-destructive transforms driven by pointer capture.
 */
export function Poster({
  design,
  edits,
  layerOrder = [],
  selectedLayerId = null,
  referenceImage = null,
  activeTool = "select",
  onSelectLayer,
  onChangeLayer,
  onEditText,
  onDeleteLayer,
  onPickColor,
  onFill,
  brushStrokes = [],
  brushColor = "#ffffff",
  brushSize = 24,
  brushOpacity = 1,
  onChangeBrushStrokes,
}: PosterProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const interaction = useRef<Interaction | null>(null);
  const brushStrokeIndex = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [selection, setSelection] = useState<SelectionPreview | null>(null);
  const { shapes, texts } = useMemo(() => buildPoster(design), [design]);
  const orderedLayerIds = useMemo(
    () => normalizeLayerOrder({ shapes, texts }, layerOrder),
    [layerOrder, shapes, texts],
  );

  const layerBounds = useMemo(() => {
    const result = new Map<string, Bounds>();
    result.set("background", { x: 0, y: 0, width: POSTER_WIDTH, height: POSTER_HEIGHT });
    shapes.forEach((shape) => result.set(shape.id, boundsForShape(shape)));
    texts.forEach((item) => result.set(item.id, boundsForText(item)));
    return result;
  }, [shapes, texts]);

  const selectedBounds = selectedLayerId ? layerBounds.get(selectedLayerId) : undefined;
  const selectedEdit = selectedLayerId ? editFor(edits, selectedLayerId) : null;
  const layerColors = useMemo(() => {
    const result = new Map<string, string>();
    result.set("background", design.colors.background);
    shapes.forEach((shape) => {
      const color = shape.kind === "line" ? shape.stroke : shape.fill ?? shape.stroke;
      if (color) result.set(shape.id, color);
    });
    texts.forEach((item) => result.set(item.id, item.color));
    return result;
  }, [design.colors.background, shapes, texts]);

  function beginPan(event: ReactPointerEvent<SVGElement>) {
    const svg = svgRef.current;
    const stage = svg?.closest<HTMLElement>(".design-canvas-stage");
    if (!svg || !stage) return;
    event.preventDefault();
    event.stopPropagation();
    interaction.current = {
      kind: "pan",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      scroll: { left: stage.scrollLeft, top: stage.scrollTop },
      stage,
    };
    svg.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function beginBrush(event: ReactPointerEvent<SVGElement>) {
    const svg = svgRef.current;
    if (!svg || !onChangeBrushStrokes) return;
    event.preventDefault();
    event.stopPropagation();
    const point = localPoint(svg, event);
    const stroke: BrushStroke = {
      id: `brush-${++brushStrokeIndex.current}`,
      points: [point],
      color: brushColor,
      size: brushSize,
      opacity: brushOpacity,
    };
    onChangeBrushStrokes((current) => [...current, stroke]);
    interaction.current = {
      kind: "brush",
      pointerId: event.pointerId,
      strokeId: stroke.id,
      points: [point],
    };
    svg.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function beginSelection(event: ReactPointerEvent<SVGElement>, mode: SelectionMode) {
    const svg = svgRef.current;
    if (!svg) return;
    event.preventDefault();
    event.stopPropagation();
    const point = localPoint(svg, event);
    interaction.current = {
      kind: "selection",
      mode,
      pointerId: event.pointerId,
      start: point,
      current: point,
      points: [point],
    };
    setSelection({ mode, start: point, current: point, points: [point] });
    svg.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function transformedBounds(bounds: Bounds, edit: ReturnType<typeof createPosterLayerEdit>): Bounds {
    const width = bounds.width * edit.scale;
    const height = bounds.height * edit.scale;
    const centerX = bounds.x + bounds.width / 2 + edit.x;
    const centerY = bounds.y + bounds.height / 2 + edit.y;
    return { x: centerX - width / 2, y: centerY - height / 2, width, height };
  }

  function selectionBounds(preview: SelectionPreview | SelectionInteraction): Bounds {
    const points = [preview.start, preview.current];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x,
      y,
      width: Math.max(1, Math.max(...xs) - x),
      height: Math.max(1, Math.max(...ys) - y),
    };
  }

  function intersects(first: Bounds, second: Bounds) {
    return (
      first.x <= second.x + second.width &&
      first.x + first.width >= second.x &&
      first.y <= second.y + second.height &&
      first.y + first.height >= second.y
    );
  }

  function commitSelection(current: SelectionInteraction) {
    const marquee = selectionBounds(current);
    const candidates = Array.from(layerBounds.entries()).filter(([id, bounds]) => {
      if (id === "background") return false;
      const edit = editFor(edits, id);
      return edit.visible && intersects(marquee, transformedBounds(bounds, edit));
    });
    onSelectLayer?.(candidates.at(-1)?.[0] ?? null);
  }

  function beginInteraction(
    event: ReactPointerEvent<SVGElement>,
    id: string,
    mode: DragMode = "move",
  ) {
    if (activeTool === "hand") {
      beginPan(event);
      return;
    }
    if (activeTool === "rectangle-select") {
      beginSelection(event, activeTool);
      return;
    }
    if (activeTool === "brush") {
      beginBrush(event);
      return;
    }
    event.stopPropagation();
    onSelectLayer?.(id);
    if (activeTool === "eraser") {
      if (id !== "background") onDeleteLayer?.(id);
      return;
    }
    if (activeTool === "dropper") {
      const sampled = layerColors.get(id);
      if (sampled && /^#[0-9a-f]{6}$/i.test(sampled)) onPickColor?.(sampled);
      return;
    }
    if (activeTool === "fill") {
      onFill?.();
      return;
    }
    if (activeTool === "text" && id !== "background") {
      onEditText?.(id);
      return;
    }
    if (activeTool !== "select" && activeTool !== "crop") return;
    if (!onChangeLayer) return;

    const edit = editFor(edits, id);
    if (edit.locked || id === "background") return;
    const bounds = layerBounds.get(id);
    const svg = svgRef.current;
    if (!bounds || !svg) return;

    interaction.current = {
      kind: "layer",
      id,
      mode: activeTool === "crop" ? "scale" : mode,
      pointerId: event.pointerId,
      start: localPoint(svg, event),
      original: edit,
      bounds,
    };
    svg.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function moveInteraction(event: ReactPointerEvent<SVGSVGElement>) {
    const current = interaction.current;
    const svg = svgRef.current;
    if (!current || !svg) return;
    if (current.kind === "pan") {
      current.stage.scrollLeft = current.scroll.left - (event.clientX - current.start.x);
      current.stage.scrollTop = current.scroll.top - (event.clientY - current.start.y);
      return;
    }
    const point = localPoint(svg, event);
    if (current.kind === "selection") {
      current.current = point;
      setSelection({
        mode: current.mode,
        start: current.start,
        current: point,
        points: current.points,
      });
      return;
    }
    if (current.kind === "brush") {
      current.points = [...current.points, point];
      onChangeBrushStrokes?.((strokes) =>
        strokes.map((stroke) =>
          stroke.id === current.strokeId ? { ...stroke, points: current.points } : stroke,
        ),
      );
      return;
    }
    if (!onChangeLayer) return;
    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;

    if (current.mode === "move") {
      onChangeLayer(current.id, { x: current.original.x + dx, y: current.original.y + dy });
      return;
    }

    const centerX = current.bounds.x + current.bounds.width / 2;
    const centerY = current.bounds.y + current.bounds.height / 2;
    const startDistance = Math.max(1, Math.hypot(current.start.x - centerX, current.start.y - centerY));
    const currentDistance = Math.hypot(point.x - centerX, point.y - centerY);
    onChangeLayer(current.id, {
      scale: clamp(current.original.scale * (currentDistance / startDistance), 0.05, 12),
    });
  }

  function endInteraction(event: ReactPointerEvent<SVGSVGElement>) {
    const current = interaction.current;
    if (current?.pointerId === event.pointerId) {
      if (current.kind === "selection") commitSelection(current);
      interaction.current = null;
      setSelection(null);
      setIsDragging(false);
      if (svgRef.current?.hasPointerCapture(event.pointerId)) {
        svgRef.current.releasePointerCapture(event.pointerId);
      }
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    if (!selectedLayerId || !onChangeLayer) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDeleteLayer?.(selectedLayerId);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onSelectLayer?.(null);
    }
  }

  const renderText = (item: PosterText) => {
    const edit = editFor(edits, item.id);
    if (!edit.visible) return null;
    const bounds = boundsForText(item);
    return (
      <g
        key={item.id}
        data-layer-id={item.id}
        transform={transformFor(bounds, edit)}
        opacity={edit.opacity}
        onPointerDown={(event) => beginInteraction(event, item.id)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onEditText?.(item.id);
        }}
        style={{
          cursor:
            activeTool === "select"
              ? edit.locked
                ? "not-allowed"
                : isDragging
                  ? "grabbing"
                  : "grab"
              : activeTool === "crop"
                ? "nwse-resize"
                : activeTool === "hand"
                ? isDragging
                  ? "grabbing"
                  : "grab"
                : activeTool === "text"
                  ? "text"
                  : "crosshair",
        }}
      >
        <text
          x={item.x}
          y={item.y}
          textAnchor={item.anchor}
          fontSize={item.size}
          fontWeight={item.weight}
          fontStyle={item.italic ? "italic" : "normal"}
          fill={item.color}
          style={{
            fontFamily: item.font === "heading" ? design.typography.headingFont : design.typography.bodyFont,
            letterSpacing: item.tracking,
            whiteSpace: "pre",
          }}
        >
          {item.text}
        </text>
      </g>
    );
  };

  const renderGraphic = (shape: PosterShape) => {
    const edit = editFor(edits, shape.id);
    if (!edit.visible) return null;
    const bounds = boundsForShape(shape);
    return (
      <g
        key={shape.id}
        data-layer-id={shape.id}
        transform={transformFor(bounds, edit)}
        opacity={edit.opacity}
        onPointerDown={(event) => beginInteraction(event, shape.id)}
        style={{
          cursor:
            activeTool === "select"
              ? edit.locked
                ? "not-allowed"
                : isDragging
                  ? "grabbing"
                  : "grab"
              : activeTool === "crop"
                ? "nwse-resize"
                : activeTool === "hand"
                ? isDragging
                  ? "grabbing"
                  : "grab"
                : "crosshair",
        }}
      >
        {renderShape(shape)}
      </g>
    );
  };

  function renderLayer(id: string) {
    if (id === "background") {
      return (
        <g key="background">
          <rect
            data-layer-id="background"
            width={POSTER_WIDTH}
            height={POSTER_HEIGHT}
            fill={design.colors.background}
            onPointerDown={(event) => beginInteraction(event, "background")}
          />
          {referenceImage ? (
            <image
              href={referenceImage.previewUrl}
              x="0"
              y="0"
              width={POSTER_WIDTH}
              height={POSTER_HEIGHT}
              preserveAspectRatio="xMidYMid slice"
              opacity="0.72"
              pointerEvents="none"
              data-imported-reference-image="true"
              aria-label={`Imported reference: ${referenceImage.filename}`}
            />
          ) : null}
        </g>
      );
    }
    const shape = shapes.find((item) => item.id === id);
    if (shape) return renderGraphic(shape);
    const text = texts.find((item) => item.id === id);
    return text ? renderText(text) : null;
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${design.projectName} poster, ${design.styleLabel} direction`}
      className="block h-full w-full"
      tabIndex={0}
      onPointerDown={(event) => {
        if (activeTool === "hand") {
          beginPan(event);
        } else if (activeTool === "rectangle-select") {
          beginSelection(event, activeTool);
        } else if (activeTool === "brush") {
          beginBrush(event);
        } else if (event.target === event.currentTarget) {
          onSelectLayer?.(null);
        }
      }}
      onPointerMove={moveInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onKeyDown={handleKeyDown}
    >
      {[...orderedLayerIds].reverse().map(renderLayer)}

      {brushStrokes.map((stroke) => (
        <path
          key={stroke.id}
          data-brush-stroke="true"
          d={brushPath(stroke.points)}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.size}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={stroke.opacity}
          pointerEvents="none"
        />
      ))}

      {selection ? (
        <rect
          className="poster-marquee-selection"
          {...selectionBounds(selection)}
          fill="rgba(118, 167, 255, 0.08)"
          pointerEvents="none"
        />
      ) : null}

      {selectedLayerId && selectedBounds && selectedEdit && selectedLayerId !== "background" ? (
        <g
          className="poster-selection-overlay"
          transform={transformFor(selectedBounds, selectedEdit)}
          aria-label={`Selected layer ${selectedLayerId}`}
        >
          <rect
            className="poster-selection-box"
            x={selectedBounds.x - 10}
            y={selectedBounds.y - 10}
            width={selectedBounds.width + 20}
            height={selectedBounds.height + 20}
            fill="transparent"
            onPointerDown={(event) => beginInteraction(event, selectedLayerId)}
          />
          {[
            [selectedBounds.x - 10, selectedBounds.y - 10],
            [selectedBounds.x + selectedBounds.width + 10, selectedBounds.y - 10],
            [selectedBounds.x - 10, selectedBounds.y + selectedBounds.height + 10],
            [selectedBounds.x + selectedBounds.width + 10, selectedBounds.y + selectedBounds.height + 10],
          ].map(([cx, cy], index) => (
            <circle
              key={index}
              className="poster-selection-handle"
              cx={cx}
              cy={cy}
              r="11"
              onPointerDown={(event) => beginInteraction(event, selectedLayerId, "scale")}
            />
          ))}
        </g>
      ) : null}
    </svg>
  );
}

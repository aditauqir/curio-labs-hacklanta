"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DesignState } from "@/lib/design-types";
import {
  POSTER_HEIGHT,
  POSTER_WIDTH,
  buildPoster,
  type PosterShape,
  type PosterText,
} from "@/lib/poster-layout";
import { createPosterLayerEdit, type PosterEdits, type PosterTool } from "@/lib/poster-editor";

type Bounds = { x: number; y: number; width: number; height: number };
type DragMode = "move" | "scale";

type Interaction = {
  id: string;
  mode: DragMode;
  pointerId: number;
  start: { x: number; y: number };
  original: ReturnType<typeof createPosterLayerEdit>;
  bounds: Bounds;
};

type PosterProps = {
  design: DesignState;
  edits?: PosterEdits;
  selectedLayerId?: string | null;
  activeTool?: PosterTool;
  onSelectLayer?: (id: string | null) => void;
  onChangeLayer?: (id: string, patch: Partial<ReturnType<typeof createPosterLayerEdit>>) => void;
  onEditText?: (id: string) => void;
  onDeleteLayer?: (id: string) => void;
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
  selectedLayerId = null,
  activeTool = "select",
  onSelectLayer,
  onChangeLayer,
  onEditText,
  onDeleteLayer,
}: PosterProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const interaction = useRef<Interaction | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { shapes, texts } = useMemo(() => buildPoster(design), [design]);

  const layerBounds = useMemo(() => {
    const result = new Map<string, Bounds>();
    result.set("background", { x: 0, y: 0, width: POSTER_WIDTH, height: POSTER_HEIGHT });
    shapes.forEach((shape) => result.set(shape.id, boundsForShape(shape)));
    texts.forEach((item) => result.set(item.id, boundsForText(item)));
    return result;
  }, [shapes, texts]);

  const selectedBounds = selectedLayerId ? layerBounds.get(selectedLayerId) : undefined;
  const selectedEdit = selectedLayerId ? editFor(edits, selectedLayerId) : null;

  function beginInteraction(
    event: ReactPointerEvent<SVGElement>,
    id: string,
    mode: DragMode = "move",
  ) {
    event.stopPropagation();
    onSelectLayer?.(id);
    if (activeTool === "text" && id !== "background") {
      onEditText?.(id);
      return;
    }
    if (activeTool !== "select" || !onChangeLayer) return;

    const edit = editFor(edits, id);
    if (edit.locked || id === "background") return;
    const bounds = layerBounds.get(id);
    const svg = svgRef.current;
    if (!bounds || !svg) return;

    interaction.current = {
      id,
      mode,
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
    if (!current || !svg || !onChangeLayer) return;
    const point = localPoint(svg, event);
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
    if (interaction.current?.pointerId === event.pointerId) {
      interaction.current = null;
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
              : "text",
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
              : "crosshair",
        }}
      >
        {renderShape(shape)}
      </g>
    );
  };

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
        if (event.target === event.currentTarget) onSelectLayer?.(null);
      }}
      onPointerMove={moveInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onKeyDown={handleKeyDown}
    >
      <rect
        data-layer-id="background"
        width={POSTER_WIDTH}
        height={POSTER_HEIGHT}
        fill={design.colors.background}
        onPointerDown={(event) => beginInteraction(event, "background")}
      />
      {shapes.map(renderGraphic)}
      {texts.map(renderText)}

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

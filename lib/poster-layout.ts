import type { DesignState } from "./design-types";
import { getFontPair, getPosterSize } from "./design-presets";

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;

export function getPosterDimensions(design: DesignState) {
  const size = getPosterSize(design.posterSize);
  return { width: size.width, height: size.height };
}
const MARGIN = 96;

export type PosterText = {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  weight: number;
  font: "heading" | "body";
  color: string;
  tracking: number;
  italic: boolean;
  anchor: "start" | "middle" | "end";
};

export type PosterShape =
  | {
      id: string;
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      fill?: string;
      stroke?: string;
      strokeWidth: number;
      opacity: number;
    }
  | {
      id: string;
      kind: "circle";
      cx: number;
      cy: number;
      r: number;
      fill?: string;
      stroke?: string;
      strokeWidth: number;
      opacity: number;
    }
  | {
      id: string;
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      strokeWidth: number;
      opacity: number;
    };

export type PosterModel = {
  texts: PosterText[];
  shapes: PosterShape[];
};

export function getDefaultLayerOrder(model: PosterModel) {
  return [...model.texts.map((item) => item.id), ...model.shapes.map((shape) => shape.id), "background"];
}

/** Keeps saved layer orders valid as poster directions add or remove elements. */
export function normalizeLayerOrder(model: PosterModel, layerOrder: readonly string[] = []) {
  const validIds = new Set(getDefaultLayerOrder(model));
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const id of [...layerOrder, ...getDefaultLayerOrder(model)]) {
    if (id === "background" || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  if (validIds.has("background")) normalized.push("background");

  return normalized;
}

export function sanitizeLayerOrder(model: PosterModel, raw: unknown) {
  return normalizeLayerOrder(
    model,
    Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string").slice(0, 200) : [],
  );
}

const SPACING_FACTOR = { compact: 0.85, normal: 1, spacious: 1.15 } as const;

/**
 * Both the live SVG poster and the PNG exporter render this model, so the
 * exported file always matches what is on screen.
 */
export function buildPoster(design: DesignState): PosterModel {
  const { direction, layout, colors } = design;
  const { background, foreground, accent } = colors;
  const pair = getFontPair(design.typography.id);
  const factor = SPACING_FACTOR[layout.spacing];
  const variant = layout.variant;
  const isVintage = direction === "vintage";
  const isMinimal = direction === "minimal";
  const isExperimental = direction === "experimental";

  const align =
    variant === "centred-stack"
      ? "center"
      : variant === "edge-anchored"
        ? "right"
        : layout.alignment;
  const x =
    align === "left" ? MARGIN : align === "center" ? POSTER_WIDTH / 2 : POSTER_WIDTH - MARGIN;
  const anchor = align === "left" ? "start" : align === "center" ? "middle" : "end";

  const texts: PosterText[] = [];
  const shapes: PosterShape[] = [];

  const lines = design.headline
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  const tightening = variant === "typographic-stack" ? 0.01 : isVintage ? 0 : 0.04;
  const indent = variant === "diagonal-break" ? 110 : variant === "edge-anchored" ? 76 : 0;
  const usable = POSTER_WIDTH - MARGIN * 2;
  const effectiveRatio = pair.widthRatio - tightening;
  const baseSize =
    variant === "typographic-stack" ? 220
    : variant === "centred-stack" ? 150
    : variant === "modular-grid" ? 142
    : isVintage ? 150 : isMinimal ? 176 : 208;

  let size = baseSize;
  lines.forEach((line, index) => {
    const available = usable - (index % 2 === 1 ? indent : 0);
    size = Math.min(size, Math.floor(available / (line.length * effectiveRatio)));
  });
  size = Math.max(size, 40);

  const tracking = isVintage ? -2 : -tightening * size;
  const headTop =
    variant === "typographic-stack" ? 184
    : variant === "centred-stack" ? 248
    : variant === "edge-anchored" ? 210
    : variant === "modular-grid" ? 232
    : 290 + (factor - 1) * 140;
  const firstBaseline = headTop + size * 0.8;
  const gap = size * (variant === "typographic-stack" ? 0.76 : isVintage ? 0.95 : 0.88);

  lines.forEach((line, index) => {
    const shift = index % 2 === 1 ? indent : 0;
    const dx = align === "left" ? shift : align === "right" ? -shift : 0;
    texts.push({
      id: `headline-${index}`,
      text: line,
      x: x + dx,
      y: firstBaseline + index * gap,
      size,
      weight: pair.headingWeight,
      font: "heading",
      color: isExperimental && index % 2 === 1 ? accent : foreground,
      tracking,
      italic: false,
      anchor,
    });
  });

  const lastBaseline = firstBaseline + Math.max(lines.length - 1, 0) * gap;
  const subtitleY = lastBaseline + (variant === "modular-grid" ? 62 : 96) * factor;
  const dateY =
    variant === "full-bleed-image" ? 1120
    : variant === "modular-grid" ? 930
    : 1030 + (1 - factor) * 220;

  const addBody = (
    id: string,
    text: string,
    y: number,
    sizePx: number,
    weight: number,
    color: string,
    trackingPx: number,
    italic = false,
  ) => {
    if (!text.trim()) return;
    texts.push({
      id,
      text,
      x,
      y,
      size: sizePx,
      weight,
      font: "body",
      color,
      tracking: trackingPx,
      italic,
      anchor,
    });
  };

  addBody("venue", design.venue, 150, 24, 600, isMinimal ? foreground : accent, 8);
  addBody("subtitle", design.subtitle, subtitleY, 34, 400, foreground, 1, isVintage);
  addBody("date", design.date, dateY, 28, 600, foreground, 5);
  addBody("time", design.time, dateY + 54, 28, 400, foreground, 5);
  addBody("footer", design.footer, 1236, 20, 600, accent, 8);

  if (isVintage) {
    const panelX = align === "left" ? 690 : align === "right" ? 110 : 690;
    const markerX = align === "left" ? 72 : align === "right" ? 994 : 72;
    shapes.push({
      id: "frame",
      kind: "rect",
      x: 40,
      y: 40,
      width: 1000,
      height: 1270,
      stroke: foreground,
      strokeWidth: 3,
      opacity: 0.72,
    });
    shapes.push({
      id: "rule",
      kind: "line",
      x1: MARGIN,
      y1: 190,
      x2: POSTER_WIDTH - MARGIN,
      y2: 190,
      stroke: foreground,
      strokeWidth: 2,
      opacity: 0.5,
    });
    shapes.push(
      {
        id: "warm-panel",
        kind: "rect",
        x: panelX,
        y: 276,
        width: 300,
        height: 760,
        fill: foreground,
        strokeWidth: 0,
        opacity: 0.075,
      },
      {
        id: "warm-marker",
        kind: "rect",
        x: markerX,
        y: 254,
        width: 16,
        height: 188,
        fill: accent,
        strokeWidth: 0,
        opacity: 0.9,
      },
      {
        id: "warm-panel-rule",
        kind: "line",
        x1: panelX,
        y1: 276,
        x2: panelX + 300,
        y2: 276,
        stroke: accent,
        strokeWidth: 6,
        opacity: 0.95,
      },
    );
    const cx = align === "left" ? 840 : align === "right" ? 240 : 540;
    shapes.push(
      { id: "ring-field", kind: "circle", cx, cy: 922, r: 164, fill: accent, strokeWidth: 0, opacity: 0.06 },
      { id: "ring-outer", kind: "circle", cx, cy: 922, r: 148, stroke: accent, strokeWidth: 10, opacity: 1 },
      { id: "ring-inner", kind: "circle", cx, cy: 922, r: 106, stroke: foreground, strokeWidth: 3, opacity: 0.72 },
      { id: "ring-core", kind: "circle", cx, cy: 922, r: 28, fill: accent, strokeWidth: 0, opacity: 1 },
    );
  }

  if (isMinimal) {
    const barX = align === "left" ? MARGIN : align === "right" ? POSTER_WIDTH - MARGIN - 120 : POSTER_WIDTH / 2 - 60;
    shapes.push(
      { id: "top-line", kind: "line", x1: MARGIN, y1: 96, x2: POSTER_WIDTH - MARGIN, y2: 96, stroke: foreground, strokeWidth: 2, opacity: 0.35 },
      { id: "bottom-line", kind: "line", x1: MARGIN, y1: 1262, x2: POSTER_WIDTH - MARGIN, y2: 1262, stroke: foreground, strokeWidth: 2, opacity: 0.35 },
      { id: "accent-bar", kind: "rect", x: barX, y: 236, width: 120, height: 12, fill: accent, strokeWidth: 0, opacity: 1 },
    );
  }

  if (isExperimental) {
    shapes.push(
      { id: "edge-bar", kind: "rect", x: 0, y: 0, width: 28, height: POSTER_HEIGHT, fill: accent, strokeWidth: 0, opacity: 1 },
      { id: "ring", kind: "circle", cx: 990, cy: 80, r: 170, stroke: accent, strokeWidth: 10, opacity: 0.5 },
      { id: "base-bar", kind: "rect", x: 28, y: 1306, width: POSTER_WIDTH - 28, height: 44, fill: accent, strokeWidth: 0, opacity: 1 },
    );
  }

  // Layout variants are separate from the three visual directions. Gemini's
  // concept stage can therefore choose a genuinely different composition
  // without collapsing every concept into the same preset poster.
  if (variant === "centred-stack") {
    shapes.push(
      { id: "centre-rule", kind: "line", x1: POSTER_WIDTH / 2, y1: 124, x2: POSTER_WIDTH / 2, y2: 1230, stroke: accent, strokeWidth: 2, opacity: 0.55 },
      { id: "centre-orbit", kind: "circle", cx: POSTER_WIDTH / 2, cy: 928, r: 212, stroke: accent, strokeWidth: 8, opacity: 0.82 },
    );
  }

  if (variant === "diagonal-break") {
    shapes.push(
      { id: "diagonal-field", kind: "rect", x: -180, y: 470, width: 1440, height: 180, fill: accent, strokeWidth: 0, opacity: 0.88 },
      { id: "diagonal-cut", kind: "line", x1: -80, y1: 660, x2: 1160, y2: 410, stroke: foreground, strokeWidth: 8, opacity: 0.92 },
    );
  }

  if (variant === "edge-anchored") {
    shapes.push(
      { id: "edge-rule", kind: "line", x1: 150, y1: 208, x2: 960, y2: 208, stroke: foreground, strokeWidth: 2, opacity: 0.46 },
      { id: "edge-marker", kind: "rect", x: 936, y: 236, width: 44, height: 172, fill: accent, strokeWidth: 0, opacity: 0.9 },
    );
  }

  if (variant === "full-bleed-image") {
    shapes.push(
      { id: "image-scrim", kind: "rect", x: 0, y: 790, width: POSTER_WIDTH, height: 560, fill: background, strokeWidth: 0, opacity: 0.78 },
    );
  }

  if (variant === "modular-grid") {
    for (const [index, xLine] of [MARGIN, 360, 720, POSTER_WIDTH - MARGIN].entries()) {
      shapes.push({ id: `grid-column-${index}`, kind: "line", x1: xLine, y1: 92, x2: xLine, y2: 1262, stroke: foreground, strokeWidth: 1, opacity: index === 0 || index === 3 ? 0.36 : 0.18 });
    }
    shapes.push(
      { id: "grid-accent-cell", kind: "rect", x: 720, y: 810, width: 264, height: 214, fill: accent, strokeWidth: 0, opacity: 0.9 },
    );
  }

  if (variant === "typographic-stack") {
    shapes.push(
      { id: "type-stack-rule", kind: "line", x1: MARGIN, y1: 1200, x2: POSTER_WIDTH - MARGIN, y2: 1200, stroke: accent, strokeWidth: 5, opacity: 0.95 },
      { id: "type-stack-block", kind: "rect", x: MARGIN, y: 214, width: 18, height: 390, fill: accent, strokeWidth: 0, opacity: 1 },
    );
  }

  return { texts, shapes };
}

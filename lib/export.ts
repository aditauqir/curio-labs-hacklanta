import { writePsd } from "ag-psd";
import type { DesignState } from "./design-types";
import { getBrief } from "./design-state";
import { createPosterLayerEdit, type PosterEdits, type PosterLayerEdit } from "./poster-editor";
import {
  POSTER_HEIGHT,
  POSTER_WIDTH,
  buildPoster,
  type PosterShape,
  type PosterText,
} from "./poster-layout";

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "studio";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Replaces var(--font-x) with the real font family the browser loaded. */
function resolveFontStack(stack: string) {
  const root = getComputedStyle(document.documentElement);
  return stack
    .replace(/var\((--[a-z0-9-]+)\)/gi, (_, name: string) =>
      root.getPropertyValue(name).trim(),
    )
    .replace(/^[\s,]+/, "");
}

function boundsForShape(shape: PosterShape) {
  if (shape.kind === "rect") return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
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

function boundsForText(item: PosterText) {
  const width = Math.max(item.size * 0.8, item.text.length * item.size * 0.56 + item.tracking * item.text.length);
  const x = item.anchor === "start" ? item.x : item.anchor === "middle" ? item.x - width / 2 : item.x - width;
  return { x, y: item.y - item.size, width, height: item.size * 1.2 };
}

function withLayerTransform(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  edit: PosterLayerEdit,
) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  ctx.translate(edit.x + cx, edit.y + cy);
  ctx.rotate((edit.rotation * Math.PI) / 180);
  ctx.scale(edit.scale, edit.scale);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha *= edit.opacity;
}

function drawShape(ctx: CanvasRenderingContext2D, shape: PosterShape, edit: PosterLayerEdit) {
  ctx.save();
  withLayerTransform(ctx, boundsForShape(shape), edit);
  ctx.globalAlpha *= shape.opacity;

  if (shape.kind === "rect") {
    if (shape.fill) {
      ctx.fillStyle = shape.fill;
      ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
    }
    if (shape.stroke) {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.strokeWidth;
      ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
    }
  } else if (shape.kind === "circle") {
    ctx.beginPath();
    ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
    if (shape.fill) {
      ctx.fillStyle = shape.fill;
      ctx.fill();
    }
    if (shape.stroke) {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.strokeWidth;
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.strokeStyle = shape.stroke;
    ctx.lineWidth = shape.strokeWidth;
    ctx.stroke();
  }

  ctx.restore();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  item: PosterText,
  headingStack: string,
  bodyStack: string,
  edit: PosterLayerEdit,
) {
  ctx.save();
  withLayerTransform(ctx, boundsForText(item), edit);
  const family = item.font === "heading" ? headingStack : bodyStack;
  ctx.font = `${item.italic ? "italic " : ""}${item.weight} ${item.size}px ${family}`;
  ctx.fillStyle = item.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Older Safari versions lack ctx.letterSpacing, so detect support at runtime.
  const nativeSpacing = typeof ctx.letterSpacing === "string";
  let width: number;

  if (nativeSpacing) {
    ctx.letterSpacing = `${item.tracking}px`;
    width = ctx.measureText(item.text).width;
  } else {
    width =
      [...item.text].reduce((total, char) => total + ctx.measureText(char).width, 0) +
      item.tracking * item.text.length;
  }

  const startX =
    item.anchor === "start" ? item.x : item.anchor === "middle" ? item.x - width / 2 : item.x - width;

  if (nativeSpacing) {
    ctx.fillText(item.text, startX, item.y);
    ctx.letterSpacing = "0px";
    ctx.restore();
    return;
  }

  let cursor = startX;
  for (const char of item.text) {
    ctx.fillText(char, cursor, item.y);
    cursor += ctx.measureText(char).width + item.tracking;
  }
  ctx.restore();
}

export type PosterExportFormat = "png" | "jpg" | "psd";

type PosterLayers = {
  composite: HTMLCanvasElement;
  background: HTMLCanvasElement;
  graphics: HTMLCanvasElement;
  typography: HTMLCanvasElement;
};

function createCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  return canvas;
}

async function prepareFonts(design: DesignState) {
  const headingStack = resolveFontStack(design.typography.headingFont);
  const bodyStack = resolveFontStack(design.typography.bodyFont);

  await document.fonts.ready;
  await Promise.all([
    document.fonts.load(`${design.typography.headingWeight} 64px ${headingStack}`),
    document.fonts.load(`400 24px ${bodyStack}`),
    document.fonts.load(`600 24px ${bodyStack}`),
  ]).catch(() => undefined);

  return { headingStack, bodyStack };
}

function drawPosterLayers(
  design: DesignState,
  headingStack: string,
  bodyStack: string,
  edits: PosterEdits = {},
): PosterLayers {
  const composite = createCanvas();
  const background = createCanvas();
  const graphics = createCanvas();
  const typography = createCanvas();
  const { shapes, texts } = buildPoster(design);

  const backgroundContext = background.getContext("2d");
  const graphicsContext = graphics.getContext("2d");
  const typographyContext = typography.getContext("2d");
  const compositeContext = composite.getContext("2d");
  if (!backgroundContext || !graphicsContext || !typographyContext || !compositeContext) {
    throw new Error("Canvas export is not supported in this browser.");
  }

  const backgroundEdit = { ...createPosterLayerEdit(), ...(edits.background ?? {}) };
  if (backgroundEdit.visible) {
    backgroundContext.fillStyle = design.colors.background;
    backgroundContext.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    compositeContext.drawImage(background, 0, 0);
  }

  shapes.forEach((shape) => {
    const edit = { ...createPosterLayerEdit(), ...(edits[shape.id] ?? {}) };
    if (!edit.visible) return;
    drawShape(graphicsContext, shape, edit);
    drawShape(compositeContext, shape, edit);
  });
  texts.forEach((item) => {
    const edit = { ...createPosterLayerEdit(), ...(edits[item.id] ?? {}) };
    if (!edit.visible) return;
    drawText(typographyContext, item, headingStack, bodyStack, edit);
    drawText(compositeContext, item, headingStack, bodyStack, edit);
  });

  return { composite, background, graphics, typography };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Renders the same poster model the screen uses and downloads a raster image. */
export async function exportPosterAsImage(design: DesignState, format: "png" | "jpg", edits: PosterEdits = {}) {
  const { headingStack, bodyStack } = await prepareFonts(design);
  const { composite } = drawPosterLayers(design, headingStack, bodyStack, edits);
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  const blob = await canvasBlob(composite, mime, format === "jpg" ? 0.92 : undefined);
  if (!blob) throw new Error(`Could not create a ${format.toUpperCase()} from the poster.`);

  downloadBlob(blob, `${slug(design.projectName)}-poster.${format}`);
}

/** Renders a layered PSD that opens in Photoshop and other PSD-compatible editors. */
export async function exportPosterAsPsd(design: DesignState, edits: PosterEdits = {}) {
  const { headingStack, bodyStack } = await prepareFonts(design);
  const layers = drawPosterLayers(design, headingStack, bodyStack, edits);
  const buffer = writePsd({
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    canvas: layers.composite,
    children: [
      { name: "Typography", canvas: layers.typography },
      { name: "Graphics", canvas: layers.graphics },
      { name: "Background", canvas: layers.background }
    ]
  });

  downloadBlob(
    new Blob([buffer], { type: "image/vnd.adobe.photoshop" }),
    `${slug(design.projectName)}-poster.psd`,
  );
}

export async function exportPoster(design: DesignState, format: PosterExportFormat, edits: PosterEdits = {}) {
  if (format === "psd") {
    await exportPosterAsPsd(design, edits);
    return;
  }
  await exportPosterAsImage(design, format, edits);
}

/** Backwards-compatible PNG export used by callers that do not need format selection. */
export async function exportPosterAsPng(design: DesignState) {
  await exportPosterAsImage(design, "png");
}

export function exportBriefAsJson(
  design: DesignState,
  selectedPaletteId: string | null,
  posterEdits: PosterEdits = {},
) {
  const payload = {
    project: design.projectName,
    exportedAt: new Date().toISOString(),
    brief: getBrief(design, selectedPaletteId),
    design,
    posterEdits,
  };

  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `${slug(design.projectName)}-brief.json`,
  );
}

import type { DesignState } from "./design-types";
import { getBrief } from "./design-state";
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

function drawShape(ctx: CanvasRenderingContext2D, shape: PosterShape) {
  ctx.save();
  ctx.globalAlpha = shape.opacity;

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
) {
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
    return;
  }

  let cursor = startX;
  for (const char of item.text) {
    ctx.fillText(char, cursor, item.y);
    cursor += ctx.measureText(char).width + item.tracking;
  }
}

/** Renders the same poster model the screen uses and downloads it as a PNG. */
export async function exportPosterAsPng(design: DesignState) {
  const headingStack = resolveFontStack(design.typography.headingFont);
  const bodyStack = resolveFontStack(design.typography.bodyFont);

  await document.fonts.ready;
  await Promise.all([
    document.fonts.load(`${design.typography.headingWeight} 64px ${headingStack}`),
    document.fonts.load(`400 24px ${bodyStack}`),
    document.fonts.load(`600 24px ${bodyStack}`),
  ]).catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas export is not supported in this browser.");

  ctx.fillStyle = design.colors.background;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  const { shapes, texts } = buildPoster(design);
  shapes.forEach((shape) => drawShape(ctx, shape));
  texts.forEach((item) => drawText(ctx, item, headingStack, bodyStack));

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not create a PNG from the poster.");

  downloadBlob(blob, `${slug(design.projectName)}-poster.png`);
}

export function exportBriefAsJson(
  design: DesignState,
  selectedPaletteId: string | null,
) {
  const payload = {
    project: design.projectName,
    exportedAt: new Date().toISOString(),
    brief: getBrief(design, selectedPaletteId),
    design,
  };

  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `${slug(design.projectName)}-brief.json`,
  );
}

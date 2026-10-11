// Resolves a design document's relative geometry into absolute pixel boxes.
//
// This is the single source of layout truth. The SVG renderer draws this
// output and the deterministic validator inspects the same output, so the
// validator can never disagree with what was actually drawn. That mirrors the
// existing buildPoster() contract in lib/poster-layout.ts, which the on-screen
// SVG and the PNG exporter already share.
import type { DesignDocument, DesignElement, Frame, TextElement } from "./document.ts";

export type Box = { x: number; y: number; width: number; height: number };

export type TextLine = { text: string; x: number; y: number; width: number };

export type LaidOutElement = {
  element: DesignElement;
  box: Box;
  /** Group ancestry, outermost first. Used for clipping and overlap rules. */
  parents: string[];
  /** Present for text elements only. */
  lines?: TextLine[];
  fontSizePx?: number;
  /** Total height the text actually needs, which may exceed box.height. */
  contentHeight?: number;
};

export type Layout = {
  canvas: Box;
  safeArea: Box;
  nodes: LaidOutElement[];
  scale: number;
};

/**
 * Average glyph advance as a fraction of font size. Real metrics need a font
 * engine; these are deliberately slightly generous so the overflow check errs
 * toward warning rather than silently passing.
 */
const GLYPH_RATIO = { heading: 0.56, body: 0.52, mono: 0.6 } as const;

export function glyphRatio(element: TextElement) {
  const base = GLYPH_RATIO[element.role];
  const weightAdjust = element.weight >= 600 ? 0.03 : 0;
  const caseAdjust = element.transform === "uppercase" ? 0.06 : 0;
  return base + weightAdjust + caseAdjust;
}

export function measureText(value: string, fontSizePx: number, element: TextElement) {
  const tracking = element.letterSpacing * fontSizePx;
  return value.length * (fontSizePx * glyphRatio(element) + tracking);
}

/** Resolves a frame against its parent box, honouring the anchor. */
export function resolveFrame(frame: Frame, parent: Box): Box {
  const width = frame.width * parent.width;
  const height = frame.height * parent.height;
  const offsetX = frame.x * parent.width;
  const offsetY = frame.y * parent.height;

  const [vertical, horizontal] = frame.anchor.split("-");

  // x/y are an inset from the anchored edge, so a document stays correct when
  // the canvas is resized or the aspect ratio changes.
  let x: number;
  if (horizontal === "left") x = parent.x + offsetX;
  else if (horizontal === "right") x = parent.x + parent.width - width - offsetX;
  else x = parent.x + (parent.width - width) / 2 + offsetX;

  let y: number;
  if (vertical === "top") y = parent.y + offsetY;
  else if (vertical === "bottom") y = parent.y + parent.height - height - offsetY;
  else y = parent.y + (parent.height - height) / 2 + offsetY;

  return { x, y, width, height };
}

/** Greedy wrap. Explicit newlines are always honoured as hard breaks. */
export function wrapText(element: TextElement, fontSizePx: number, maxWidth: number) {
  const source = element.transform === "uppercase"
    ? element.text.toLocaleUpperCase()
    : element.transform === "lowercase"
      ? element.text.toLocaleLowerCase()
      : element.text;

  const out: string[] = [];
  for (const hardLine of source.split("\n")) {
    const words = hardLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let current = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (maxWidth > 0 && measureText(candidate, fontSizePx, element) > maxWidth) {
        out.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    out.push(current);
  }
  return out;
}

/**
 * Height the text genuinely needs at its current settings. Shared so the
 * planner, the reflow helper and the overflow check all agree; three
 * independent estimates would disagree and produce phantom failures.
 */
export function textContentHeight(element: TextElement, canvas: { width: number; height: number }) {
  const fontSizePx = element.size * canvas.width;
  const boxWidthPx = element.frame.width * canvas.width;
  const lines = wrapText(element, fontSizePx, boxWidthPx).length;
  return fontSizePx * 0.8 + Math.max(lines - 1, 0) * fontSizePx * element.lineHeight + fontSizePx * 0.3;
}

/**
 * Resizes a text element's frame to fit its content.
 *
 * Anything that changes type size, leading, tracking, casing or the copy
 * itself changes how much room the text needs. Without this, a revision like
 * "make the headline bigger" would leave the frame behind and the design
 * would fail its own overflow check.
 */
export function reflowText(element: TextElement, canvas: { width: number; height: number }): TextElement {
  const height = (textContentHeight(element, canvas) * 1.02) / canvas.height;
  return { ...element, frame: { ...element.frame, height } };
}

function layoutText(element: TextElement, box: Box, canvasWidth: number): LaidOutElement {
  const fontSizePx = element.size * canvasWidth;
  const lines = wrapText(element, fontSizePx, box.width);
  const lineHeightPx = fontSizePx * element.lineHeight;

  // The first baseline sits one ascent below the top of the box. 0.8 of the
  // font size is the usual approximation for cap height plus a little leading.
  const firstBaseline = box.y + fontSizePx * 0.8;

  const laidOutLines: TextLine[] = lines.map((line, index) => {
    const width = measureText(line, fontSizePx, element);
    const x =
      element.align === "left"
        ? box.x
        : element.align === "right"
          ? box.x + box.width
          : box.x + box.width / 2;
    return { text: line, x, y: firstBaseline + index * lineHeightPx, width };
  });

  const contentHeight = fontSizePx * 0.8 + Math.max(lines.length - 1, 0) * lineHeightPx + fontSizePx * 0.3;

  return { element, box, parents: [], lines: laidOutLines, fontSizePx, contentHeight };
}

export function layoutDocument(document: DesignDocument, outputWidth?: number): Layout {
  const scale = outputWidth ? outputWidth / document.canvas.width : 1;
  const width = document.canvas.width * scale;
  const height = document.canvas.height * scale;
  const canvas: Box = { x: 0, y: 0, width, height };

  const marginPx = document.canvas.safeMargin * Math.min(width, height);
  const safeArea: Box = {
    x: marginPx,
    y: marginPx,
    width: Math.max(width - marginPx * 2, 0),
    height: Math.max(height - marginPx * 2, 0),
  };

  const nodes: LaidOutElement[] = [];

  const visit = (elements: DesignElement[], parentBox: Box, parents: string[]) => {
    for (const element of elements) {
      const box = resolveFrame(element.frame, parentBox);
      const node =
        element.type === "text"
          ? { ...layoutText(element, box, width), parents }
          : { element, box, parents };
      nodes.push(node);
      if (element.type === "group") {
        visit(element.children, box, [...parents, element.id]);
      }
    }
  };

  visit(document.elements, canvas, []);
  return { canvas, safeArea, nodes, scale };
}

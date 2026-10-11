// Deterministic server-side renderer: design document -> SVG.
//
// SVG is the output format because it is the only one this project can produce
// faithfully with no new dependencies and no browser. lib/export.ts cannot run
// here: it needs document.fonts, getComputedStyle and a Canvas2D context.
//
// Everything written into the SVG is escaped. A design document can contain
// model-authored and user-authored text, so the renderer treats all of it as
// untrusted and never emits raw markup, script, or external references it was
// not explicitly given.
import type { DesignDocument, DesignElement } from "./document.ts";
import { layoutDocument, type Box, type LaidOutElement, type Layout } from "./layout.ts";

export type RenderWarning = { elementId: string; message: string };

export type RenderResult = {
  svg: string;
  layout: Layout;
  warnings: RenderWarning[];
  /** Elements the renderer could not draw. Never silently dropped. */
  unsupported: RenderWarning[];
  width: number;
  height: number;
};

export type RenderOptions = {
  /** Output width in pixels. Height follows the canvas aspect ratio. */
  width?: number;
  /** Omits the background rect, for exports that need transparency. */
  transparent?: boolean;
};

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

/**
 * Font families reach the renderer as CSS font stacks. Only a conservative
 * character set is allowed through so a stack can never terminate the
 * attribute and inject markup.
 */
function safeFontStack(stack: string) {
  const cleaned = stack.replace(/[^a-zA-Z0-9 ,'\-_]/g, "").trim();
  return cleaned || "sans-serif";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function opacityAttr(value: number) {
  return value >= 1 ? "" : ` opacity="${round(value)}"`;
}

function blendAttr(mode: string) {
  return mode === "normal" ? "" : ` style="mix-blend-mode:${mode}"`;
}

function transformAttr(rotation: number, box: Box) {
  if (!rotation) return "";
  const cx = round(box.x + box.width / 2);
  const cy = round(box.y + box.height / 2);
  return ` transform="rotate(${round(rotation)} ${cx} ${cy})"`;
}

function renderShape(node: LaidOutElement) {
  const element = node.element;
  if (element.type !== "shape") return "";
  const { box } = node;
  const fill = element.fill ? ` fill="${element.fill}"` : ` fill="none"`;
  const stroke = element.stroke
    ? ` stroke="${element.stroke}" stroke-width="${round(element.strokeWidth * box.width || 1)}"`
    : "";
  const common = `${fill}${stroke}${opacityAttr(element.opacity)}${blendAttr(element.blendMode)}${transformAttr(element.rotation, box)}`;

  switch (element.shape) {
    case "rect": {
      const r = element.radius ? ` rx="${round(element.radius * Math.min(box.width, box.height))}"` : "";
      return `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}"${r}${common}/>`;
    }
    case "ellipse":
      return `<ellipse cx="${round(box.x + box.width / 2)}" cy="${round(box.y + box.height / 2)}" rx="${round(box.width / 2)}" ry="${round(box.height / 2)}"${common}/>`;
    case "line":
      return `<line x1="${round(box.x)}" y1="${round(box.y)}" x2="${round(box.x + box.width)}" y2="${round(box.y + box.height)}"${common}/>`;
  }
}

function renderText(node: LaidOutElement, document: DesignDocument) {
  const element = node.element;
  if (element.type !== "text" || !node.lines || !node.fontSizePx) return "";

  const family = safeFontStack(document.typography[element.role]);
  const anchor = element.align === "left" ? "start" : element.align === "right" ? "end" : "middle";
  const tracking = element.letterSpacing * node.fontSizePx;

  const spans = node.lines
    .map(
      (line) =>
        `<tspan x="${round(line.x)}" y="${round(line.y)}">${escapeXml(line.text)}</tspan>`,
    )
    .join("");

  const italic = element.italic ? ` font-style="italic"` : "";
  const trackingAttr = tracking ? ` letter-spacing="${round(tracking)}"` : "";

  return (
    `<text font-family="${escapeXml(family)}" font-size="${round(node.fontSizePx)}"` +
    ` font-weight="${element.weight}" fill="${element.color}" text-anchor="${anchor}"` +
    `${italic}${trackingAttr}${opacityAttr(element.opacity)}${blendAttr(element.blendMode)}` +
    `${transformAttr(element.rotation, node.box)}>${spans}</text>`
  );
}

function renderTexture(node: LaidOutElement, defs: string[]) {
  const element = node.element;
  if (element.type !== "texture") return "";
  const { box } = node;
  const id = `tex-${escapeXml(element.id)}`;
  const size = Math.max(element.scale * box.width, 2);

  // Patterns are built from primitives so the output stays a self-contained
  // SVG with no external image references.
  const body =
    element.pattern === "grain"
      ? `<circle cx="${round(size / 2)}" cy="${round(size / 2)}" r="${round(size / 6)}" fill="${element.color}"/>`
      : element.pattern === "halftone"
        ? `<circle cx="${round(size / 2)}" cy="${round(size / 2)}" r="${round(size / 3)}" fill="${element.color}"/>`
        : `<path d="M0 ${round(size)} L${round(size)} 0" stroke="${element.color}" stroke-width="${round(Math.max(size / 8, 0.5))}"/>`;

  defs.push(
    `<pattern id="${id}" width="${round(size)}" height="${round(size)}" patternUnits="userSpaceOnUse">${body}</pattern>`,
  );

  return `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}" fill="url(#${id})"${opacityAttr(element.opacity)}${blendAttr(element.blendMode)}/>`;
}

/**
 * Images are drawn only when the asset has real bytes behind it. An unresolved
 * asset renders as a labelled placeholder and is reported as a warning, so a
 * design is never silently exported with a missing hero image.
 */
function renderImage(
  node: LaidOutElement,
  resolveAsset: ((assetId: string) => string | null) | undefined,
  warnings: RenderWarning[],
) {
  const element = node.element;
  if (element.type !== "image") return "";
  const { box } = node;

  const href = element.assetId && resolveAsset ? resolveAsset(element.assetId) : null;
  if (href) {
    const preserve =
      element.fit === "cover"
        ? "xMidYMid slice"
        : element.fit === "contain"
          ? "xMidYMid meet"
          : "none";
    return `<image href="${escapeXml(href)}" x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}" preserveAspectRatio="${preserve}"${opacityAttr(element.opacity)}${transformAttr(element.rotation, box)}/>`;
  }

  warnings.push({
    elementId: element.id,
    message: element.assetId
      ? `Image asset "${element.assetId}" has no stored bytes; a placeholder was drawn.`
      : "Image element has no asset assigned; a placeholder was drawn.",
  });

  const label = escapeXml((element.description || "image placeholder").slice(0, 60));
  const labelSize = Math.max(Math.min(box.width * 0.045, 28), 10);
  return (
    `<g${opacityAttr(element.opacity)}>` +
    `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}" fill="none" stroke="#999999" stroke-width="2" stroke-dasharray="12 8"/>` +
    `<text x="${round(box.x + box.width / 2)}" y="${round(box.y + box.height / 2)}" font-family="sans-serif" font-size="${round(labelSize)}" fill="#999999" text-anchor="middle">${label}</text>` +
    `</g>`
  );
}

export function renderDocumentToSvg(
  document: DesignDocument,
  options: RenderOptions & { resolveAsset?: (assetId: string) => string | null } = {},
): RenderResult {
  const layout = layoutDocument(document, options.width);
  const warnings: RenderWarning[] = [];
  const unsupported: RenderWarning[] = [];
  const defs: string[] = [];

  // Groups are emitted as nested <g>, so clipping and ordering survive.
  const openGroups: string[] = [];
  const parts: string[] = [];

  const renderNodes = (elements: DesignElement[], parentPath: string[]) => {
    for (const element of elements) {
      const node = layout.nodes.find(
        (candidate) => candidate.element.id === element.id && candidate.parents.length === parentPath.length,
      );
      if (!node) continue;

      if (element.type === "group") {
        const clipId = `clip-${escapeXml(element.id)}`;
        if (element.clip) {
          defs.push(
            `<clipPath id="${clipId}"><rect x="${round(node.box.x)}" y="${round(node.box.y)}" width="${round(node.box.width)}" height="${round(node.box.height)}"/></clipPath>`,
          );
        }
        parts.push(
          `<g${element.clip ? ` clip-path="url(#${clipId})"` : ""}${opacityAttr(element.opacity)}${blendAttr(element.blendMode)}${transformAttr(element.rotation, node.box)}>`,
        );
        openGroups.push(element.id);
        renderNodes(element.children, [...parentPath, element.id]);
        parts.push("</g>");
        openGroups.pop();
        continue;
      }

      switch (element.type) {
        case "text":
          parts.push(renderText(node, document));
          break;
        case "shape":
          parts.push(renderShape(node));
          break;
        case "texture":
          parts.push(renderTexture(node, defs));
          break;
        case "image":
          parts.push(renderImage(node, options.resolveAsset, warnings));
          break;
        default: {
          // Reported rather than dropped: a document must never render as
          // "fine" while part of it was quietly discarded.
          const unknown = element as DesignElement;
          unsupported.push({
            elementId: unknown.id,
            message: `Element type "${(unknown as { type: string }).type}" is not supported by the SVG renderer.`,
          });
        }
      }
    }
  };

  renderNodes(document.elements, []);

  const width = layout.canvas.width;
  const height = layout.canvas.height;
  const background = options.transparent
    ? ""
    : `<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="${document.canvas.background}"/>`;
  const defsBlock = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}"` +
    ` viewBox="0 0 ${round(width)} ${round(height)}" role="img">` +
    defsBlock +
    background +
    parts.join("") +
    `</svg>`;

  return { svg, layout, warnings, unsupported, width, height };
}

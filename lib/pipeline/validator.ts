// Deterministic quality checks. These are facts about the rendered geometry,
// not opinions, and they are kept strictly separate from the creative critique
// so that a flattering model score can never bury a broken export.
import type { DesignDocument, TextElement } from "./document.ts";
import { walkElements } from "./document.ts";
import type { Box, Layout } from "./layout.ts";
import { renderDocumentToSvg, type RenderWarning } from "./render.ts";
import type { StructuredBrief } from "./brief.ts";

export type CheckStatus = "pass" | "warn" | "fail";

export type Check = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  elementIds: string[];
  /** A failed critical check blocks export regardless of any other score. */
  critical: boolean;
};

export type DeterministicReport = {
  status: CheckStatus;
  checks: Check[];
  failed: Check[];
  warned: Check[];
};

function overlaps(a: Box, b: Box) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function area(box: Box) {
  return Math.max(box.width, 0) * Math.max(box.height, 0);
}

function contains(outer: Box, inner: Box, tolerance = 0.5) {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

function check(
  id: string,
  label: string,
  status: CheckStatus,
  detail: string,
  options: { elementIds?: string[]; critical?: boolean } = {},
): Check {
  return {
    id,
    label,
    status,
    detail,
    elementIds: options.elementIds ?? [],
    critical: options.critical ?? false,
  };
}

function requiredTextCheck(document: DesignDocument, brief: StructuredBrief | null): Check {
  if (!brief) {
    return check("required-text", "Required text present", "warn", "No brief is attached, so required copy could not be verified.");
  }

  const rendered: string[] = [];
  walkElements(document.elements, (element) => {
    if (element.type === "text") rendered.push(element.text.toLocaleLowerCase());
  });
  const haystack = rendered.join("\n");

  const required = [
    brief.requiredText.headline,
    brief.requiredText.subheadline,
    brief.requiredText.callToAction,
    ...brief.requiredText.details,
  ].filter((value): value is string => Boolean(value));

  const missing = required.filter((value) => !haystack.includes(value.toLocaleLowerCase()));

  if (missing.length > 0) {
    return check(
      "required-text",
      "Required text present",
      "fail",
      `Missing required copy: ${missing.join("; ")}`,
      { critical: true },
    );
  }
  return check("required-text", "Required text present", "pass", `All ${required.length} required strings are on the canvas.`);
}

function overflowCheck(layout: Layout): Check {
  const offenders = layout.nodes.filter(
    (node) => node.element.type === "text" && node.contentHeight !== undefined && node.contentHeight > node.box.height + 1,
  );
  if (offenders.length === 0) {
    return check("text-overflow", "Text fits its box", "pass", "No text element exceeds its frame.");
  }
  const detail = offenders
    .map((node) => `${node.element.id} needs ${Math.ceil(node.contentHeight ?? 0)}px in a ${Math.round(node.box.height)}px box`)
    .join("; ");
  return check("text-overflow", "Text fits its box", "fail", detail, {
    elementIds: offenders.map((node) => node.element.id),
    critical: true,
  });
}

function boundsCheck(layout: Layout): Check {
  const offenders = layout.nodes.filter((node) => !contains(layout.canvas, node.box));
  if (offenders.length === 0) {
    return check("canvas-bounds", "Content inside canvas", "pass", "Every element is within the canvas.");
  }
  return check(
    "canvas-bounds",
    "Content inside canvas",
    "warn",
    `Extends past the canvas edge: ${offenders.map((node) => node.element.id).join(", ")}. This is only correct if the bleed is intentional.`,
    { elementIds: offenders.map((node) => node.element.id) },
  );
}

function safeMarginCheck(layout: Layout): Check {
  const offenders = layout.nodes.filter(
    (node) => node.element.type === "text" && !contains(layout.safeArea, node.box),
  );
  if (offenders.length === 0) {
    return check("safe-margin", "Text inside safe margin", "pass", "All text sits within the safe area.");
  }
  return check(
    "safe-margin",
    "Text inside safe margin",
    "warn",
    `Text crosses the safe margin: ${offenders.map((node) => node.element.id).join(", ")}.`,
    { elementIds: offenders.map((node) => node.element.id) },
  );
}

/** Flags text pairs that collide. Backgrounds and textures are expected to sit under content. */
function overlapCheck(layout: Layout): Check {
  const textNodes = layout.nodes.filter((node) => node.element.type === "text");
  const collisions: string[] = [];
  const ids = new Set<string>();

  for (let i = 0; i < textNodes.length; i += 1) {
    for (let j = i + 1; j < textNodes.length; j += 1) {
      const a = textNodes[i];
      const b = textNodes[j];
      const shared = overlaps(a.box, b.box);
      const smaller = Math.min(area(a.box), area(b.box));
      if (smaller > 0 && shared / smaller > 0.2) {
        collisions.push(`${a.element.id} and ${b.element.id}`);
        ids.add(a.element.id);
        ids.add(b.element.id);
      }
    }
  }

  if (collisions.length === 0) {
    return check("text-overlap", "No text collisions", "pass", "No two text blocks overlap significantly.");
  }
  return check("text-overlap", "No text collisions", "fail", `Overlapping text: ${collisions.join("; ")}.`, {
    elementIds: [...ids],
    critical: true,
  });
}

function assetCheck(document: DesignDocument, warnings: RenderWarning[]): Check {
  if (warnings.length === 0) {
    return check("assets-resolved", "Assets resolved", "pass", "Every image element has stored bytes.");
  }
  return check(
    "assets-resolved",
    "Assets resolved",
    "fail",
    warnings.map((warning) => warning.message).join(" "),
    { elementIds: warnings.map((warning) => warning.elementId), critical: true },
  );
}

/** Inspiration-only references must never reach a published export. */
function licensingCheck(document: DesignDocument): Check {
  const offenders: string[] = [];
  walkElements(document.elements, (element) => {
    const provenance = element.provenance;
    if (!provenance) return;
    if (provenance.source === "none" || provenance.source === "procedural") return;
    if (!provenance.cleared) offenders.push(element.id);
  });

  if (offenders.length === 0) {
    return check("licensing", "Assets cleared for use", "pass", "No uncleared third-party assets are placed.");
  }
  return check(
    "licensing",
    "Assets cleared for use",
    "fail",
    `Not cleared for publication: ${offenders.join(", ")}. References are inspiration, not production assets.`,
    { elementIds: offenders, critical: true },
  );
}

function resolutionCheck(layout: Layout, document: DesignDocument): Check {
  // A poster printed at 300dpi needs roughly 1000px across at A3. Below ~900px
  // the raster output will look soft, so warn rather than fail.
  const shortEdge = Math.min(document.canvas.width, document.canvas.height);
  if (shortEdge >= 900) {
    return check("resolution", "Canvas resolution", "pass", `${document.canvas.width}x${document.canvas.height} is adequate for print.`);
  }
  return check(
    "resolution",
    "Canvas resolution",
    "warn",
    `${document.canvas.width}x${document.canvas.height} is small; raster exports may look soft in print.`,
  );
}

function dimensionsCheck(document: DesignDocument, brief: StructuredBrief | null): Check {
  if (!brief) {
    return check("dimensions", "Output dimensions", "warn", "No brief attached, so dimensions were not checked.");
  }
  const { width, height } = brief.dimensions;
  if (document.canvas.width === width && document.canvas.height === height) {
    return check("dimensions", "Output dimensions", "pass", `Canvas matches the brief at ${width}x${height}.`);
  }
  return check(
    "dimensions",
    "Output dimensions",
    "fail",
    `Canvas is ${document.canvas.width}x${document.canvas.height} but the brief asks for ${width}x${height}.`,
    { critical: true },
  );
}

function rendererSupportCheck(unsupported: RenderWarning[]): Check {
  if (unsupported.length === 0) {
    return check("renderer-support", "All elements renderable", "pass", "The renderer supports every element in the document.");
  }
  return check(
    "renderer-support",
    "All elements renderable",
    "fail",
    unsupported.map((entry) => entry.message).join(" "),
    { elementIds: unsupported.map((entry) => entry.elementId), critical: true },
  );
}

function contrastCheck(document: DesignDocument, layout: Layout): Check {
  // Relative luminance per WCAG. Only compares text against the canvas
  // background, since full compositing would need a raster buffer.
  const luminance = (hex: string) => {
    const channel = (value: number) => {
      const srgb = value / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    };
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const bg = luminance(document.canvas.background);
  const weak: string[] = [];

  for (const node of layout.nodes) {
    if (node.element.type !== "text") continue;
    const fg = luminance((node.element as TextElement).color);
    const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
    if (ratio < 3) weak.push(`${node.element.id} (${ratio.toFixed(1)}:1)`);
  }

  if (weak.length === 0) {
    return check("contrast", "Text contrast", "pass", "All text clears a 3:1 ratio against the background.");
  }
  return check("contrast", "Text contrast", "warn", `Low contrast against the background: ${weak.join(", ")}.`, {
    elementIds: weak.map((entry) => entry.split(" ")[0]),
  });
}

export function runDeterministicChecks(
  document: DesignDocument,
  options: { brief?: StructuredBrief | null; resolveAsset?: (assetId: string) => string | null } = {},
): DeterministicReport {
  const render = renderDocumentToSvg(document, { resolveAsset: options.resolveAsset });
  const brief = options.brief ?? null;

  const checks = [
    requiredTextCheck(document, brief),
    dimensionsCheck(document, brief),
    overflowCheck(render.layout),
    overlapCheck(render.layout),
    boundsCheck(render.layout),
    safeMarginCheck(render.layout),
    assetCheck(document, render.warnings),
    licensingCheck(document),
    rendererSupportCheck(render.unsupported),
    resolutionCheck(render.layout, document),
    contrastCheck(document, render.layout),
  ];

  const failed = checks.filter((entry) => entry.status === "fail");
  const warned = checks.filter((entry) => entry.status === "warn");

  return {
    status: failed.length > 0 ? "fail" : warned.length > 0 ? "warn" : "pass",
    checks,
    failed,
    warned,
  };
}

/** Export is blocked only by critical failures, never by a creative opinion. */
export function blocksExport(report: DeterministicReport) {
  return report.failed.filter((entry) => entry.critical);
}

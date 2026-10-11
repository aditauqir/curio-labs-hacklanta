// The design document: the editable, serialisable, versionable representation
// of a design. It is the single source of truth that the renderer, the
// validator and the revision engine all read.
//
// Two deliberate choices:
//
// 1. Geometry is RELATIVE. Every frame value is a fraction of the canvas
//    (0..1), and type sizes are a fraction of canvas width. A document can
//    therefore be rendered at any output size, and a format change from poster
//    to social graphic does not invalidate the layout. The renderer is the only
//    place fractions become pixels.
//
// 2. Elements form a TREE. Groups carry children and can clip them, so layers
//    and masking are expressible without a bespoke format.
import {
  Collector,
  bool,
  hexColor,
  identifier,
  isRecord,
  num,
  oneOf,
  stringList,
  text,
  type Issue,
  type Validated,
} from "./validate.ts";

export const ANCHORS = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const;
export type Anchor = (typeof ANCHORS)[number];

export const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const FONT_ROLES = ["heading", "body", "mono"] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const TEXT_TRANSFORMS = ["none", "uppercase", "lowercase"] as const;
export type TextTransform = (typeof TEXT_TRANSFORMS)[number];

export const SHAPE_KINDS = ["rect", "ellipse", "line"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const IMAGE_FITS = ["cover", "contain", "fill"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

export const TEXTURE_PATTERNS = ["grain", "halftone", "hatch"] as const;
export type TexturePattern = (typeof TEXTURE_PATTERNS)[number];

export const ASSET_SOURCES = ["user-upload", "licensed-retrieval", "generated", "procedural", "none"] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

/** Where an element's pixels came from, and whether they may be published. */
export type Provenance = {
  source: AssetSource;
  assetId: string | null;
  creator: string | null;
  sourceUrl: string | null;
  license: string | null;
  /** False for inspiration-only references that must not ship in an export. */
  cleared: boolean;
  generator: string | null;
  note: string | null;
};

/** Position and size as fractions of the canvas, resolved at render time. */
export type Frame = {
  anchor: Anchor;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ElementBase = {
  id: string;
  name: string;
  frame: Frame;
  rotation: number;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  editable: boolean;
  provenance: Provenance | null;
};

export type TextElement = ElementBase & {
  type: "text";
  text: string;
  role: FontRole;
  /** Fraction of canvas width. 0.14 is roughly a 151px headline at 1080 wide. */
  size: number;
  weight: number;
  letterSpacing: number;
  lineHeight: number;
  align: TextAlign;
  transform: TextTransform;
  color: string;
  italic: boolean;
  /** Content the brief marked as required, so the validator can check it. */
  required: boolean;
};

export type ImageElement = ElementBase & {
  type: "image";
  assetId: string | null;
  fit: ImageFit;
  /** Placeholder description shown when no asset has been produced yet. */
  description: string;
};

export type ShapeElement = ElementBase & {
  type: "shape";
  shape: ShapeKind;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
};

export type TextureElement = ElementBase & {
  type: "texture";
  pattern: TexturePattern;
  color: string;
  scale: number;
};

export type GroupElement = ElementBase & {
  type: "group";
  clip: boolean;
  children: DesignElement[];
};

export type DesignElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | TextureElement
  | GroupElement;

export type DesignDocument = {
  schemaVersion: 1;
  canvas: {
    width: number;
    height: number;
    background: string;
    /** Fraction of the shorter canvas edge kept clear of content. */
    safeMargin: number;
  };
  typography: {
    heading: string;
    body: string;
    mono: string;
  };
  palette: {
    background: string;
    foreground: string;
    accent: string;
    muted: string;
  };
  elements: DesignElement[];
  meta: {
    conceptId: string | null;
    format: string;
    notes: string[];
  };
};

const MAX_ELEMENTS = 120;
const MAX_DEPTH = 5;

const DEFAULT_PROVENANCE: Provenance = {
  source: "procedural",
  assetId: null,
  creator: null,
  sourceUrl: null,
  license: null,
  cleared: true,
  generator: null,
  note: null,
};

export function defaultFrame(partial: Partial<Frame> = {}): Frame {
  return {
    anchor: partial.anchor ?? "top-left",
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 1,
    height: partial.height ?? 0.1,
  };
}

function parseProvenance(raw: unknown): Provenance | null {
  if (!isRecord(raw)) return null;
  const source = oneOf(raw.source, ASSET_SOURCES) ?? "none";
  return {
    source,
    assetId: text(raw.assetId, 128),
    creator: text(raw.creator, 160),
    sourceUrl: text(raw.sourceUrl, 500),
    license: text(raw.license, 120),
    // Only an explicit true clears an asset for publication. Anything else is
    // treated as inspiration-only, which the export validator enforces.
    cleared: raw.cleared === true,
    generator: text(raw.generator, 120),
    note: text(raw.note, 400),
  };
}

function parseFrame(raw: unknown, c: Collector): Frame {
  if (!isRecord(raw)) {
    c.reject("frame must be an object");
    return defaultFrame();
  }
  return {
    anchor: oneOf(raw.anchor, ANCHORS) ?? "top-left",
    x: num(raw.x, -1, 2) ?? 0,
    y: num(raw.y, -1, 2) ?? 0,
    width: num(raw.width, 0, 2) ?? 1,
    height: num(raw.height, 0, 2) ?? 0.1,
  };
}

function parseElement(raw: unknown, c: Collector, depth: number, seen: Set<string>): DesignElement | null {
  if (!isRecord(raw)) {
    c.reject("element must be an object");
    return null;
  }

  const id = identifier(raw.id);
  if (!id) {
    c.reject("element id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}");
    return null;
  }
  if (seen.has(id)) {
    c.at("id").reject(`duplicate element id "${id}"`);
    return null;
  }
  seen.add(id);

  const type = oneOf(raw.type, ["text", "image", "shape", "texture", "group"] as const);
  if (!type) {
    c.at("type").reject("unsupported element type");
    return null;
  }

  const base: ElementBase = {
    id,
    name: text(raw.name, 120) ?? id,
    frame: parseFrame(raw.frame, c.at("frame")),
    rotation: num(raw.rotation, -180, 180) ?? 0,
    opacity: num(raw.opacity, 0, 1) ?? 1,
    blendMode: oneOf(raw.blendMode, BLEND_MODES) ?? "normal",
    locked: bool(raw.locked, false),
    editable: bool(raw.editable, true),
    provenance: parseProvenance(raw.provenance),
  };

  switch (type) {
    case "text": {
      const value = text(raw.text, 400, { newlines: true });
      if (!value) {
        c.at("text").reject("text element has no content");
        return null;
      }
      return {
        ...base,
        type,
        text: value,
        role: oneOf(raw.role, FONT_ROLES) ?? "body",
        size: num(raw.size, 0.005, 0.5) ?? 0.03,
        weight: num(raw.weight, 100, 900) ?? 400,
        letterSpacing: num(raw.letterSpacing, -0.05, 0.3) ?? 0,
        lineHeight: num(raw.lineHeight, 0.6, 3) ?? 1.1,
        align: oneOf(raw.align, TEXT_ALIGNS) ?? "left",
        transform: oneOf(raw.transform, TEXT_TRANSFORMS) ?? "none",
        color: hexColor(raw.color) ?? "#000000",
        italic: bool(raw.italic, false),
        required: bool(raw.required, false),
      };
    }
    case "image":
      return {
        ...base,
        type,
        assetId: text(raw.assetId, 128),
        fit: oneOf(raw.fit, IMAGE_FITS) ?? "cover",
        description: text(raw.description, 400) ?? "",
      };
    case "shape":
      return {
        ...base,
        type,
        shape: oneOf(raw.shape, SHAPE_KINDS) ?? "rect",
        fill: hexColor(raw.fill),
        stroke: hexColor(raw.stroke),
        strokeWidth: num(raw.strokeWidth, 0, 0.1) ?? 0,
        radius: num(raw.radius, 0, 0.5) ?? 0,
      };
    case "texture":
      return {
        ...base,
        type,
        pattern: oneOf(raw.pattern, TEXTURE_PATTERNS) ?? "grain",
        color: hexColor(raw.color) ?? "#000000",
        scale: num(raw.scale, 0.001, 0.2) ?? 0.01,
      };
    case "group": {
      if (depth >= MAX_DEPTH) {
        c.reject(`group nesting deeper than ${MAX_DEPTH} is not supported`);
        return null;
      }
      const children = parseElements(raw.children, c.at("children"), depth + 1, seen);
      return { ...base, type, clip: bool(raw.clip, false), children };
    }
  }
}

function parseElements(raw: unknown, c: Collector, depth: number, seen: Set<string>): DesignElement[] {
  if (!Array.isArray(raw)) {
    c.reject("elements must be an array");
    return [];
  }
  const out: DesignElement[] = [];
  raw.forEach((entry, index) => {
    if (seen.size >= MAX_ELEMENTS) return;
    const element = parseElement(entry, c.at(index), depth, seen);
    if (element) out.push(element);
  });
  return out;
}

/**
 * Validates an untrusted design document. Unsupported elements are reported as
 * issues rather than silently dropped, which is what lets the renderer promise
 * that what it draws matches what was saved.
 */
export function parseDesignDocument(raw: unknown): Validated<DesignDocument> {
  const c = new Collector();
  if (!isRecord(raw)) return { ok: false, issues: [{ path: "(root)", message: "document must be an object" }] };

  const canvasRaw = isRecord(raw.canvas) ? raw.canvas : {};
  const typographyRaw = isRecord(raw.typography) ? raw.typography : {};
  const paletteRaw = isRecord(raw.palette) ? raw.palette : {};
  const metaRaw = isRecord(raw.meta) ? raw.meta : {};

  const width = num(canvasRaw.width, 64, 10000);
  const height = num(canvasRaw.height, 64, 10000);
  if (width === null) c.at("canvas").at("width").reject("canvas width must be 64..10000");
  if (height === null) c.at("canvas").at("height").reject("canvas height must be 64..10000");

  const document: DesignDocument = {
    schemaVersion: 1,
    canvas: {
      width: width ?? 1080,
      height: height ?? 1350,
      background: hexColor(canvasRaw.background) ?? "#FFFFFF",
      safeMargin: num(canvasRaw.safeMargin, 0, 0.3) ?? 0.06,
    },
    typography: {
      heading: text(typographyRaw.heading, 160) ?? "Georgia, serif",
      body: text(typographyRaw.body, 160) ?? "Helvetica, Arial, sans-serif",
      mono: text(typographyRaw.mono, 160) ?? "ui-monospace, monospace",
    },
    palette: {
      background: hexColor(paletteRaw.background) ?? "#FFFFFF",
      foreground: hexColor(paletteRaw.foreground) ?? "#111111",
      accent: hexColor(paletteRaw.accent) ?? "#D8784C",
      muted: hexColor(paletteRaw.muted) ?? "#999999",
    },
    elements: parseElements(raw.elements, c.at("elements"), 0, new Set()),
    meta: {
      conceptId: text(metaRaw.conceptId, 64),
      format: text(metaRaw.format, 64) ?? "poster",
      notes: stringList(metaRaw.notes, 20, 300),
    },
  };

  if (!c.ok) return { ok: false, issues: c.issues };
  return { ok: true, value: document };
}

/** Depth-first walk over the element tree, parents before children. */
export function walkElements(
  elements: DesignElement[],
  visit: (element: DesignElement, parents: GroupElement[]) => void,
  parents: GroupElement[] = [],
) {
  for (const element of elements) {
    visit(element, parents);
    if (element.type === "group") walkElements(element.children, visit, [...parents, element]);
  }
}

export function findElement(document: DesignDocument, id: string): DesignElement | null {
  let found: DesignElement | null = null;
  walkElements(document.elements, (element) => {
    if (element.id === id) found = element;
  });
  return found;
}

/**
 * Replaces one element in place, returning a new document. Everything the
 * caller did not name is copied through untouched, which is what makes a
 * targeted revision safe.
 */
export function replaceElement(
  document: DesignDocument,
  id: string,
  update: (element: DesignElement) => DesignElement,
): { document: DesignDocument; changed: boolean } {
  let changed = false;

  const mapAll = (elements: DesignElement[]): DesignElement[] =>
    elements.map((element) => {
      if (element.id === id) {
        changed = true;
        return update(element);
      }
      if (element.type === "group") {
        return { ...element, children: mapAll(element.children) };
      }
      return element;
    });

  return { document: { ...document, elements: mapAll(document.elements) }, changed };
}

export function countElements(document: DesignDocument) {
  let total = 0;
  walkElements(document.elements, () => {
    total += 1;
  });
  return total;
}

export function documentIssuesToText(issues: Issue[]) {
  return issues.map((issue) => `${issue.path}: ${issue.message}`);
}

export { DEFAULT_PROVENANCE };

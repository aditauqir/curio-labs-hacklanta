/**
 * The editor keeps the tool selection separate from poster data. That mirrors
 * GIMP's tool/options model: changing tools never rasterizes or mutates the
 * source layer until the user performs an operation on the canvas.
 */
export type PosterTool =
  | "select"
  | "rectangle-select"
  | "text"
  | "crop"
  | "brush"
  | "eraser"
  | "stamp"
  | "dropper"
  | "fill"
  | "hand";

export type PosterLayerEdit = {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  /** Optional text-only override; absent means use the generated layer weight. */
  weight?: number;
  /** Optional text-only font-size override in poster pixels. */
  fontSize?: number;
  /** Optional text-only tracking override in poster pixels. */
  tracking?: number;
  /** Optional graphic/text color overrides. */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  visible: boolean;
  locked: boolean;
};

export type PosterEdits = Record<string, PosterLayerEdit>;

export function createPosterLayerEdit(): PosterLayerEdit {
  return {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
}

export function ensurePosterLayerEdits(
  ids: string[],
  edits: PosterEdits,
): PosterEdits {
  const next: PosterEdits = {};
  for (const id of ids) {
    next[id] = edits[id] ? { ...createPosterLayerEdit(), ...edits[id] } : createPosterLayerEdit();
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function optionalWeight(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(900, Math.max(100, Math.round(value / 100) * 100))
    : undefined;
}

export function sanitizePosterEdits(raw: unknown): PosterEdits {
  if (!isRecord(raw)) return {};

  const result: PosterEdits = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const weight = optionalWeight(value.weight);
    result[id.slice(0, 80)] = {
      x: number(value.x, 0, -4000, 4000),
      y: number(value.y, 0, -4000, 4000),
      scale: number(value.scale, 1, 0.05, 12),
      scaleX: number(value.scaleX, 1, 0.05, 12),
      scaleY: number(value.scaleY, 1, 0.05, 12),
      rotation: number(value.rotation, 0, -360, 360),
      opacity: number(value.opacity, 1, 0, 1),
      ...(weight ? { weight } : {}),
      ...(typeof value.fontSize === "number" && Number.isFinite(value.fontSize)
        ? { fontSize: Math.min(600, Math.max(8, value.fontSize)) }
        : {}),
      ...(typeof value.tracking === "number" && Number.isFinite(value.tracking)
        ? { tracking: Math.min(160, Math.max(-80, value.tracking)) }
        : {}),
      ...(typeof value.fill === "string" && /^#[0-9a-f]{6}$/i.test(value.fill)
        ? { fill: value.fill.toUpperCase() }
        : {}),
      ...(typeof value.stroke === "string" && /^#[0-9a-f]{6}$/i.test(value.stroke)
        ? { stroke: value.stroke.toUpperCase() }
        : {}),
      ...(typeof value.strokeWidth === "number" && Number.isFinite(value.strokeWidth)
        ? { strokeWidth: Math.min(100, Math.max(0, value.strokeWidth)) }
        : {}),
      visible: boolean(value.visible, true),
      locked: boolean(value.locked, false),
    };
  }
  return result;
}

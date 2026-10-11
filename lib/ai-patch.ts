import type {
  DesignDirection,
  DesignState,
  Spacing,
  TextAlignment,
} from "./design-types";
import {
  colorPalettes,
  directionConfigs,
  directionOrder,
  fontPairs,
  getFontPair,
  getPalette,
} from "./design-presets";
import { HEX_COLOR, type StudioAction } from "./design-state";
import { buildPoster } from "./poster-layout";

export type AiLayerEdit = {
  /** Exact layer id from the canvas model. x/y are absolute transform offsets. */
  id: string;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
};

/**
 * The only shape AI output is allowed to take. Every field is optional because
 * a patch contains just the properties the user asked to change.
 */
export type AiPatch = {
  direction?: DesignDirection;
  paletteId?: string;
  fontPairId?: string;
  accent?: string;
  background?: string;
  foreground?: string;
  alignment?: TextAlignment;
  spacing?: Spacing;
  headline?: string;
  subtitle?: string;
  mood?: string;
  layerEdits?: AiLayerEdit[];
};

export const PATCH_KEYS = [
  "direction",
  "paletteId",
  "fontPairId",
  "accent",
  "background",
  "foreground",
  "alignment",
  "spacing",
  "headline",
  "subtitle",
  "mood",
  "layerEdits",
] as const satisfies readonly (keyof AiPatch)[];

const ALIGNMENTS: readonly TextAlignment[] = ["left", "center", "right"];
const SPACINGS: readonly Spacing[] = ["compact", "normal", "spacious"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Strips control characters (except newline) so model text cannot smuggle them into the poster.
function cleanText(value: string, max: number, keepNewlines: boolean) {
  const stripped = value.replace(
    keepNewlines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g,
    "",
  );
  return stripped.trim().slice(0, max);
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (HEX_COLOR.test(trimmed)) return trimmed.toUpperCase();
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(trimmed);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  return null;
}

/**
 * Validates untrusted model output against strict whitelists. Anything that is
 * not an allowed id, a real hex color, or bounded plain text is dropped and
 * reported in `skipped`, so the UI never claims a change that was not applied.
 */
export function validatePatch(raw: unknown): { patch: AiPatch; skipped: string[] } {
  const patch: AiPatch = {};
  const skipped: string[] = [];
  if (!isRecord(raw)) return { patch, skipped };

  const present = (key: string) => {
    const value = raw[key];
    return value !== undefined && value !== null && value !== "";
  };

  if (present("direction")) {
    const value = raw.direction;
    if (typeof value === "string" && (directionOrder as string[]).includes(value)) {
      patch.direction = value as DesignDirection;
    } else skipped.push("direction");
  }

  if (present("paletteId")) {
    const value = raw.paletteId;
    if (typeof value === "string" && colorPalettes.some((p) => p.id === value)) {
      patch.paletteId = value;
    } else skipped.push("paletteId");
  }

  if (present("fontPairId")) {
    const value = raw.fontPairId;
    if (typeof value === "string" && fontPairs.some((p) => p.id === value)) {
      patch.fontPairId = value;
    } else skipped.push("fontPairId");
  }

  for (const key of ["accent", "background", "foreground"] as const) {
    if (!present(key)) continue;
    const value = raw[key];
    const hex = typeof value === "string" ? normalizeHex(value) : null;
    if (hex) patch[key] = hex;
    else skipped.push(key);
  }

  if (present("alignment")) {
    const value = raw.alignment;
    if (typeof value === "string" && (ALIGNMENTS as string[]).includes(value)) {
      patch.alignment = value as TextAlignment;
    } else skipped.push("alignment");
  }

  if (present("spacing")) {
    const value = raw.spacing;
    if (typeof value === "string" && (SPACINGS as string[]).includes(value)) {
      patch.spacing = value as Spacing;
    } else skipped.push("spacing");
  }

  const textFields: { key: "headline" | "subtitle" | "mood"; max: number; newlines: boolean }[] = [
    { key: "headline", max: 80, newlines: true },
    { key: "subtitle", max: 120, newlines: false },
    { key: "mood", max: 80, newlines: false },
  ];
  for (const { key, max, newlines } of textFields) {
    if (!present(key)) continue;
    const value = raw[key];
    const cleaned = typeof value === "string" ? cleanText(value, max, newlines) : "";
    if (cleaned) patch[key] = cleaned;
    else skipped.push(key);
  }

  if (present("layerEdits")) {
    const rawEdits = raw.layerEdits;
    if (!Array.isArray(rawEdits)) {
      skipped.push("layerEdits");
    } else {
      const edits: AiLayerEdit[] = [];
      for (const rawEdit of rawEdits.slice(0, 4)) {
        if (!isRecord(rawEdit) || typeof rawEdit.id !== "string") {
          skipped.push("layerEdits");
          continue;
        }

        const id = rawEdit.id.trim().slice(0, 80);
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
          skipped.push(`layerEdits.${id || "unknown"}`);
          continue;
        }

        const edit: AiLayerEdit = { id };
        let hasValue = false;
        let invalid = false;
        for (const key of ["x", "y", "scale", "rotation", "opacity"] as const) {
          if (rawEdit[key] === undefined) continue;
          if (typeof rawEdit[key] !== "number" || !Number.isFinite(rawEdit[key])) {
            invalid = true;
            continue;
          }
          const ranges = {
            x: [-4000, 4000],
            y: [-4000, 4000],
            scale: [0.05, 12],
            rotation: [-360, 360],
            opacity: [0, 1],
          } as const;
          const [min, max] = ranges[key];
          if (rawEdit[key] < min || rawEdit[key] > max) {
            invalid = true;
            continue;
          }
          edit[key] = rawEdit[key];
          hasValue = true;
        }
        for (const key of ["visible", "locked"] as const) {
          if (rawEdit[key] === undefined) continue;
          if (typeof rawEdit[key] !== "boolean") {
            invalid = true;
            continue;
          }
          edit[key] = rawEdit[key];
          hasValue = true;
        }

        if (invalid || !hasValue) {
          skipped.push(`layerEdits.${id}`);
        } else {
          edits.push(edit);
        }
      }
      if (edits.length > 0) patch.layerEdits = edits;
    }
  }

  return { patch, skipped };
}

const KEEP_LAYOUT =
  /\bkeep (?:the |my |this |that |it(?:s)? )?(?:same )?layout\b|\bsame layout\b|\b(?:don'?t|do not|never) (?:change|touch|alter|move) (?:the |my )?layout\b|\bwithout (?:changing|touching|altering) (?:the |my )?layout\b|\bleave (?:the )?layout\b/i;

/** True when the user asked for the layout to stay exactly as it is. */
export function wantsLayoutKept(message: string) {
  return KEEP_LAYOUT.test(message);
}

function sameColor(a: string, b: string) {
  return a.toUpperCase() === b.toUpperCase();
}

/**
 * Enforces the user's intent deterministically instead of trusting the model:
 * - "keep the layout" removes direction, alignment and spacing. A requested
 *   direction becomes its palette and typography so the intent still lands.
 * - values that already match the current design are dropped, so the change
 *   list only shows things that really changed.
 */
export function reconcilePatch(
  patch: AiPatch,
  design: DesignState,
  message: string,
): AiPatch {
  const next: AiPatch = { ...patch };

  if (next.layerEdits) {
    const poster = buildPoster(design);
    const validIds = new Set([
      "background",
      ...poster.shapes.map((shape) => shape.id),
      ...poster.texts.map((text) => text.id),
    ]);
    next.layerEdits = next.layerEdits.filter(
      (edit) => edit.id !== "background" && validIds.has(edit.id),
    );
    if (next.layerEdits.length === 0) delete next.layerEdits;
  }

  if (wantsLayoutKept(message)) {
    if (next.direction) {
      const config = directionConfigs[next.direction];
      next.paletteId ??= config.paletteId;
      next.fontPairId ??= config.fontPairId;
    }
    delete next.direction;
    delete next.alignment;
    delete next.spacing;
  }

  if (next.direction === design.direction) delete next.direction;
  if (next.fontPairId === design.typography.id) delete next.fontPairId;
  if (next.alignment === design.layout.alignment) delete next.alignment;
  if (next.spacing === design.layout.spacing) delete next.spacing;
  if (next.headline === design.headline) delete next.headline;
  if (next.subtitle === design.subtitle) delete next.subtitle;
  if (next.mood === design.mood) delete next.mood;
  if (next.accent && sameColor(next.accent, design.colors.accent)) delete next.accent;
  if (next.background && sameColor(next.background, design.colors.background)) delete next.background;
  if (next.foreground && sameColor(next.foreground, design.colors.foreground)) delete next.foreground;

  if (next.paletteId) {
    const palette = getPalette(next.paletteId);
    const identical =
      palette &&
      sameColor(palette.colors.background, design.colors.background) &&
      sameColor(palette.colors.foreground, design.colors.foreground) &&
      sameColor(palette.colors.accent, design.colors.accent) &&
      sameColor(palette.colors.muted, design.colors.muted);
    if (identical) delete next.paletteId;
  }

  if (next.layerEdits) {
    // An AI response must not write a no-op transform into the persisted state.
    next.layerEdits = next.layerEdits.filter((edit) =>
      Object.entries(edit).some(([key, value]) => key !== "id" && value !== undefined),
    );
    if (next.layerEdits.length === 0) delete next.layerEdits;
  }

  return next;
}

export function hasChanges(patch: AiPatch) {
  return PATCH_KEYS.some((key) => patch[key] !== undefined);
}

/**
 * Maps a validated patch onto the same reducer actions the manual controls use.
 * Order matters: direction first (it resets the preset), then palette, then
 * individual overrides so a specific color wins over a palette.
 */
export function patchToActions(patch: AiPatch): StudioAction[] {
  const actions: StudioAction[] = [];

  if (patch.direction) actions.push({ type: "setDirection", direction: patch.direction });
  if (patch.paletteId) actions.push({ type: "setPalette", id: patch.paletteId });
  if (patch.fontPairId) actions.push({ type: "setFontPair", id: patch.fontPairId });
  if (patch.background) actions.push({ type: "setColor", key: "background", value: patch.background });
  if (patch.foreground) actions.push({ type: "setColor", key: "foreground", value: patch.foreground });
  if (patch.accent) actions.push({ type: "setColor", key: "accent", value: patch.accent });
  if (patch.alignment) actions.push({ type: "setAlignment", value: patch.alignment });
  if (patch.spacing) actions.push({ type: "setSpacing", value: patch.spacing });
  if (patch.headline) actions.push({ type: "setCopy", key: "headline", value: patch.headline });
  if (patch.subtitle) actions.push({ type: "setCopy", key: "subtitle", value: patch.subtitle });
  if (patch.mood) actions.push({ type: "setMood", value: patch.mood });
  for (const edit of patch.layerEdits ?? []) {
    const { id, ...layerPatch } = edit;
    actions.push({ type: "setPosterLayerEdit", id, patch: layerPatch });
  }

  return actions;
}

/** Human-readable chips describing exactly what was applied (not what the model claimed). */
export function describePatch(patch: AiPatch): string[] {
  const changes: string[] = [];

  if (patch.direction) changes.push(`Direction: ${directionConfigs[patch.direction].label}`);
  if (patch.paletteId) changes.push(`Palette: ${getPalette(patch.paletteId)?.name ?? patch.paletteId}`);
  if (patch.fontPairId) changes.push(`Typography: ${getFontPair(patch.fontPairId).name}`);
  if (patch.background) changes.push(`Background: ${patch.background}`);
  if (patch.foreground) changes.push(`Text color: ${patch.foreground}`);
  if (patch.accent) changes.push(`Accent: ${patch.accent}`);
  if (patch.alignment) changes.push(`Alignment: ${patch.alignment}`);
  if (patch.spacing) changes.push(`Spacing: ${patch.spacing}`);
  if (patch.headline) changes.push(`Headline: ${patch.headline.replace(/\n/g, " / ")}`);
  if (patch.subtitle) changes.push("Subtitle updated");
  if (patch.mood) changes.push(`Mood: ${patch.mood}`);
  for (const edit of patch.layerEdits ?? []) {
    changes.push(`Canvas: ${edit.id} adjusted`);
  }

  return changes;
}

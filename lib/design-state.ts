import type {
  ChatCheckpoint,
  ChatMessage,
  DesignDirection,
  DesignState,
  PersistedStudioState,
  PosterSize,
  Spacing,
  TextAlignment,
} from "./design-types";
import {
  applyDirection,
  applyLook,
  colorPalettes,
  directionConfigs,
  directionOrder,
  fontPairs,
  getFontPair,
  getPalette,
  initialDesign,
  initialPaletteId,
  posterSizes,
  typographyFromPair,
} from "./design-presets";
import { NO_LOOK, getReferenceLook, lookPaletteId, referenceLookIds } from "./reference-looks";
import { sanitizePosterEdits, type PosterLayerEdit } from "./poster-editor";
import { buildPoster, getDefaultLayerOrder, normalizeLayerOrder, sanitizeLayerOrder } from "./poster-layout";

export type StudioState = PersistedStudioState;

export type CopyKey =
  | "projectName"
  | "venue"
  | "headline"
  | "subtitle"
  | "date"
  | "time"
  | "footer";

export type ColorKey = "background" | "foreground" | "accent";

export type StudioAction =
  | { type: "setDirection"; direction: DesignDirection }
  | { type: "setLook"; id: string }
  | { type: "setPosterSize"; value: PosterSize }
  | { type: "setFontPair"; id: string }
  | { type: "setPalette"; id: string }
  | { type: "setColor"; key: ColorKey; value: string }
  | { type: "setCopy"; key: CopyKey; value: string }
  | { type: "setAlignment"; value: TextAlignment }
  | { type: "setSpacing"; value: Spacing }
  | { type: "setMood"; value: string }
  | { type: "addMessages"; messages: ChatMessage[] }
  | { type: "setPosterLayerEdit"; id: string; patch: Partial<PosterLayerEdit> }
  | { type: "reorderLayer"; id: string; direction: "up" | "down" }
  | { type: "resetPosterEdits" }
  | { type: "restoreState"; state: StudioState }
  | { type: "resetDesign" }
  | { type: "resetProject" };

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_FIELD = 200;
const MAX_MESSAGES = 60;
const INITIAL_LAYER_ORDER = getDefaultLayerOrder(buildPoster(initialDesign));

export function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const seedMessages: ChatMessage[] = [
  {
    id: "seed-user",
    role: "user",
    content:
      "I need a poster for my coffee shop's jazz night. Something vintage but modern.",
  },
  {
    id: "seed-assistant",
    role: "assistant",
    source: "example",
    content:
      "Let's narrow that down. Are you imagining a warm, textured 1970s jazz-poster aesthetic, or something more minimal and contemporary?",
    suggestions: [...directionOrder],
    checkpoint: {
      design: initialDesign,
      selectedPaletteId: initialPaletteId,
      posterEdits: {},
      layerOrder: INITIAL_LAYER_ORDER,
    },
  },
];

export function createDefaultState(): StudioState {
  return {
    design: initialDesign,
    messages: seedMessages,
    selectedPaletteId: initialPaletteId,
    posterEdits: {},
    layerOrder: INITIAL_LAYER_ORDER,
  };
}

export function studioReducer(
  state: StudioState,
  action: StudioAction,
): StudioState {
  switch (action.type) {
    case "setDirection":
      return {
        ...state,
        design: applyDirection(state.design, action.direction),
        selectedPaletteId: directionConfigs[action.direction].paletteId,
      };
    case "setLook": {
      const look = getReferenceLook(action.id);
      if (!look && action.id !== NO_LOOK) return state;
      return {
        ...state,
        design: applyLook(state.design, action.id),
        selectedPaletteId: look ? lookPaletteId(look) : state.selectedPaletteId,
      };
    }
    case "setPosterSize":
      if (!posterSizes.some((size) => size.id === action.value)) return state;
      return {
        ...state,
        design: { ...state.design, posterSize: action.value },
      };
    case "setFontPair": {
      const pair = fontPairs.find((item) => item.id === action.id);
      if (!pair) return state;
      return {
        ...state,
        design: { ...state.design, typography: typographyFromPair(pair) },
      };
    }
    case "setPalette": {
      const palette = getPalette(action.id);
      if (!palette) return state;
      return {
        ...state,
        design: { ...state.design, colors: { ...palette.colors } },
        selectedPaletteId: palette.id,
      };
    }
    case "setColor": {
      if (!HEX_COLOR.test(action.value)) return state;
      return {
        ...state,
        design: {
          ...state.design,
          colors: { ...state.design.colors, [action.key]: action.value },
        },
        selectedPaletteId: null,
      };
    }
    case "setCopy": {
      const limit = action.key === "headline" ? 80 : MAX_FIELD;
      return {
        ...state,
        design: { ...state.design, [action.key]: action.value.slice(0, limit) },
      };
    }
    case "setAlignment":
      return {
        ...state,
        design: {
          ...state.design,
          layout: { ...state.design.layout, alignment: action.value },
        },
      };
    case "setSpacing":
      return {
        ...state,
        design: {
          ...state.design,
          layout: { ...state.design.layout, spacing: action.value },
        },
      };
    case "setMood":
      return {
        ...state,
        design: { ...state.design, mood: action.value.slice(0, 80) },
      };
    case "addMessages":
      return {
        ...state,
        messages: [...state.messages, ...action.messages].slice(-MAX_MESSAGES),
      };
    case "setPosterLayerEdit": {
      const current = state.posterEdits[action.id] ?? {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      };
      return {
        ...state,
        posterEdits: {
          ...state.posterEdits,
          [action.id]: {
            ...current,
            ...action.patch,
          },
        },
      };
    }
    case "reorderLayer": {
      const order = normalizeLayerOrder(buildPoster(state.design), state.layerOrder);
      const index = order.indexOf(action.id);
      const nextIndex = action.direction === "up" ? index - 1 : index + 1;
      if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return state;
      const nextOrder = [...order];
      [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
      return { ...state, layerOrder: nextOrder };
    }
    case "resetPosterEdits":
      return { ...state, posterEdits: {} };
    case "restoreState":
      return action.state;
    case "resetDesign":
      return {
        ...state,
        design: initialDesign,
        selectedPaletteId: initialPaletteId,
        layerOrder: INITIAL_LAYER_ORDER,
      };
    case "resetProject":
      return createDefaultState();
    default:
      return state;
  }
}

export type BriefRow = {
  id: "style" | "typography" | "background" | "accent" | "mood" | "layout";
  label: string;
  value: string;
};

const ALIGNMENT_LABEL: Record<TextAlignment, string> = {
  left: "Left aligned",
  center: "Centered",
  right: "Right aligned",
};

/** The brief is derived from the live design so it can never drift from the canvas. */
export function getBrief(
  design: DesignState,
  selectedPaletteId: string | null,
): BriefRow[] {
  const pair = getFontPair(design.typography.id);
  const palette = selectedPaletteId ? getPalette(selectedPaletteId) : undefined;

  return [
    {
      id: "style",
      label: "Style",
      value: getReferenceLook(design.lookId)
        ? `${design.styleLabel} · ${getReferenceLook(design.lookId)?.name}`
        : design.styleLabel,
    },
    {
      id: "typography",
      label: "Typography",
      value: `${pair.label} (${pair.heading} + ${pair.body})`,
    },
    {
      id: "background",
      label: "Background",
      value: palette
        ? `${palette.name} ${design.colors.background.toUpperCase()}`
        : `Custom ${design.colors.background.toUpperCase()}`,
    },
    { id: "accent", label: "Accent", value: design.colors.accent.toUpperCase() },
    { id: "mood", label: "Mood", value: design.mood || "Not set" },
    {
      id: "layout",
      label: "Layout",
      value: `${ALIGNMENT_LABEL[design.layout.alignment]}, ${design.layout.spacing} spacing`,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback: string, max = MAX_FIELD) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function hex(value: unknown, fallback: string) {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function sanitizeDesign(raw: unknown): DesignState {
  if (!isRecord(raw)) return initialDesign;

  const direction = oneOf(raw.direction, directionOrder, initialDesign.direction);
  const typography = isRecord(raw.typography) ? raw.typography : {};
  const colors = isRecord(raw.colors) ? raw.colors : {};
  const layout = isRecord(raw.layout) ? raw.layout : {};
  const pair = getFontPair(text(typography.id, initialDesign.typography.id, 60));

  return {
    projectName: text(raw.projectName, initialDesign.projectName),
    venue: text(raw.venue, initialDesign.venue),
    headline: text(raw.headline, initialDesign.headline, 80),
    subtitle: text(raw.subtitle, initialDesign.subtitle),
    date: text(raw.date, initialDesign.date),
    time: text(raw.time, initialDesign.time),
    footer: text(raw.footer, initialDesign.footer),
    direction,
    // Stored designs from before looks existed keep their flat colours.
    lookId: oneOf(raw.lookId, [...referenceLookIds, NO_LOOK], NO_LOOK),
    posterSize: oneOf(raw.posterSize, posterSizes.map((size) => size.id), initialDesign.posterSize),
    styleLabel: text(raw.styleLabel, directionConfigs[direction].label, 60),
    mood: text(raw.mood, directionConfigs[direction].mood, 80),
    typography: typographyFromPair(pair),
    colors: {
      background: hex(colors.background, initialDesign.colors.background),
      foreground: hex(colors.foreground, initialDesign.colors.foreground),
      accent: hex(colors.accent, initialDesign.colors.accent),
      muted: hex(colors.muted, initialDesign.colors.muted),
    },
    layout: {
      alignment: oneOf(layout.alignment, ["left", "center", "right"] as const, "left"),
      spacing: oneOf(layout.spacing, ["compact", "normal", "spacious"] as const, "normal"),
    },
  };
}

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return seedMessages;

  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (item.role !== "user" && item.role !== "assistant") continue;
    if (typeof item.content !== "string" || typeof item.id !== "string") continue;

    messages.push({
      id: item.id.slice(0, 60),
      role: item.role,
      content: item.content.slice(0, 1000),
      source:
        item.source === "example" || item.source === "demo" || item.source === "gemini"
          ? item.source
          : undefined,
      notice: typeof item.notice === "string" ? item.notice.slice(0, 160) : undefined,
      skipped: Array.isArray(item.skipped)
        ? item.skipped
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.slice(0, 24))
            .slice(0, 10)
        : undefined,
      suggestions: Array.isArray(item.suggestions)
        ? item.suggestions.filter((entry): entry is DesignDirection =>
            directionOrder.includes(entry as DesignDirection),
          )
        : undefined,
      changes: Array.isArray(item.changes)
        ? item.changes
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.slice(0, 120))
            .slice(0, 8)
        : undefined,
      assetSuggestions: Array.isArray(item.assetSuggestions)
        ? item.assetSuggestions
            .filter(
              (entry): entry is { id: string; kind: string; name: string; description: string | null } =>
                isRecord(entry) &&
                typeof entry.id === "string" &&
                typeof entry.kind === "string" &&
                typeof entry.name === "string" &&
                (entry.description === null || typeof entry.description === "string"),
            )
            .map((entry) => ({
              id: entry.id.slice(0, 120),
              kind: entry.kind.slice(0, 40),
              name: entry.name.slice(0, 160),
              description: entry.description ? entry.description.slice(0, 240) : null,
            }))
            .slice(0, 5)
        : undefined,
      checkpoint: sanitizeCheckpoint(item.checkpoint),
    });
  }

  return messages.length > 0 ? messages.slice(-MAX_MESSAGES) : seedMessages;
}

function sanitizeCheckpoint(raw: unknown): ChatCheckpoint | undefined {
  if (!isRecord(raw)) return undefined;

  const paletteId =
    typeof raw.selectedPaletteId === "string" &&
    colorPalettes.some((palette) => palette.id === raw.selectedPaletteId)
      ? raw.selectedPaletteId
      : null;

  const design = sanitizeDesign(raw.design);
  return {
    design,
    selectedPaletteId: paletteId,
    posterEdits: sanitizePosterEdits(raw.posterEdits),
    layerOrder: sanitizeLayerOrder(buildPoster(design), raw.layerOrder),
  };
}

/** Validates untrusted persisted data; returns null when nothing usable is found. */
export function sanitizeState(raw: unknown): StudioState | null {
  if (!isRecord(raw) || !isRecord(raw.design)) return null;

  const design = sanitizeDesign(raw.design);
  const paletteId =
    typeof raw.selectedPaletteId === "string" &&
    colorPalettes.some((palette) => palette.id === raw.selectedPaletteId)
      ? raw.selectedPaletteId
      : null;

  return {
    design,
    messages: sanitizeMessages(raw.messages),
    selectedPaletteId: paletteId,
    posterEdits: sanitizePosterEdits(raw.posterEdits),
    layerOrder: sanitizeLayerOrder(buildPoster(design), raw.layerOrder),
  };
}

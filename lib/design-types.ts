import type { PosterEdits } from "./poster-editor";

export type DesignDirection = "vintage" | "minimal" | "experimental";
export type PosterSize = "social" | "letter" | "a4";
export type TextAlignment = "left" | "center" | "right";
export type Spacing = "compact" | "normal" | "spacious";
export type LayoutVariant =
  | "asymmetric-grid"
  | "centred-stack"
  | "diagonal-break"
  | "edge-anchored"
  | "full-bleed-image"
  | "modular-grid"
  | "typographic-stack";
export type ReferenceFilter = "none" | "grayscale" | "high-contrast" | "duotone" | "invert";
export type ReferenceBlendMode = "normal" | "multiply" | "screen" | "overlay";

export type ReferenceTreatment = {
  assetId: string | null;
  textureAssetId: string | null;
  filter: ReferenceFilter;
  blendMode: ReferenceBlendMode;
  opacity: number;
  textureOpacity: number;
};

export type DesignState = {
  projectName: string;
  venue: string;
  headline: string;
  subtitle: string;
  date: string;
  time: string;
  footer: string;
  direction: DesignDirection;
  /** Reference look id from lib/reference-looks.ts, or "none" for flat colour. */
  lookId: string;
  /** Texture assets of the current look that the user switched off. */
  hiddenTextures?: string[];
  posterSize: PosterSize;
  styleLabel: string;
  mood: string;
  typography: {
    id: string;
    label: string;
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
  };
  colors: {
    background: string;
    foreground: string;
    accent: string;
    muted: string;
  };
  layout: {
    alignment: TextAlignment;
    spacing: Spacing;
    variant: LayoutVariant;
  };
};

export type ChatCheckpoint = {
  design: DesignState;
  selectedPaletteId: string | null;
  posterEdits: PosterEdits;
  layerOrder: string[];
  referenceTreatment: ReferenceTreatment;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * "example" is the seeded sample conversation, "demo" is the local rule engine,
   * "gemini" is a validated response from the Gemini API.
   */
  source?: "example" | "demo" | "gemini";
  suggestions?: DesignDirection[];
  /** Model-generated next moves for the current conversation, not canned UI copy. */
  followUps?: string[];
  changes?: string[];
  /** Properties the model proposed but that failed validation and were not applied. */
  skipped?: string[];
  /** Plain-language note, e.g. that Gemini was unavailable and local rules were used. */
  notice?: string;
  assetSuggestions?: AssetSuggestion[];
  /** Sources returned by Gemini's optional Google Search grounding pass. */
  groundingSources?: Array<{ title: string; url: string }>;
  /** The complete editable state immediately after this assistant response. */
  checkpoint?: ChatCheckpoint;
};

export type AssetSuggestion = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
};

export type PersistedStudioState = {
  design: DesignState;
  messages: ChatMessage[];
  /** null when the colors no longer match a curated palette. */
  selectedPaletteId: string | null;
  posterEdits: PosterEdits;
  layerOrder: string[];
  referenceTreatment: ReferenceTreatment;
};

import type {
  DesignDirection,
  DesignState,
  Spacing,
  TextAlignment,
} from "./design-types";

export type FontPair = {
  id: string;
  name: string;
  heading: string;
  body: string;
  label: string;
  headingFont: string;
  bodyFont: string;
  headingWeight: number;
  /** Approximate uppercase glyph width as a fraction of font size, used to fit headlines. */
  widthRatio: number;
};

export type ColorPalette = {
  id: string;
  name: string;
  note: string;
  colors: DesignState["colors"];
};

export type ReferenceCard = {
  id: string;
  title: string;
  category: string;
  source: string;
};

export const fontPairs: FontPair[] = [
  {
    id: "playfair-inter",
    name: "Playfair Display + Inter",
    heading: "Playfair Display",
    body: "Inter",
    label: "Expressive serif",
    headingFont: 'var(--font-playfair), "Playfair Display", Georgia, serif',
    bodyFont: 'var(--font-inter), Inter, Arial, sans-serif',
    headingWeight: 700,
    widthRatio: 0.74,
  },
  {
    id: "dm-serif-dm-sans",
    name: "DM Serif Display + DM Sans",
    heading: "DM Serif Display",
    body: "DM Sans",
    label: "Warm display serif",
    headingFont: 'var(--font-dm-serif), "DM Serif Display", Georgia, serif',
    bodyFont: 'var(--font-dm-sans), "DM Sans", Arial, sans-serif',
    headingWeight: 400,
    widthRatio: 0.68,
  },
  {
    id: "space-inter",
    name: "Space Grotesk + Inter",
    heading: "Space Grotesk",
    body: "Inter",
    label: "Geometric grotesk",
    headingFont: 'var(--font-space), "Space Grotesk", Arial, sans-serif',
    bodyFont: 'var(--font-inter), Inter, Arial, sans-serif',
    headingWeight: 700,
    widthRatio: 0.72,
  },
  {
    id: "cormorant-manrope",
    name: "Cormorant Garamond + Manrope",
    heading: "Cormorant Garamond",
    body: "Manrope",
    label: "Refined garamond",
    headingFont: 'var(--font-cormorant), "Cormorant Garamond", Georgia, serif',
    bodyFont: 'var(--font-manrope), Manrope, Arial, sans-serif',
    headingWeight: 700,
    widthRatio: 0.62,
  },
];

export const colorPalettes: ColorPalette[] = [
  {
    id: "roastery",
    name: "Roastery",
    note: "Warm cream and burnt orange",
    colors: {
      background: "#F3EBDD",
      foreground: "#2B2723",
      accent: "#D8784C",
      muted: "#A99C8C",
    },
  },
  {
    id: "paper-ink",
    name: "Paper & Ink",
    note: "Clear, quiet, precise",
    colors: {
      background: "#F7F7F4",
      foreground: "#171717",
      accent: "#171717",
      muted: "#9A9A93",
    },
  },
  {
    id: "night-signal",
    name: "Night Signal",
    note: "High contrast after dark",
    colors: {
      background: "#151719",
      foreground: "#F2EEE6",
      accent: "#C9F05D",
      muted: "#8C918B",
    },
  },
  {
    id: "clay-studio",
    name: "Clay Studio",
    note: "Earthy with a sharp edge",
    colors: {
      background: "#E7D5C5",
      foreground: "#332923",
      accent: "#A34D3B",
      muted: "#A88F80",
    },
  },
];

/**
 * These are original abstract placeholders rendered by Curio Labs. They are not
 * photographs or work by any named designer, so there is no external source.
 */
export const referenceCards: ReferenceCard[] = [
  {
    id: "late-set",
    title: "Late set",
    category: "Warm, textured, circular",
    source: "Demo placeholder, no external source",
  },
  {
    id: "paper-studies",
    title: "Paper studies",
    category: "Swiss grid, quiet hierarchy",
    source: "Demo placeholder, no external source",
  },
  {
    id: "signal-noise",
    title: "Signal / noise",
    category: "Oversized, high contrast",
    source: "Demo placeholder, no external source",
  },
];

type DirectionConfig = {
  label: string;
  mood: string;
  fontPairId: string;
  paletteId: string;
  alignment: TextAlignment;
  spacing: Spacing;
};

export const directionConfigs: Record<DesignDirection, DirectionConfig> = {
  vintage: {
    label: "Vintage Jazz",
    mood: "Cozy and artistic",
    fontPairId: "playfair-inter",
    paletteId: "roastery",
    alignment: "left",
    spacing: "normal",
  },
  minimal: {
    label: "Modern Minimal",
    mood: "Clear and considered",
    fontPairId: "space-inter",
    paletteId: "paper-ink",
    alignment: "left",
    spacing: "spacious",
  },
  experimental: {
    label: "Experimental Editorial",
    mood: "Restless and electric",
    fontPairId: "space-inter",
    paletteId: "night-signal",
    alignment: "right",
    spacing: "compact",
  },
};

export const directionOrder: DesignDirection[] = [
  "vintage",
  "minimal",
  "experimental",
];

export function getFontPair(id: string): FontPair {
  return fontPairs.find((pair) => pair.id === id) ?? fontPairs[0];
}

export function getPalette(id: string): ColorPalette | undefined {
  return colorPalettes.find((palette) => palette.id === id);
}

export function typographyFromPair(pair: FontPair): DesignState["typography"] {
  return {
    id: pair.id,
    label: pair.label,
    headingFont: pair.headingFont,
    bodyFont: pair.bodyFont,
    headingWeight: pair.headingWeight,
  };
}

/** Switches the visual direction while keeping every piece of poster copy. */
export function applyDirection(
  design: DesignState,
  direction: DesignDirection,
): DesignState {
  const config = directionConfigs[direction];
  const palette = getPalette(config.paletteId) ?? colorPalettes[0];

  return {
    ...design,
    direction,
    styleLabel: config.label,
    mood: config.mood,
    typography: typographyFromPair(getFontPair(config.fontPairId)),
    colors: { ...palette.colors },
    layout: { alignment: config.alignment, spacing: config.spacing },
  };
}

const baseDesign: DesignState = {
  projectName: "Midnight Jazz",
  venue: "THE ROASTERY",
  headline: "MIDNIGHT\nJAZZ",
  subtitle: "An Evening of Live Music",
  date: "FRIDAY · OCTOBER 23",
  time: "7:00 PM — 11:00 PM",
  footer: "COFFEE · MUSIC · CULTURE",
  direction: "vintage",
  styleLabel: "",
  mood: "",
  typography: typographyFromPair(fontPairs[0]),
  colors: { ...colorPalettes[0].colors },
  layout: { alignment: "left", spacing: "normal" },
};

export const initialDesign: DesignState = applyDirection(baseDesign, "vintage");
export const initialPaletteId = directionConfigs.vintage.paletteId;

import type {
  DesignDirection,
  DesignState,
  LayoutVariant,
  PosterSize,
  Spacing,
  TextAlignment,
} from "./design-types";

export type PosterSizeConfig = {
  id: PosterSize;
  label: string;
  dimensions: string;
  width: number;
  height: number;
};

export const posterSizes: PosterSizeConfig[] = [
  { id: "social", label: "Social", dimensions: "1080 × 1350", width: 1080, height: 1350 },
  { id: "letter", label: "Letter", dimensions: "2550 × 3300", width: 2550, height: 3300 },
  { id: "a4", label: "A4", dimensions: "2480 × 3508", width: 2480, height: 3508 },
];

export function getPosterSize(id: PosterSize) {
  return posterSizes.find((size) => size.id === id) ?? posterSizes[0];
}

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
  sourceUrl: string;
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

function pinterestSearch(query: string) {
  return `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
}

/**
 * Curated Pinterest searches are references, not assets. Curio renders its own
 * abstract thumbnails and links out so the original work stays on Pinterest.
 */
export const referenceCards: ReferenceCard[] = [
  {
    id: "late-set",
    title: "Late set / warm circles",
    category: "Music poster · warm geometry",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("warm jazz concert poster circles typography"),
  },
  {
    id: "paper-studies",
    title: "Paper studies / Swiss grid",
    category: "Swiss poster · quiet hierarchy",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("Swiss grid poster design typography"),
  },
  {
    id: "signal-noise",
    title: "Signal / noise",
    category: "Experimental poster · high contrast",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("experimental graphic poster high contrast typography"),
  },
  {
    id: "primary-beats",
    title: "Primary beats",
    category: "Music poster · primary color blocks",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("primary colors music poster graphic design"),
  },
  {
    id: "red-black-type",
    title: "Red / black type",
    category: "Editorial poster · compressed type",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("red black typography poster editorial design"),
  },
  {
    id: "blue-note",
    title: "Blue note",
    category: "Jazz poster · cool monochrome",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("blue jazz poster graphic design"),
  },
  {
    id: "grid-tension",
    title: "Grid tension",
    category: "Swiss poster · asymmetrical grid",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("asymmetrical Swiss typography poster"),
  },
  {
    id: "oversized-italic",
    title: "Oversized italic",
    category: "Type poster · kinetic headline",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("oversized italic typography poster design"),
  },
  {
    id: "midnight-flare",
    title: "Midnight flare",
    category: "Event poster · dark field and glow",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("dark night event poster neon accent"),
  },
  {
    id: "new-wave-cut",
    title: "New wave cut",
    category: "Music poster · collage crop",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("new wave music poster collage typography"),
  },
  {
    id: "museum-index",
    title: "Museum index",
    category: "Cultural poster · information hierarchy",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("museum exhibition poster typography grid"),
  },
  {
    id: "acid-letterforms",
    title: "Acid letterforms",
    category: "Experimental poster · warped type",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("acid typography poster experimental graphic design"),
  },
  {
    id: "cream-and-coral",
    title: "Cream and coral",
    category: "Brand poster · soft contrast",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("cream coral modern poster design"),
  },
  {
    id: "mono-assembly",
    title: "Mono assembly",
    category: "Editorial poster · black and white",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("black white editorial typography poster"),
  },
  {
    id: "circle-and-bar",
    title: "Circle and bar",
    category: "Swiss poster · modular geometry",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("Swiss poster circle bar geometric design"),
  },
  {
    id: "riso-register",
    title: "Riso register",
    category: "Print poster · offset color",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("riso print poster registration graphic design"),
  },
  {
    id: "type-as-image",
    title: "Type as image",
    category: "Typography poster · letterform texture",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("typography as image poster design"),
  },
  {
    id: "orange-after-dark",
    title: "Orange after dark",
    category: "Music poster · orange and ink",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("orange black concert poster typography"),
  },
  {
    id: "soft-utility",
    title: "Soft utility",
    category: "Identity poster · functional layout",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("minimal identity poster functional typography"),
  },
  {
    id: "green-room",
    title: "Green room",
    category: "Event poster · acid green signal",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("acid green event poster graphic design"),
  },
  {
    id: "found-type",
    title: "Found type",
    category: "Collage poster · found textures",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("found typography collage poster design"),
  },
  {
    id: "black-sun",
    title: "Black sun",
    category: "Cultural poster · solar motif",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("black sun exhibition poster graphic design"),
  },
  {
    id: "quiet-red",
    title: "Quiet red",
    category: "Editorial poster · one-color accent",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("minimal red accent editorial poster"),
  },
  {
    id: "jazz-archive",
    title: "Jazz archive",
    category: "Jazz poster · historical type",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("jazz archive poster typography design"),
  },
  {
    id: "blueprint-type",
    title: "Blueprint type",
    category: "Poster system · blue technical grid",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("blue technical typography poster grid"),
  },
  {
    id: "paper-cut",
    title: "Paper cut",
    category: "Experimental poster · layered paper",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("paper cut layered poster graphic design"),
  },
  {
    id: "festival-list",
    title: "Festival list",
    category: "Event poster · dense information",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("music festival poster dense typography layout"),
  },
  {
    id: "violet-frequency",
    title: "Violet frequency",
    category: "Music poster · electric gradient",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("purple electronic music poster typography"),
  },
  {
    id: "editorial-slice",
    title: "Editorial slice",
    category: "Magazine poster · image crop",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("editorial magazine poster image crop typography"),
  },
  {
    id: "form-forum",
    title: "Form forum",
    category: "Swiss poster · circle and type",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("Swiss Form Forum poster design"),
  },
  {
    id: "one-line-poster",
    title: "One-line poster",
    category: "Minimal poster · single gesture",
    source: "Pinterest search",
    sourceUrl: pinterestSearch("minimal one line poster graphic design"),
  },
];

type DirectionConfig = {
  label: string;
  mood: string;
  fontPairId: string;
  paletteId: string;
  alignment: TextAlignment;
  spacing: Spacing;
  layoutVariant: LayoutVariant;
};

export const directionConfigs: Record<DesignDirection, DirectionConfig> = {
  vintage: {
    label: "Warm Editorial",
    mood: "Tactile and considered",
    fontPairId: "playfair-inter",
    paletteId: "roastery",
    alignment: "left",
    spacing: "normal",
    layoutVariant: "centred-stack",
  },
  minimal: {
    label: "Modern Minimal",
    mood: "Clear and considered",
    fontPairId: "space-inter",
    paletteId: "paper-ink",
    alignment: "left",
    spacing: "spacious",
    layoutVariant: "asymmetric-grid",
  },
  experimental: {
    label: "Experimental Editorial",
    mood: "Restless and electric",
    fontPairId: "space-inter",
    paletteId: "night-signal",
    alignment: "right",
    spacing: "compact",
    layoutVariant: "diagonal-break",
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
    layout: { alignment: config.alignment, spacing: config.spacing, variant: config.layoutVariant },
  };
}

const baseDesign: DesignState = {
  projectName: "Cedar & Salt",
  venue: "CEDAR & SALT",
  headline: "CEDAR\n&SALT",
  subtitle: "Seasonal food, late dinners",
  date: "SATURDAY · OCTOBER 18",
  time: "6:00 PM — LATE",
  footer: "FOOD · WINE · COMMUNITY",
  direction: "minimal",
  posterSize: "social",
  styleLabel: "",
  mood: "",
  typography: typographyFromPair(fontPairs[0]),
  colors: { ...colorPalettes[0].colors },
  layout: { alignment: "left", spacing: "normal", variant: "asymmetric-grid" },
};

export const initialDesign: DesignState = applyDirection(baseDesign, "minimal");
export const initialPaletteId = directionConfigs.minimal.paletteId;

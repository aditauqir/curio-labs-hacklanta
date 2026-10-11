import type {
  DesignDirection,
  DesignState,
  PosterSize,
  Spacing,
  TextAlignment,
} from "./design-types";
import { NO_LOOK, getReferenceLook, lookAssetReferences, lookPaletteId, referenceLooks } from "./reference-looks";

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
  /** Native-scale crop of the image asset. */
  thumbnail: string;
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

/** Every palette comes from an analysed reference look in curio/assets. */
export const colorPalettes: ColorPalette[] = referenceLooks.map((look) => ({
  id: lookPaletteId(look),
  name: look.name,
  note: `Reference look · ${look.styleTags.slice(0, 2).join(", ")}`,
  colors: { ...look.palette },
}));

/**
 * References are the image assets in curio/assets that the analysed looks are built from:
 * halftone screens, paper, grain, overlays, patterns and vectors (CC0, baked to public/looks).
 */
export const referenceCards: ReferenceCard[] = lookAssetReferences.map((asset) => ({
  id: asset.id,
  title: asset.label,
  category: `${asset.kind} · ${asset.usedBy.join(", ")}`,
  source: "curio/assets (CC0)",
  sourceUrl: asset.url,
  thumbnail: asset.thumbnail,
}));

type DirectionConfig = {
  label: string;
  mood: string;
  /** The analysed reference look this direction is rendered with. */
  lookId: string;
  fontPairId: string;
  paletteId: string;
  alignment: TextAlignment;
  spacing: Spacing;
};

export const directionConfigs: Record<DesignDirection, DirectionConfig> = {
  vintage: {
    label: "Newsprint broadsheet",
    mood: "Cinematic and editorial",
    lookId: "newsprint",
    fontPairId: "playfair-inter",
    paletteId: "look-newsprint",
    alignment: "left",
    spacing: "normal",
  },
  minimal: {
    label: "Berlin Swiss ivory",
    mood: "Precise and minimal",
    lookId: "swiss-ivory",
    fontPairId: "space-inter",
    paletteId: "look-swiss-ivory",
    alignment: "left",
    spacing: "spacious",
  },
  experimental: {
    label: "Acid green duotone",
    mood: "Loud and electric",
    lookId: "acid-duotone",
    fontPairId: "space-inter",
    paletteId: "look-acid-duotone",
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
    lookId: config.lookId,
    styleLabel: config.label,
    mood: config.mood,
    typography: typographyFromPair(getFontPair(config.fontPairId)),
    colors: { ...palette.colors },
    layout: { alignment: config.alignment, spacing: config.spacing },
  };
}

/**
 * Applies an analysed reference look: its screen and textures, its palette, and its font pair.
 * Copy, layout and direction stay as they are. "none" keeps colours and fonts and drops the finish.
 */
export function applyLook(design: DesignState, lookId: string): DesignState {
  if (lookId === NO_LOOK) return { ...design, lookId: NO_LOOK };
  const look = getReferenceLook(lookId);
  if (!look) return design;
  return {
    ...design,
    lookId: look.id,
    typography: typographyFromPair(getFontPair(look.fontPairId)),
    colors: { ...look.palette },
  };
}

const baseDesign: DesignState = {
  projectName: "Half Tone",
  venue: "GALLERY NINE",
  headline: "HALF\nTONE",
  subtitle: "Print and Photography, 1968–1999",
  date: "OPENING · NOVEMBER 14",
  time: "6:00 PM — 9:00 PM",
  footer: "PRINT · PHOTOGRAPHY · PAPER",
  direction: "vintage",
  lookId: NO_LOOK,
  posterSize: "social",
  styleLabel: "",
  mood: "",
  typography: typographyFromPair(fontPairs[0]),
  colors: { ...colorPalettes[0].colors },
  layout: { alignment: "left", spacing: "normal" },
};

export const initialDesign: DesignState = applyDirection(baseDesign, "vintage");
export const initialPaletteId = directionConfigs.vintage.paletteId;

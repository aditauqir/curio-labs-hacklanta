import type { DesignState } from "./design-types";

/**
 * Reference looks: the analysed poster styles from the raster engine, ported to the web poster.
 *
 * Source of truth is `curio/assets/style_links.json` (which screen and textures each analysed
 * reference uses, with blend and opacity) plus the recipe numbers in
 * `curio/assets/tools/apply_demo.py` (gradient-map stops for the six demo renders). The
 * `analysisId` is the opaque id from style_links.json; source poster names are not kept.
 *
 * `colorSource: "recipe"` means the palette comes from the engine's demo recipe. "inferred"
 * means the analysis only gave style tags (for example "monochrome-warm-grey") and the hex
 * values were chosen to match them.
 *
 * Texture files are baked to the 1080 x 1350 reference canvas in public/looks/ by
 * scripts/build-look-assets.py. Everything is original procedural output, CC0-1.0.
 */

export type LookBlend = "multiply" | "overlay" | "screen" | "soft-light";
/** A gradient-map stop colour: a role resolved from the live design, or a fixed hex. */
export type LookColor = "background" | "foreground" | "accent" | `#${string}`;

export type LookTexture = {
  asset: string;
  blend: LookBlend;
  opacity: number;
  label: string;
};

export type ReferenceLook = {
  id: string;
  analysisId: string;
  name: string;
  summary: string;
  styleTags: string[];
  colorSource: "recipe" | "inferred";
  palette: DesignState["colors"];
  fontPairId: string;
  /** Halftone threshold map. null renders a continuous-tone gradient map instead. */
  screen: { asset: string; label: string; softness: number } | null;
  /**
   * The tonal plate behind the type: a flat field plus one shaded orb (the web stand-in for
   * the engine's photo subject), screened through `screen` and gradient-mapped through `stops`.
   * Luminance values are 0..1; 1 maps to the last stop.
   */
  plate: {
    field: number;
    orbLight: number;
    orbDark: number;
    stops: { at: number; color: LookColor }[];
  };
  textures: LookTexture[];
};

export const NO_LOOK = "none";

export const referenceLooks: ReferenceLook[] = [
  {
    id: "aged-broadsheet",
    analysisId: "r_6fc9707c711a",
    name: "Aged broadsheet",
    summary: "Event broadsheet on aged uncoated stock: dot-grain screen, didone subhead, warm monochrome ink.",
    styleTags: ["event-broadsheet", "framed-inset-photo", "condensed-headline", "didone-subhead", "botanical-monochrome", "uncoated-stock"],
    colorSource: "inferred",
    palette: { background: "#E4D8C2", foreground: "#1E1A16", accent: "#B4532F", muted: "#9C8F7E" },
    fontPairId: "playfair-inter",
    screen: { asset: "ht_dotgrain_p9p8_a0", label: "dot-grain screen, 9.8 px", softness: 1.5 },
    plate: { field: 0.9, orbLight: 0.78, orbDark: 0.22, stops: [{ at: 0, color: "foreground" }, { at: 1, color: "background" }] },
    textures: [
      { asset: "paper_aged_r5", blend: "multiply", opacity: 0.18, label: "aged paper" },
      { asset: "grain_silver_gelatin_std14", blend: "overlay", opacity: 0.24, label: "silver-gelatin grain" },
    ],
  },
  {
    id: "swiss-ivory",
    analysisId: "r_88044f1de9a1",
    name: "Berlin Swiss ivory",
    summary: "Swiss grid techno poster on ivory stock: elliptical screen at 29°, concentric target motif, staggered columns.",
    styleTags: ["berlin-techno", "swiss-grid", "tresor-minimalism", "concentric-target-motif", "staggered-columns", "uncoated-ivory-stock", "documentary-photo-inset"],
    colorSource: "inferred",
    palette: { background: "#ECE7DA", foreground: "#121212", accent: "#D9381E", muted: "#9A968C" },
    fontPairId: "space-inter",
    screen: { asset: "ht_ellipse_p14p4_a29", label: "elliptical screen, 14.4 px at 29°", softness: 2 },
    plate: { field: 0.94, orbLight: 0.8, orbDark: 0.18, stops: [{ at: 0, color: "foreground" }, { at: 1, color: "background" }] },
    textures: [
      { asset: "paper_ivory_r4", blend: "multiply", opacity: 0.14, label: "ivory stock" },
      { asset: "grain_film_mono_std10", blend: "overlay", opacity: 0.2, label: "mono film grain" },
    ],
  },
  {
    id: "acid-duotone",
    analysisId: "r_f0d754794097",
    name: "Acid green duotone",
    summary: "Acid-pop duotone: round-dot screen at 7.8 px and 51°, near-black ink on acid green, grotesque microtype.",
    styleTags: ["brat-green", "duotone", "acid-pop", "halftone-screen", "grotesque-microtype", "minimalist-contrast"],
    colorSource: "recipe",
    palette: { background: "#90E908", foreground: "#020602", accent: "#020602", muted: "#4F7A0A" },
    fontPairId: "space-inter",
    screen: { asset: "ht_am_round_p7p8_a51", label: "round-dot screen, 7.8 px at 51°", softness: 1.5 },
    plate: { field: 0.72, orbLight: 0.95, orbDark: 0.12, stops: [{ at: 0, color: "foreground" }, { at: 1, color: "background" }] },
    textures: [{ asset: "grain_film_mono_std8", blend: "overlay", opacity: 0.18, label: "mono film grain" }],
  },
  {
    id: "newsprint",
    analysisId: "r_25b9918b0585",
    name: "Newsprint broadsheet",
    summary: "Cinematic broadsheet: horizontal line screen at 13.8 px, uncoated newsprint, didone serif over condensed grotesque.",
    styleTags: ["newsprint-editorial", "framed-inset-photo", "condensed-grotesque", "didone-modern-serif", "monochrome-warm-grey", "cinematic-broadsheet"],
    colorSource: "recipe",
    palette: { background: "#E0DED6", foreground: "#080806", accent: "#5E5A52", muted: "#8E8A80" },
    fontPairId: "playfair-inter",
    screen: { asset: "ht_line_p13p8_h", label: "line screen, 13.8 px", softness: 2.5 },
    plate: { field: 0.84, orbLight: 0.92, orbDark: 0.1, stops: [{ at: 0, color: "foreground" }, { at: 1, color: "background" }] },
    textures: [
      { asset: "paper_uncoated_r4", blend: "multiply", opacity: 0.15, label: "uncoated paper" },
      { asset: "grain_silver_gelatin_std12", blend: "overlay", opacity: 0.22, label: "silver-gelatin grain" },
    ],
  },
  {
    id: "crimson-photocopy",
    analysisId: "r_ffb5961db7fd",
    name: "Crimson photocopy",
    summary: "Underground club flyer: square-dot screen at 15.3 px, crimson and black duotone, photocopy creases and toner grit.",
    styleTags: ["underground-rave", "club-flyer", "duotone-crimson-black", "modular-compartments", "condensed-woodtype", "checkerboard-divider", "photocopy-distress"],
    colorSource: "recipe",
    palette: { background: "#F81144", foreground: "#101010", accent: "#101010", muted: "#7A0A22" },
    fontPairId: "space-inter",
    screen: { asset: "ht_square_p15p3_a0", label: "square-dot screen, 15.3 px", softness: 2 },
    // The demo render's field is darker; it is lifted here so small type stays legible.
    plate: { field: 0.88, orbLight: 0.95, orbDark: 0.1, stops: [{ at: 0, color: "foreground" }, { at: 1, color: "background" }] },
    textures: [
      { asset: "overlay_photocopy_creases_2", blend: "screen", opacity: 0.35, label: "photocopy creases" },
      { asset: "overlay_photocopy_edge_blotch", blend: "multiply", opacity: 0.8, label: "toner edge blotch" },
      { asset: "grain_toner_grit_std8", blend: "overlay", opacity: 0.2, label: "toner grit" },
    ],
  },
  {
    id: "amber-crt",
    analysisId: "r_f931bc33920a",
    name: "Amber CRT",
    summary: "Y2K technical techno poster: amber-crimson tritone, CRT scanlines, HUD coordinate grid, industrial hazard energy.",
    styleTags: ["berlin-techno", "cyberpunk-hud", "industrial-hazard", "modular-infographic", "amber-crimson-tritone", "scanline-duotone", "y2k-technical"],
    colorSource: "recipe",
    palette: { background: "#191818", foreground: "#F19614", accent: "#C45B13", muted: "#6B3A1E" },
    fontPairId: "space-inter",
    screen: null,
    plate: {
      field: 0.08,
      orbLight: 0.98,
      orbDark: 0.2,
      stops: [
        { at: 0, color: "background" },
        { at: 0.35, color: "#A42D15" },
        { at: 0.7, color: "accent" },
        { at: 1, color: "foreground" },
      ],
    },
    textures: [
      { asset: "pattern_scanlines_crt_p4", blend: "multiply", opacity: 1, label: "CRT scanlines" },
      { asset: "vec_wireframe_coordinate_grid", blend: "screen", opacity: 0.35, label: "HUD coordinate grid" },
      { asset: "grain_film_mono_std8", blend: "overlay", opacity: 0.18, label: "mono film grain" },
    ],
  },
  {
    id: "cosmic-cobalt",
    analysisId: "r_5185ccc24350",
    name: "Cosmic cobalt",
    summary: "Early-90s cosmic trance flyer: cobalt-to-coral duotone, airbrushed diffusion, drifting cloud smoke.",
    styleTags: ["early-90s-rave", "cosmic-trance", "ethereal-diffusion", "cobalt-coral-duotone", "ascension-surrealism", "acid-house"],
    colorSource: "recipe",
    palette: { background: "#134FA4", foreground: "#EBEEF2", accent: "#A5586D", muted: "#17364E" },
    fontPairId: "dm-serif-dm-sans",
    screen: null,
    plate: {
      field: 0.42,
      orbLight: 1,
      orbDark: 0.3,
      stops: [
        { at: 0, color: "#17364E" },
        { at: 0.4, color: "background" },
        { at: 0.75, color: "accent" },
        { at: 1, color: "foreground" },
      ],
    },
    textures: [
      { asset: "overlay_cloud_smoke_s41", blend: "soft-light", opacity: 0.45, label: "cloud smoke" },
      { asset: "grain_airbrush_halation_std10", blend: "overlay", opacity: 0.22, label: "airbrush halation grain" },
    ],
  },
  {
    id: "thermal-rings",
    analysisId: "r_27652c722388",
    name: "Thermal rings",
    summary: "Ambient club visual: thermal solarized teal and red, interference-ring moiré, chromatic noise, wireframe grid.",
    styleTags: ["psychedelic-techno", "thermal-solarization", "chromatic-noise", "wireframe-sacred-geometry", "iridescent-aura", "ambient-club-visual"],
    colorSource: "recipe",
    palette: { background: "#0E7F96", foreground: "#F2F0E6", accent: "#BD2532", muted: "#2C383C" },
    fontPairId: "space-inter",
    screen: null,
    plate: {
      field: 0.6,
      orbLight: 0.98,
      orbDark: 0.15,
      stops: [
        { at: 0, color: "#101817" },
        { at: 0.35, color: "#2C383C" },
        { at: 0.6, color: "background" },
        { at: 0.85, color: "accent" },
        { at: 1, color: "#9D9D8E" },
      ],
    },
    textures: [
      { asset: "pattern_interference_rings_p5", blend: "overlay", opacity: 0.3, label: "interference-ring moiré" },
      { asset: "vec_wireframe_coordinate_grid", blend: "screen", opacity: 0.4, label: "wireframe coordinate grid" },
      { asset: "grain_chroma_std14p7", blend: "overlay", opacity: 0.3, label: "chromatic noise" },
    ],
  },
];

export const referenceLookIds = referenceLooks.map((look) => look.id);

export function getReferenceLook(id: string | null | undefined): ReferenceLook | undefined {
  return referenceLooks.find((look) => look.id === id);
}

/** Palette id used when a look's colours are applied as a curated palette. */
export function lookPaletteId(look: ReferenceLook) {
  return `look-${look.id}`;
}

/** Public URL of a baked look asset. Halftone maps are lossless PNG, textures are WebP. */
export function lookAssetUrl(assetId: string) {
  return `/looks/${assetId}${assetId.startsWith("ht_") ? ".png" : ".webp"}`;
}

const ASSET_KINDS: [string, string][] = [
  ["ht_", "Halftone screen"],
  ["paper_", "Paper"],
  ["grain_", "Grain"],
  ["overlay_", "Overlay"],
  ["pattern_", "Pattern"],
  ["vec_", "Vector"],
];

export type LookAssetReference = {
  id: string;
  label: string;
  kind: string;
  usedBy: string[];
  url: string;
  thumbnail: string;
};

/** Every image asset the looks use, once each: these are Curio's visual references. */
export const lookAssetReferences: LookAssetReference[] = (() => {
  const byId = new Map<string, LookAssetReference>();
  for (const look of referenceLooks) {
    const used = [
      ...(look.screen ? [{ asset: look.screen.asset, label: look.screen.label }] : []),
      ...look.textures.map((texture) => ({ asset: texture.asset, label: texture.label })),
    ];
    for (const { asset, label } of used) {
      const existing = byId.get(asset);
      if (existing) {
        existing.usedBy.push(look.name);
        continue;
      }
      byId.set(asset, {
        id: asset,
        label: label.charAt(0).toUpperCase() + label.slice(1),
        kind: ASSET_KINDS.find(([prefix]) => asset.startsWith(prefix))?.[1] ?? "Texture",
        usedBy: [look.name],
        url: lookAssetUrl(asset),
        thumbnail: `/looks/thumbs/${asset}.webp`,
      });
    }
  }
  return [...byId.values()];
})();

/** One line per look for model prompts: everything the model needs to cite a look concretely. */
export function describeLooksForPrompt() {
  return referenceLooks
    .map((look) => {
      const finish = [look.screen?.label ?? "continuous-tone gradient map", ...look.textures.map((t) => `${t.label} (${t.blend} ${Math.round(t.opacity * 100)}%)`)].join(", ");
      return `- ${look.id}: ${look.name}. ${look.summary} Finish: ${finish}. Palette ${look.palette.background} / ${look.palette.foreground} / ${look.palette.accent}. Font pair ${look.fontPairId}. Tags: ${look.styleTags.join(", ")}.`;
    })
    .join("\n");
}

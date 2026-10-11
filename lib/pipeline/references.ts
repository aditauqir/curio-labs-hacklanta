// Stage C: reference retrieval.
//
// A reference is inspiration, never a production asset and never something to
// copy. Every record therefore carries explicit licensing and a `usage` field,
// and the seeded catalogue below contains original written descriptions of
// design techniques, not copies of anyone's artwork and not scraped images.
//
// Retrieval is metadata and text based. Vector search is deliberately absent:
// the database has no embedding support today, and a keyword scorer that
// actually runs beats a similarity index that does not.
import type { Concept } from "./concepts.ts";
import type { StructuredBrief } from "./brief.ts";

export const REFERENCE_USAGES = ["inspiration-only", "licensed-for-production"] as const;
export type ReferenceUsage = (typeof REFERENCE_USAGES)[number];

export type DesignReference = {
  id: string;
  title: string;
  category: string;
  /** What this reference teaches. The reason it was retrieved. */
  principle: string;
  composition: string[];
  typography: string[];
  mood: string[];
  materials: string[];
  color: string[];
  techniques: string[];
  aspectRatio: string;
  sourceUrl: string | null;
  creator: string | null;
  license: string;
  usage: ReferenceUsage;
  tags: string[];
  /** What to take, and explicitly what not to take. */
  notes: { take: string; avoid: string };
};

/**
 * Seeded catalogue. These are original descriptions written for this project,
 * describing public design techniques. They carry no image bytes and no
 * third-party source, so they are safe to ship, and they are still marked
 * inspiration-only because a technique is not a licensed asset.
 */
export const BUILTIN_REFERENCES: DesignReference[] = [
  {
    id: "ref-asymmetric-field",
    title: "Asymmetric field",
    category: "composition",
    principle: "Weight on one side, held by a large area of emptiness on the other",
    composition: ["asymmetric-grid", "edge-anchored"],
    typography: ["large headline", "small supporting block"],
    mood: ["confident", "quiet"],
    materials: ["flat"],
    color: ["two-tone", "single accent"],
    techniques: ["asymmetric composition", "negative space"],
    aspectRatio: "4:5",
    sourceUrl: null,
    creator: null,
    license: "Original description written for Curio Labs",
    usage: "inspiration-only",
    tags: ["poster", "asymmetric-grid", "minimal", "negative-space"],
    notes: {
      take: "Let one element dominate and leave the opposite corner genuinely empty.",
      avoid: "Filling the empty side with a decorative mark to balance it.",
    },
  },
  {
    id: "ref-stacked-serif",
    title: "Stacked serif masthead",
    category: "typography",
    principle: "A tall serif headline set in tight stacked lines becomes the image",
    composition: ["typographic-stack", "centred-stack"],
    typography: ["display serif", "tight leading", "stacked lines"],
    mood: ["editorial", "intimate"],
    materials: ["uncoated paper"],
    color: ["warm neutral", "single ink"],
    techniques: ["expressive typography", "tight leading"],
    aspectRatio: "4:5",
    sourceUrl: null,
    creator: null,
    license: "Original description written for Curio Labs",
    usage: "inspiration-only",
    tags: ["poster", "typographic-stack", "serif", "editorial"],
    notes: {
      take: "Set leading tighter than the cap height so the lines lock together.",
      avoid: "Letting the stack centre itself by default; decide the alignment.",
    },
  },
  {
    id: "ref-hard-light-portrait",
    title: "Hard light subject",
    category: "image-treatment",
    principle: "A single hard light source gives a subject graphic, poster-ready edges",
    composition: ["full-bleed-image"],
    typography: ["small caps overlay"],
    mood: ["bold", "dramatic"],
    materials: ["photographic"],
    color: ["high contrast", "duotone"],
    techniques: ["hard lighting", "duotone treatment"],
    aspectRatio: "4:5",
    sourceUrl: null,
    creator: null,
    license: "Original description written for Curio Labs",
    usage: "inspiration-only",
    tags: ["poster", "full-bleed-image", "photography", "duotone"],
    notes: {
      take: "Push the shadow edge until the silhouette reads at thumbnail size.",
      avoid: "Laying text across the busiest part of the subject.",
    },
  },
  {
    id: "ref-modular-grid",
    title: "Modular information grid",
    category: "composition",
    principle: "A visible column grid turns dense details into a readable structure",
    composition: ["modular-grid"],
    typography: ["small caps", "tabular details"],
    mood: ["precise", "institutional"],
    materials: ["flat"],
    color: ["monochrome", "rule lines"],
    techniques: ["modular grid", "rule lines", "information hierarchy"],
    aspectRatio: "3:2",
    sourceUrl: null,
    creator: null,
    license: "Original description written for Curio Labs",
    usage: "inspiration-only",
    tags: ["editorial", "modular-grid", "swiss", "information"],
    notes: {
      take: "Let the rules do the separating so the type can stay one size.",
      avoid: "Adding boxes around content the grid already separates.",
    },
  },
  {
    id: "ref-diagonal-interrupt",
    title: "Diagonal interrupt",
    category: "composition",
    principle: "A single diagonal break creates motion without rotating the type",
    composition: ["diagonal-break"],
    typography: ["oversized headline", "cropped letterforms"],
    mood: ["restless", "electric"],
    materials: ["flat"],
    color: ["dark field", "electric accent"],
    techniques: ["diagonal composition", "cropping", "figure-ground reversal"],
    aspectRatio: "4:5",
    sourceUrl: null,
    creator: null,
    license: "Original description written for Curio Labs",
    usage: "inspiration-only",
    tags: ["poster", "diagonal-break", "experimental", "high-contrast"],
    notes: {
      take: "Keep the type horizontal and let the field behind it do the moving.",
      avoid: "Rotating everything, which reads as a mistake rather than a choice.",
    },
  },
  {
    id: "ref-print-grain",
    title: "Selective print grain",
    category: "material",
    principle: "Grain applied to one layer only reads as print, not as a filter",
    composition: ["centred-stack", "full-bleed-image"],
    typography: ["clean type over textured ground"],
    mood: ["nostalgic", "tactile"],
    materials: ["newsprint", "risograph"],
    color: ["limited spot colours", "mis-registration"],
    techniques: ["selective print grain", "halftone", "limited palette"],
    aspectRatio: "4:5",
    sourceUrl: null,
    creator: null,
    license: "Original description written for Curio Labs",
    usage: "inspiration-only",
    tags: ["poster", "texture", "risograph", "retro"],
    notes: {
      take: "Texture the background plate and keep the type perfectly crisp.",
      avoid: "Applying one grain overlay across the whole composition.",
    },
  },
];

export type ScoredReference = { reference: DesignReference; score: number; matched: string[] };

function tokenise(value: string) {
  return value
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

/** Keyword overlap across every metadata field, weighted by field importance. */
export function scoreReference(reference: DesignReference, terms: string[]): ScoredReference {
  const matched = new Set<string>();
  let score = 0;

  const fields: { values: string[]; weight: number }[] = [
    { values: reference.tags, weight: 3 },
    { values: reference.composition, weight: 3 },
    { values: reference.techniques, weight: 2 },
    { values: reference.mood, weight: 2 },
    { values: reference.typography, weight: 1 },
    { values: reference.color, weight: 1 },
    { values: reference.materials, weight: 1 },
    { values: [reference.principle, reference.title, reference.category], weight: 1 },
  ];

  for (const term of terms) {
    for (const field of fields) {
      const hit = field.values.some((value) => value.toLocaleLowerCase().includes(term));
      if (hit) {
        score += field.weight;
        matched.add(term);
      }
    }
  }

  return { reference, score, matched: [...matched] };
}

/**
 * Retrieves a diverse set. After the best match, each further pick is the
 * highest scoring reference whose category is not already represented, so the
 * result solves several creative problems instead of repeating one.
 */
export function retrieveReferences(
  input: { brief: StructuredBrief; concept: Concept; limit?: number; catalogue?: DesignReference[] },
): ScoredReference[] {
  const catalogue = input.catalogue ?? BUILTIN_REFERENCES;
  const limit = input.limit ?? 4;

  const terms = [
    ...new Set([
      ...tokenise(input.concept.compositionStrategy),
      ...input.concept.suggestedReferenceTags.flatMap(tokenise),
      ...tokenise(input.concept.imageTreatment),
      ...tokenise(input.concept.typographyDirection),
      ...tokenise(input.concept.colorStrategy),
      ...tokenise(input.concept.materialStrategy),
      ...input.brief.aesthetic.flatMap(tokenise),
      ...input.brief.tone.flatMap(tokenise),
      ...tokenise(input.brief.projectType),
    ]),
  ];

  const scored = catalogue
    .map((reference) => scoreReference(reference, terms))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.reference.id.localeCompare(b.reference.id));

  const chosen: ScoredReference[] = [];
  const categories = new Set<string>();

  for (const entry of scored) {
    if (chosen.length >= limit) break;
    if (categories.has(entry.reference.category)) continue;
    chosen.push(entry);
    categories.add(entry.reference.category);
  }
  // Backfill only once every category is represented.
  for (const entry of scored) {
    if (chosen.length >= limit) break;
    if (chosen.includes(entry)) continue;
    chosen.push(entry);
  }

  return chosen;
}

/** The design principle each retrieved reference contributes, for the record. */
export function principlesFrom(references: ScoredReference[]) {
  return references.map((entry) => ({
    referenceId: entry.reference.id,
    principle: entry.reference.principle,
    take: entry.reference.notes.take,
    avoid: entry.reference.notes.avoid,
    usage: entry.reference.usage,
  }));
}

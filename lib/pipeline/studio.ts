// Server-side bridge used by the from-scratch studio flow.
//
// This is the small orchestration layer that connects the existing Gemini
// stages to the TigerData library and the optional Python raster renderer. The
// library is grounding-only here: its reference images and textures must not
// be silently placed on a user's canvas.

import { getTextProvider } from "../ai/provider.ts";
import { ENGINE_TEXTURE_TAG, engineTextureContext, listLibraryAssets } from "../library.ts";
import type { LibraryAsset } from "../library.ts";
import { composeDesign } from "./composition.ts";
import { generateConcepts, type Concept, type ConceptAssetContext } from "./concepts.ts";
import { interpretBrief, type FormatId, type StructuredBrief } from "./brief.ts";
import type { DesignDocument } from "./document.ts";
import { planAssets } from "./assets.ts";
import {
  pythonPipelineStatus,
  runPythonPipeline,
  type PythonPipelineResult,
} from "./python-engine.ts";

export type StudioPipelineAsset = {
  id: string;
  kind: "reference" | "texture" | "generated";
  name: string;
  description: string | null;
  tags: string[];
  url: string | null;
};

export type StudioPipelineResult = {
  provider: string;
  model: string;
  brief: StructuredBrief;
  concepts: Concept[];
  selectedConcept: Concept;
  references: StudioPipelineAsset[];
  textures: StudioPipelineAsset[];
  document: DesignDocument;
  python: PythonPipelineResult;
  canvasAsset: StudioPipelineAsset | null;
};

function tokenise(value: string) {
  return value
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function variationIndex(seed: string, count: number) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % Math.max(count, 1);
}

function searchText(asset: LibraryAsset) {
  return [asset.name, asset.description ?? "", ...asset.tags, JSON.stringify(asset.metadata)].join(" ").toLocaleLowerCase();
}

function scoreAsset(asset: LibraryAsset, terms: string[]) {
  const haystack = searchText(asset);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function assetMatchesBriefDomain(asset: LibraryAsset, brief: StructuredBrief) {
  const briefText = [
    brief.subject,
    brief.message,
    ...brief.aesthetic,
    ...brief.tone,
  ].join(" ").toLocaleLowerCase();

  // The current server library is mostly music/editorial reference material.
  // A food brief must not inherit those images just because "poster" or
  // "typography" happened to score well. Keep the boundary semantic so a
  // future restaurant collection can opt in through its own tags.
  const foodBrief = /\b(restaurant|cafe|café|diner|bistro|bakery|bar|food|dining|kebab|grill|pizza|menu)\b/.test(briefText);
  if (!foodBrief) return true;

  return asset.tags.some((tag) =>
    /(^|:|[-_])(restaurant|cafe|café|diner|bistro|bakery|bar|food|dining|kebab|grill|pizza|menu)(:|$|[-_])/i.test(tag),
  );
}

function assetUrl(asset: LibraryAsset) {
  return asset.contentType?.startsWith("image/") && (asset.sizeBytes ?? 0) > 0
    ? `/api/assets/${encodeURIComponent(asset.id)}`
    : asset.sourceUrl;
}

function toAsset(asset: LibraryAsset, kind: StudioPipelineAsset["kind"]): StudioPipelineAsset {
  return {
    id: asset.id,
    kind,
    name: asset.name,
    description: asset.description,
    tags: asset.tags,
    url: assetUrl(asset),
  };
}

function rankAssets(
  assets: LibraryAsset[],
  brief: StructuredBrief,
  concept: Concept | null,
  limit: number,
) {
  const terms = [
    ...tokenise(brief.subject),
    ...brief.aesthetic.flatMap(tokenise),
    ...brief.tone.flatMap(tokenise),
    ...(concept
      ? [
          ...tokenise(concept.imageTreatment),
          ...tokenise(concept.materialStrategy),
          ...concept.suggestedReferenceTags.flatMap(tokenise),
        ]
      : []),
  ];

  return assets
    .filter((asset) => assetMatchesBriefDomain(asset, brief))
    .map((asset, index) => ({ asset, score: scoreAsset(asset, terms), index }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name) || a.index - b.index)
    .slice(0, limit)
    .map(({ asset }) => asset);
}

function conceptsContext(
  references: LibraryAsset[],
  textures: Awaited<ReturnType<typeof engineTextureContext>>,
): ConceptAssetContext {
  return {
    references: references.slice(0, 24).map((asset) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description,
      tags: asset.tags,
    })),
    textures: textures.map((asset) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description,
      tags: asset.tags,
    })),
  };
}

export async function generateStudioPipeline(input: {
  briefText: string;
  formatHint?: FormatId;
  instanceId?: string;
  variationSeed?: string;
}): Promise<StudioPipelineResult> {
  const provider = await getTextProvider();
  if (!provider) {
    const error = new Error("Text provider is not configured.") as Error & { kind: string };
    error.kind = "not_configured";
    throw error;
  }

  const interpreted = await interpretBrief(provider, {
    briefText: input.briefText,
    formatHint: input.formatHint,
  });

  // These reads are intentionally failure-tolerant. Gemini can still turn a
  // brief into a layout when the database is down. They are metadata-only
  // context for concept grounding, never an implicit image attachment.
  const [referenceRows, textureRows] = await Promise.all([
    listLibraryAssets("image", 200, input.instanceId, { excludeTag: ENGINE_TEXTURE_TAG }).catch(() => []),
    engineTextureContext(input.instanceId, 8),
  ]);

  const concepts = await generateConcepts(
    provider,
    interpreted.brief,
    conceptsContext(referenceRows, textureRows),
  );
  // Gemini returns deliberately different concept grammars. A fresh brief
  // should not silently collapse to concept zero every time the user retries
  // it, so the client supplies a new seed for each run.
  const selectedConcept = concepts.concepts[
    variationIndex(input.variationSeed ?? `${input.briefText}:${Date.now()}`, concepts.concepts.length)
  ];
  const references = rankAssets(referenceRows, interpreted.brief, selectedConcept, 4).map((asset) => toAsset(asset, "reference"));
  const textures = rankAssets(textureRows, interpreted.brief, selectedConcept, 4).map((asset) => toAsset(asset, "texture"));

  const plan = planAssets({ brief: interpreted.brief, concept: selectedConcept });
  const document = composeDesign({ brief: interpreted.brief, concept: selectedConcept, assets: plan.assets });
  const python = await runPythonPipeline({
    brief: interpreted.brief,
    concept: selectedConcept,
    // Server reference images and renderer textures are inspiration metadata,
    // not user-owned source pixels. A Python renderer may only receive them
    // after an explicit user-asset contract is added.
    references: [],
    textures: [],
  });

  const generatedAsset = python.outputAssetId || python.outputUrl
    ? {
        id: python.outputAssetId ?? "python-rendered-output",
        kind: "generated" as const,
        name: "Python raster output",
        description: "Rendered by the Curio Python raster engine.",
        tags: ["python-raster-engine", "generated"],
        url: python.outputUrl ?? (python.outputAssetId ? `/api/assets/${encodeURIComponent(python.outputAssetId)}` : null),
      }
    : null;

  return {
    provider: interpreted.provider,
    model: interpreted.model,
    brief: interpreted.brief,
    concepts: concepts.concepts,
    selectedConcept,
    references,
    textures,
    document,
    python: python.available ? python : { ...python, ...pythonPipelineStatus() },
    // Never auto-place a TigerData reference. Only an explicitly generated
    // Python output can become a canvas asset here.
    canvasAsset: generatedAsset,
  };
}

// Server-side bridge used by the from-scratch studio flow.
//
// This is the small orchestration layer that connects the existing Gemini
// stages to the TigerData library and the optional Python raster renderer. The
// library is grounding-only here: its reference images and textures must not
// be silently placed on a user's canvas.

import { getTextProvider } from "../ai/provider.ts";
import { ENGINE_TEXTURE_TAG, listLibraryAssets } from "../library.ts";
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

function variationIndex(seed: string, count: number) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % Math.max(count, 1);
}

function conceptsContext(
  references: LibraryAsset[],
): ConceptAssetContext {
  return {
    references: references.slice(0, 24).map((asset) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description,
      tags: asset.tags,
    })),
    textures: [],
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
  const referenceRows = await listLibraryAssets("image", 200, input.instanceId, { excludeTag: ENGINE_TEXTURE_TAG }).catch(() => []);

  const concepts = await generateConcepts(
    provider,
    interpreted.brief,
    conceptsContext(referenceRows),
  );
  // Gemini returns deliberately different concept grammars. A fresh brief
  // should not silently collapse to concept zero every time the user retries
  // it, so the client supplies a new seed for each run.
  const selectedConcept = concepts.concepts[
    variationIndex(input.variationSeed ?? `${input.briefText}:${Date.now()}`, concepts.concepts.length)
  ];
  // Server library images are inspiration metadata only. A user must import an
  // image explicitly before it can become a canvas layer or renderer input.
  const references: StudioPipelineAsset[] = [];
  const textures: StudioPipelineAsset[] = [];

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

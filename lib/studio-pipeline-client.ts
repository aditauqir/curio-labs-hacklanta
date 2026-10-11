import type { StudioAction } from "./design-state";
import type { StudioPipelineResult } from "./pipeline/studio";

export class StudioPipelineError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function generateStudioPipeline(brief: string): Promise<StudioPipelineResult> {
  const response = await fetch("/api/studio/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brief,
      format: "print-poster",
      variationSeed:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
    }),
    signal: AbortSignal.timeout(35_000),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new StudioPipelineError(response.status, body?.error ?? "pipeline_failed");
  }

  const result = (await response.json()) as StudioPipelineResult;
  if (
    !result ||
    typeof result !== "object" ||
    !result.brief ||
    !result.selectedConcept ||
    !Array.isArray(result.concepts) ||
    !Array.isArray(result.references) ||
    !Array.isArray(result.textures) ||
    !result.python
  ) {
    throw new StudioPipelineError(502, "invalid_pipeline_response");
  }
  return result;
}

function directionFor(strategy: string) {
  if (["diagonal-break", "full-bleed-image", "modular-grid"].includes(strategy)) return "experimental" as const;
  if (["centred-stack", "typographic-stack"].includes(strategy)) return "vintage" as const;
  return "minimal" as const;
}

function paletteFor(result: StudioPipelineResult) {
  const language = [
    ...result.brief.tone,
    ...result.brief.aesthetic,
    result.selectedConcept.colorStrategy,
    result.selectedConcept.materialStrategy,
  ].join(" ").toLocaleLowerCase();

  if (/dark|night|electric|neon|high contrast/.test(language)) return "night-signal";
  if (/clay|earth|terracotta|rust|brick/.test(language)) return "clay-studio";
  if (/warm|aged|vintage|retro|cream|paper|newsprint|riso/.test(language)) return "roastery";
  return "paper-ink";
}

function cleanCopy(value: string | null | undefined, fallback: string) {
  return (value?.trim() || fallback).slice(0, 200);
}

/** Turns the structured pipeline result into the existing editable studio model. */
export function pipelineResultToActions(result: StudioPipelineResult): StudioAction[] {
  const { brief, selectedConcept } = result;
  const details = brief.requiredText.details;
  const firstCanvasAsset = result.canvasAsset;

  return [
    { type: "setCopy", key: "projectName", value: cleanCopy(brief.subject, "Untitled Poster") },
    { type: "setCopy", key: "venue", value: cleanCopy(brief.subject, "YOUR VENUE").toLocaleUpperCase() },
    { type: "setCopy", key: "headline", value: cleanCopy(brief.requiredText.headline, "YOUR\nHEADLINE") },
    { type: "setCopy", key: "subtitle", value: cleanCopy(brief.requiredText.subheadline, cleanCopy(brief.message, "A first brief to refine")) },
    { type: "setCopy", key: "date", value: cleanCopy(details[0], "DATE · TIME") },
    { type: "setCopy", key: "time", value: cleanCopy(details[1], "DETAILS TO FOLLOW") },
    { type: "setCopy", key: "footer", value: cleanCopy(brief.requiredText.callToAction, "BRIEF · REFERENCES · REFINE") },
    { type: "setDirection", direction: directionFor(selectedConcept.compositionStrategy) },
    { type: "setLayoutVariant", value: selectedConcept.compositionStrategy },
    { type: "setPalette", id: paletteFor(result) },
    { type: "setColor", key: "background", value: result.document.palette.background },
    { type: "setColor", key: "foreground", value: result.document.palette.foreground },
    { type: "setColor", key: "accent", value: result.document.palette.accent },
    { type: "setMood", value: [...brief.tone, ...brief.aesthetic].slice(0, 4).join(" · ") },
    ...(firstCanvasAsset?.id.startsWith("asset:")
      ? [
          {
            type: "setReferenceTreatment" as const,
            patch: {
              assetId: firstCanvasAsset.id,
              textureAssetId: null,
              filter: "none" as const,
              blendMode: "normal" as const,
              opacity: 0.72,
              textureOpacity: 0,
            },
          },
        ]
      : []),
  ];
}

export function pipelineChangeLabels(result: StudioPipelineResult) {
  const labels = [
    `Brief: ${result.brief.subject}`,
    `Concept: ${result.selectedConcept.title}`,
  ];
  if (result.references.length > 0) labels.push("Reference library consulted, not placed");
  if (result.textures.length > 0) labels.push("Texture catalog consulted, not placed");
  if (result.canvasAsset) labels.push(`Generated output: ${result.canvasAsset.name}`);
  labels.push(
    result.python.available
      ? "Python raster output attached"
      : "Canvas uses editable type and shapes; no library image was attached",
  );
  return labels;
}

export function pipelineAssetSuggestions(result: StudioPipelineResult) {
  return result.canvasAsset ? [result.canvasAsset].map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    description: asset.description,
  })) : [];
}

export function pipelineFollowUps(result: StudioPipelineResult) {
  return result.concepts
    .slice(1, 3)
    .map((concept) => {
      const rationale = concept.rationale.replace(/[.]+$/, "").slice(0, 112);
      return `Explore ${concept.title}: ${rationale}`;
    })
    .concat(
      result.canvasAsset
        ? [`Make ${result.canvasAsset.name} the focal image and keep the current type hierarchy`]
        : [],
    )
    .slice(0, 3);
}

// Deterministic stand-in for a language model, used by automated tests and by
// local development without credentials.
//
// It is enabled only by CURIO_AI_MOCK=1 and always reports provider "mock" and
// model "mock-deterministic-1", which is persisted as provenance and surfaced
// by GET /api/status. Nothing here may be presented as real AI output.
import { AiError, type JsonRequest, type JsonResult, type TextProvider } from "./provider.ts";

/** Small stable string hash, so the same prompt always yields the same shape. */
function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(items: readonly T[], seed: number, offset = 0): T {
  return items[(seed + offset) % items.length];
}

/** Pulls the quoted user text the pipeline prompts embed, for echoing back. */
function sourceText(prompt: string) {
  const fenced = /"""\s*([\s\S]*?)\s*"""/.exec(prompt);
  return (fenced?.[1] ?? prompt).trim().slice(0, 400);
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase())
    .join(" ");
}

function briefResponse(prompt: string) {
  const text = sourceText(prompt);
  const seed = hash(text);
  const subject = titleCase(text.replace(/[^\p{L}\p{N}\s]/gu, " ")) || "Untitled Project";

  return {
    projectType: "poster",
    outputFormat: "print-poster",
    subject,
    message: text.slice(0, 160) || "No message supplied.",
    objective: pick(
      ["drive attendance", "build awareness", "announce a launch", "sell tickets"],
      seed,
    ),
    audience: pick(
      ["local creative community", "returning customers", "students and young professionals"],
      seed,
      1,
    ),
    tone: [pick(["warm", "bold", "quiet", "playful"], seed, 2), pick(["confident", "intimate"], seed, 3)],
    aesthetic: [pick(["editorial", "retro print", "swiss minimal", "expressive collage"], seed, 4)],
    requiredText: {
      headline: subject.toLocaleUpperCase().slice(0, 40) || "HEADLINE",
      subheadline: "Details to follow",
      callToAction: null,
      details: [],
    },
    constraints: [],
    brandRequirements: [],
    dimensions: { width: 1080, height: 1350 },
    exclusions: [],
    missingInformation: ["exact date", "venue address"],
    clarifyingQuestions: [],
  };
}

const CONCEPT_SHAPES = [
  {
    title: "Quiet Authority",
    hook: "A single dominant word anchored in generous empty space",
    composition: "asymmetric-grid",
    imageTreatment: "no imagery, typography carries the idea",
    typography: "large grotesk headline against small caps supporting text",
    color: "restrained two-tone with one accent",
    material: "clean uncoated paper, no texture",
  },
  {
    title: "Printed Memory",
    hook: "An artefact that looks recovered from an archive",
    composition: "centred-stack",
    imageTreatment: "duotone photograph with heavy grain",
    typography: "expressive serif with tight leading",
    color: "aged neutrals with a saturated spot colour",
    material: "visible paper grain and slight mis-registration",
  },
  {
    title: "Signal Break",
    hook: "The layout itself behaves like interference",
    composition: "diagonal-break",
    imageTreatment: "cropped abstract shapes, high contrast",
    typography: "oversized type that runs off the canvas edge",
    color: "dark field with one electric accent",
    material: "flat digital surfaces, no simulated print texture",
  },
] as const;

function conceptsResponse(prompt: string) {
  const text = sourceText(prompt);
  const seed = hash(text);

  return {
    concepts: CONCEPT_SHAPES.map((shape, index) => ({
      title: shape.title,
      rationale: `${shape.hook}. Chosen because the brief reads as ${pick(["urgent", "reflective", "celebratory"], seed, index)}.`,
      metaphor: shape.hook,
      compositionStrategy: shape.composition,
      imageTreatment: shape.imageTreatment,
      typographyDirection: shape.typography,
      colorStrategy: shape.color,
      materialStrategy: shape.material,
      suggestedReferenceTags: [shape.composition, "poster"],
      assetRequirements: [
        { type: index === 0 ? "typography" : "hero-image", role: "primary", description: shape.imageTreatment },
      ],
      avoid: ["stock-photo gloss", "centred everything", "drop shadows"],
      objectiveFit: `Supports the objective by making the headline the first thing read.`,
    })),
  };
}

function revisionResponse(prompt: string) {
  const text = sourceText(prompt).toLocaleLowerCase();
  const operations: Record<string, unknown>[] = [];

  // Deliberately keyword driven: the mock must be predictable for tests.
  if (/\btypograph|type\b|font/.test(text)) {
    operations.push({ op: "setTextStyle", target: "headline", property: "size", value: 0.16 });
  }
  if (/negative space|breathing|spacious|airy/.test(text)) {
    operations.push({ op: "setSpacing", target: "canvas", property: "spacing", value: "spacious" });
  }
  if (/colou?r|accent/.test(text)) {
    operations.push({ op: "setColor", target: "accent", property: "fill", value: "#C9F05D" });
  }
  if (/texture|grain/.test(text)) {
    operations.push({ op: "setOpacity", target: "texture", property: "opacity", value: 0.2 });
  }
  if (operations.length === 0) {
    operations.push({ op: "setTextStyle", target: "headline", property: "letterSpacing", value: -2 });
  }

  return {
    summary: `Applied ${operations.length} targeted change(s).`,
    operations,
    unchanged: ["concept", "required text", "approved assets"],
  };
}

function critiqueResponse(prompt: string) {
  const seed = hash(sourceText(prompt));
  const score = (offset: number) => 6 + ((seed + offset) % 4);
  return {
    scores: {
      conceptStrength: score(0),
      distinctiveness: score(1),
      composition: score(2),
      typography: score(3),
      assetIntegration: score(4),
      styleCoherence: score(5),
    },
    observations: [
      "The headline holds the top third without competing with supporting text.",
      "Supporting details sit close to the lower margin and could be tightened.",
    ],
    issues: [
      { severity: "minor", area: "typography", detail: "Supporting text tracking is looser than the headline." },
    ],
    revisionInstructions: ["Tighten the supporting text block toward the headline."],
  };
}

async function generateJson(request: JsonRequest): Promise<JsonResult> {
  const data = (() => {
    switch (request.scope) {
      case "brief":
        return briefResponse(request.prompt);
      case "concepts":
        return conceptsResponse(request.prompt);
      case "revision":
        return revisionResponse(request.prompt);
      case "critique":
        return critiqueResponse(request.prompt);
      default:
        throw new AiError("bad_output", "mock", `No mock response for scope "${request.scope}"`);
    }
  })();

  return { data, model: "mock-deterministic-1", provider: "mock" };
}

export const mockTextProvider: TextProvider = {
  id: "mock",
  generateJson,
};

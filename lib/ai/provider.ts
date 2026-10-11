// Server-only. Provider abstraction for the creative pipeline.
//
// The pipeline never talks to a vendor SDK directly: it asks for a capability
// ("give me structured JSON for this prompt") and gets whichever provider is
// configured. That keeps vendor details out of the pipeline stages and lets the
// tests run against a deterministic mock with no network and no credentials.
//
// Capabilities are reported honestly. This repository has a text model only;
// there is no image generation and no vision model configured, so the matching
// capabilities report `false` rather than being faked elsewhere.

export type AiErrorKind =
  | "not_configured"
  | "upstream"
  | "bad_output"
  | "timeout";

export class AiError extends Error {
  kind: AiErrorKind;
  provider: string;

  constructor(kind: AiErrorKind, provider: string, message: string) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.provider = provider;
  }
}

/** A Gemini-flavoured JSON schema. Kept loose on purpose: it is passed through. */
export type ResponseSchema = Record<string, unknown>;

export type JsonRequest = {
  system: string;
  prompt: string;
  schema: ResponseSchema;
  /** Identifies the pipeline stage, for logs and job provenance. */
  scope: string;
  maxOutputTokens?: number;
  temperature?: number;
};

export type JsonResult = {
  data: unknown;
  /** The concrete model that answered, recorded for provenance. */
  model: string;
  provider: string;
};

export type TextProvider = {
  id: string;
  generateJson(request: JsonRequest): Promise<JsonResult>;
};

export type AiCapabilities = {
  /** Structured text generation: brief parsing, concepts, revision planning. */
  text: { available: boolean; provider: string | null };
  /** Generating artwork. Nothing in this project provides it yet. */
  imageGeneration: { available: boolean; provider: string | null; reason?: string };
  /** Looking at a rendered image. Required for honest creative critique. */
  vision: { available: boolean; provider: string | null; reason?: string };
};

export function isMockEnabled() {
  return process.env.CURIO_AI_MOCK === "1";
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/**
 * Returns the active text provider, or null when nothing is configured.
 * Callers must handle null and surface a clear error rather than inventing
 * output. The mock wins when explicitly enabled so tests never hit the network.
 */
export async function getTextProvider(): Promise<TextProvider | null> {
  if (isMockEnabled()) {
    const { mockTextProvider } = await import("./mock.ts");
    return mockTextProvider;
  }
  if (isGeminiConfigured()) {
    const { geminiTextProvider } = await import("./gemini-json.ts");
    return geminiTextProvider;
  }
  return null;
}

export function aiCapabilities(): AiCapabilities {
  const mock = isMockEnabled();
  const text = mock || isGeminiConfigured();
  return {
    text: {
      available: text,
      provider: mock ? "mock" : text ? "gemini" : null,
    },
    imageGeneration: {
      available: false,
      provider: null,
      reason: "No image generation provider is configured in this deployment.",
    },
    vision: {
      available: false,
      provider: null,
      reason: "No vision-capable model is configured, so rendered output is not machine-reviewed.",
    },
  };
}

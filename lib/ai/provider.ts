// Server-only provider contracts for structured Gemini workflow requests.
// Keep vendor and credential details behind this boundary so pipeline stages
// can share one transport without bypassing Curio's validation layers.

export type AiErrorKind = "not_configured" | "upstream" | "bad_output" | "timeout";

export class AiError extends Error {
  kind: AiErrorKind;
  provider: string;

  constructor(
    kind: AiErrorKind,
    provider: string,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.provider = provider;
  }
}

export type ResponseSchema = Record<string, unknown>;

export type JsonRequest = {
  scope: string;
  system: string;
  prompt: string;
  schema: ResponseSchema;
  /** Allows longer server-to-server pipeline calls without slowing chat. */
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
};

export type JsonResult = {
  data: unknown;
  model: string;
  provider: string;
};

export type TextProvider = {
  id: string;
  generateJson(request: JsonRequest): Promise<JsonResult>;
};

export type AiCapabilities = {
  text: { available: boolean; provider: string | null };
  imageGeneration: { available: boolean; provider: string | null; reason?: string };
  vision: { available: boolean; provider: string | null; reason?: string };
};

export function isMockEnabled() {
  return process.env.CURIO_AI_MOCK === "1";
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/** Returns the configured structured-text provider, or null when unavailable. */
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
    text: { available: text, provider: mock ? "mock" : text ? "gemini" : null },
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

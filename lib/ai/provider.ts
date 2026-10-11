// Server-only provider contracts for structured Gemini workflow requests.
// Keep vendor and credential details behind this boundary so pipeline stages
// can share one transport without bypassing Curio's validation layers.

export type AiErrorKind = "not_configured" | "upstream" | "bad_output" | "timeout";

export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    public provider: string,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
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

// Server-only. Never import this module from a Client Component.
// GEMINI_API_KEY is read only inside the server-side request function.

import { AiError, type JsonRequest, type JsonResult, type TextProvider } from "./provider";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
const DEFAULT_TIMEOUT_MS = 9_000;

function modelChain() {
  const configured = process.env.GEMINI_MODEL?.split(",")
    .map((name) => name.trim())
    .filter((name) => /^[a-z0-9.-]+$/i.test(name));
  return configured && configured.length > 0 ? configured : DEFAULT_MODELS;
}

async function callModel(model: string, apiKey: string, body: string, timeoutMs: number) {
  return fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}

function responseText(value: unknown) {
  return (value as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null)
    ?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "")
    .join("");
}

async function generateJson(request: JsonRequest): Promise<JsonResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AiError("not_configured", "gemini", "GEMINI_API_KEY is not set");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: "user", parts: [{ text: request.prompt }] }],
    generationConfig: {
      temperature: request.temperature ?? 0.3,
      maxOutputTokens: request.maxOutputTokens ?? 500,
      responseMimeType: "application/json",
      responseSchema: request.schema,
    },
  });

  let lastStatus = 0;
  let timedOut = false;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const model of modelChain()) {
    let response: Response;
    try {
      response = await callModel(model, apiKey, body, timeoutMs);
    } catch {
      timedOut = true;
      lastStatus = 0;
      continue;
    }

    lastStatus = response.status;
    timedOut = false;

    // Invalid credentials or request schema will not be fixed by another model.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new AiError("upstream", "gemini", `Gemini rejected the request (${response.status})`);
    }
    if (!response.ok) continue;

    const json: unknown = await response.json().catch(() => null);
    const text = responseText(json);
    if (!text) throw new AiError("bad_output", "gemini", "Gemini returned no content");

    try {
      return { data: JSON.parse(text), model, provider: "gemini" };
    } catch {
      throw new AiError("bad_output", "gemini", "Gemini returned invalid JSON");
    }
  }

  if (timedOut) {
    throw new AiError("timeout", "gemini", `Gemini timed out after ${timeoutMs}ms`);
  }
  throw new AiError("upstream", "gemini", `Gemini is unavailable (last status ${lastStatus})`);
}

export const geminiTextProvider: TextProvider = {
  id: "gemini",
  generateJson,
};

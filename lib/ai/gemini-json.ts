// Server-only. Never import from a Client Component: it reads GEMINI_API_KEY.
//
// A generic structured-JSON caller for the creative pipeline. lib/gemini.ts
// stays as it is: it owns the single-poster chat contract the existing studio
// UI depends on. This module is the pipeline's equivalent and deliberately
// knows nothing about posters, patches or presets.
import { AiError, type JsonRequest, type JsonResult, type TextProvider } from "./provider.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Mirrors lib/gemini.ts: pinned names get retired, so an alias follows.
const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
// Pipeline stages run server to server with no browser waiting on a socket,
// so they can afford longer than the 9s the interactive chat route uses.
const REQUEST_TIMEOUT_MS = 20_000;

function modelChain() {
  const fromEnv = process.env.GEMINI_MODEL?.split(",")
    .map((name) => name.trim())
    .filter((name) => /^[a-z0-9.-]+$/i.test(name));
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_MODELS;
}

async function callModel(model: string, apiKey: string, body: string) {
  return fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
}

async function generateJson(request: JsonRequest): Promise<JsonResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AiError("not_configured", "gemini", "GEMINI_API_KEY is not set");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: "user", parts: [{ text: request.prompt }] }],
    generationConfig: {
      temperature: request.temperature ?? 0.6,
      maxOutputTokens: request.maxOutputTokens ?? 2048,
      responseMimeType: "application/json",
      responseSchema: request.schema,
    },
  });

  let lastStatus = 0;
  let timedOut = false;

  for (const model of modelChain()) {
    let response: Response;
    try {
      response = await callModel(model, apiKey, body);
    } catch {
      // Timeout or network failure. Try the next model in the chain.
      timedOut = true;
      lastStatus = 0;
      continue;
    }

    lastStatus = response.status;
    timedOut = false;

    // A rejected request will not be fixed by another model. Fail fast.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new AiError("upstream", "gemini", `Gemini rejected the request (${response.status})`);
    }
    // Retired model, rate limit, or overload: move on.
    if (!response.ok) continue;

    const json: unknown = await response.json().catch(() => null);
    const text = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null)
      ?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "")
      .join("");
    if (!text) throw new AiError("bad_output", "gemini", "Gemini returned no content");

    try {
      return { data: JSON.parse(text), model, provider: "gemini" };
    } catch {
      throw new AiError("bad_output", "gemini", "Gemini returned invalid JSON");
    }
  }

  if (timedOut) {
    throw new AiError("timeout", "gemini", `Gemini timed out after ${REQUEST_TIMEOUT_MS}ms`);
  }
  throw new AiError("upstream", "gemini", `Gemini is unavailable (last status ${lastStatus})`);
}

export const geminiTextProvider: TextProvider = {
  id: "gemini",
  generateJson,
};

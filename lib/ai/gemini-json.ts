// Server-only. Never import this module from a Client Component.
// GEMINI_API_KEY is read only inside the server-side request function.

import { AiError, type JsonRequest, type JsonResult, type TextProvider } from "./provider";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
const DEFAULT_SEARCH_MODELS = ["gemini-2.5-flash-lite"];
const DEFAULT_TIMEOUT_MS = 9_000;
const SEARCH_TIMEOUT_MS = 6_000;

function modelChain(googleSearch: boolean) {
  const configured = (googleSearch ? process.env.GEMINI_SEARCH_MODEL : process.env.GEMINI_MODEL)?.split(",")
    .map((name) => name.trim())
    .filter((name) => /^[a-z0-9.-]+$/i.test(name));
  return configured && configured.length > 0 ? configured : googleSearch ? DEFAULT_SEARCH_MODELS : DEFAULT_MODELS;
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

async function upstreamDetail(response: Response) {
  const payload = await response.clone().json().catch(() => null) as { error?: { message?: unknown } } | null;
  return typeof payload?.error?.message === "string" ? payload.error.message.slice(0, 240) : `HTTP ${response.status}`;
}

function responseText(value: unknown) {
  return (value as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null)
    ?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "")
    .join("");
}

function groundingSources(value: unknown) {
  const chunks = (value as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: unknown[] } }> } | null)
    ?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];

  const seen = new Set<string>();
  return chunks
    .map((chunk) => {
      const web = (chunk as { web?: { title?: unknown; uri?: unknown } } | null)?.web;
      return {
        title: typeof web?.title === "string" ? web.title.trim().slice(0, 120) : "Web source",
        url: typeof web?.uri === "string" ? web.uri.trim() : "",
      };
    })
    .filter((source) => {
      if (!/^https?:\/\//i.test(source.url) || seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    })
    .slice(0, 12);
}

function structuredBody(request: JsonRequest, prompt: string) {
  return JSON.stringify({
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: request.temperature ?? 0.3,
      maxOutputTokens: request.maxOutputTokens ?? 500,
      responseMimeType: "application/json",
      responseSchema: request.schema,
      ...(request.topP === undefined ? {} : { topP: request.topP }),
      ...(request.topK === undefined ? {} : { topK: request.topK }),
    },
  });
}

async function runSearchResearch(request: JsonRequest, apiKey: string) {
  const body = JSON.stringify({
    systemInstruction: {
      parts: [{
        text: "You are Curio's live web research scout. Search current public web sources for design context relevant to the brief, then return concise plain-text notes about visual language, composition, typography, materials, or subject-specific cues. Use no more than five targeted searches. Do not copy artwork, scrape images, or recommend attaching web images.",
      }],
    },
    contents: [{
      role: "user",
      parts: [{ text: `Research context for this Curio workflow request:\n${request.prompt}` }],
    }],
    generationConfig: {
      temperature: 0.45,
      maxOutputTokens: 900,
    },
    tools: [{ google_search: {} }],
  });

  let lastStatus = 0;
  let timedOut = false;
  for (const model of modelChain(true)) {
    let response: Response;
    try {
      response = await callModel(model, apiKey, body, Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, SEARCH_TIMEOUT_MS));
    } catch {
      timedOut = true;
      lastStatus = 0;
      continue;
    }

    lastStatus = response.status;
    timedOut = false;
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new AiError("grounding_unavailable", "gemini", `Gemini Search grounding was rejected (${response.status}): ${await upstreamDetail(response)}`);
    }
    if (!response.ok) continue;

    const json: unknown = await response.json().catch(() => null);
    const text = responseText(json)?.trim() ?? "";
    if (!text) throw new AiError("bad_output", "gemini", "Gemini returned no web research");
    return { text: text.slice(0, 5_000), sources: groundingSources(json) };
  }

  if (timedOut) {
    throw new AiError("timeout", "gemini", `Gemini Search timed out after ${Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, SEARCH_TIMEOUT_MS)}ms`);
  }
  throw new AiError("grounding_unavailable", "gemini", `Gemini Search is unavailable (last status ${lastStatus})`);
}

async function generateJson(request: JsonRequest): Promise<JsonResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AiError("not_configured", "gemini", "GEMINI_API_KEY is not set");

  const research = request.googleSearch ? await runSearchResearch(request, apiKey) : null;
  const prompt = research
    ? `${request.prompt}\n\nLive web research notes (use as current inspiration only; do not attach web images):\n${research.text}`
    : request.prompt;
  const body = structuredBody(request, prompt);

  let lastStatus = 0;
  let timedOut = false;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const model of modelChain(false)) {
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
      throw new AiError("upstream", "gemini", `Gemini rejected the request (${response.status}): ${await upstreamDetail(response)}`);
    }
    if (!response.ok) continue;

    const json: unknown = await response.json().catch(() => null);
    const text = responseText(json);
    if (!text) throw new AiError("bad_output", "gemini", "Gemini returned no content");

    try {
      return {
        data: JSON.parse(text),
        model,
        provider: "gemini",
        googleSearchUsed: Boolean(research),
        groundingSources: research?.sources ?? [],
      };
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

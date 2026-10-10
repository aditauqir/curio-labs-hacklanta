// Server-only. Talks to a whisper.cpp server running on this same machine.
// Whisper is OpenAI's open-source speech model, run offline: no API key and no
// audio ever leaves the server.
import { SILENCE_PEAK, parseWav, wavPeak } from "./wav";
import { VoiceError } from "./voice-error";

const DEFAULT_URL = "http://127.0.0.1:8178";
const REQUEST_TIMEOUT_MS = 25_000;
const HEALTH_TIMEOUT_MS = 800;
const HEALTH_CACHE_MS = 5_000;

// Whisper tends to "hear" these when given silence or room noise. A transcript
// made only of them is treated as nothing said, so it never becomes a poster edit.
const PHANTOM = new Set([
  "you",
  "thank you",
  "thanks for watching",
  "thank you for watching",
  "bye",
  "so",
  "okay",
  "ok",
  "uh",
  "um",
  "hmm",
  "mm",
]);

/**
 * Only loopback addresses are accepted. The base URL is configuration, but this
 * keeps a mistaken or poisoned value from turning the route into a request
 * forwarder to internal services.
 */
function baseUrl() {
  const configured = process.env.WHISPER_URL?.trim() || DEFAULT_URL;
  try {
    const url = new URL(configured);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    if (url.protocol === "http:" && local) return url.origin;
  } catch {
    // fall through to the default
  }
  return DEFAULT_URL;
}

/** Opt-out switch, for example to use only ElevenLabs. */
function disabled() {
  return process.env.WHISPER_ENABLED?.trim().toLowerCase() === "false";
}

let healthCache: { at: number; ok: boolean } | null = null;

/** True when the local Whisper server answers. Cached briefly so /api/status stays cheap. */
export async function isWhisperUp(): Promise<boolean> {
  if (disabled()) return false;

  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_CACHE_MS) return healthCache.ok;

  let ok = false;
  try {
    const response = await fetch(`${baseUrl()}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
    });
    ok = response.ok;
  } catch {
    ok = false;
  }

  healthCache = { at: now, ok };
  return ok;
}

/** Forget the cached health result, for example after a failed transcription. */
export function markWhisperDown() {
  healthCache = { at: Date.now(), ok: false };
}

function cleanTranscript(raw: string): string {
  const text = raw
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // [BLANK_AUDIO], (music), and similar
    .replace(/\s+/g, " ")
    .trim();

  const normalized = text.toLowerCase().replace(/[^a-z' ]/g, "").trim();
  if (!normalized || PHANTOM.has(normalized)) return "";
  return text.slice(0, 500);
}

/**
 * Transcribes a 16-bit PCM WAV. The browser converts recordings to this format,
 * so the server never has to decode untrusted media. Anything else is rejected.
 */
export async function transcribeWithWhisper(audio: File): Promise<string> {
  if (disabled()) throw new VoiceError("not_configured", "Whisper is disabled");

  const bytes = new Uint8Array(await audio.arrayBuffer());
  const info = parseWav(bytes);
  if (!info) throw new VoiceError("upstream", "Audio is not a 16-bit PCM WAV");

  // Silence is a valid outcome, not an error, and Whisper hallucinates on it.
  if (wavPeak(bytes, info) < SILENCE_PEAK) return "";

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
  form.append("response_format", "json");
  form.append("temperature", "0.0");

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    markWhisperDown();
    throw new VoiceError("upstream", "Whisper server is not reachable");
  }

  if (!response.ok) {
    throw new VoiceError("upstream", `Whisper transcription failed (${response.status})`);
  }

  const json = (await response.json().catch(() => null)) as { text?: unknown } | null;
  return typeof json?.text === "string" ? cleanTranscript(json.text) : "";
}

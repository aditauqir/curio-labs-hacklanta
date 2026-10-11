// Server-only. Never import this from a Client Component: it reads ELEVENLABS_API_KEY.
import { VoiceError } from "./voice-error";

const API_BASE = "https://api.elevenlabs.io/v1";
// Curio's default voice. Override with ELEVENLABS_VOICE_ID when needed.
const DEFAULT_VOICE_ID = "ZoiZ8fuDWInAcwPXaVeq";
const DEFAULT_STT_MODEL = "scribe_v1";
const TTS_MODEL = "eleven_flash_v2_5";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_SPEAK_CHARS = 600;

export function isElevenLabsConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

function apiKey() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new VoiceError("not_configured", "ELEVENLABS_API_KEY is not set");
  return key;
}

function safeId(value: string | undefined, fallback: string, pattern: RegExp) {
  const candidate = value?.trim();
  return candidate && pattern.test(candidate) ? candidate : fallback;
}

/** Speech to text with ElevenLabs. Used when local Whisper is unavailable or fails. */
export async function transcribeWithElevenLabs(audio: File): Promise<string> {
  const key = apiKey();
  const form = new FormData();
  form.append("model_id", safeId(process.env.ELEVENLABS_STT_MODEL, DEFAULT_STT_MODEL, /^[a-z0-9_]+$/i));
  form.append("tag_audio_events", "false");
  form.append("file", audio, audio.name || "speech.webm");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw new VoiceError("upstream", "ElevenLabs speech-to-text request failed");
  }

  if (!response.ok) {
    throw new VoiceError("upstream", `ElevenLabs speech-to-text failed (${response.status})`);
  }

  const json = (await response.json().catch(() => null)) as { text?: unknown } | null;
  return typeof json?.text === "string" ? json.text.trim().slice(0, 500) : "";
}

/** Text to speech. Returns the upstream response so the audio can be piped straight through. */
export async function speak(text: string): Promise<Response> {
  const key = apiKey();
  const voiceId = safeId(process.env.ELEVENLABS_VOICE_ID, DEFAULT_VOICE_ID, /^[A-Za-z0-9]{10,40}$/);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw new VoiceError("upstream", "Text-to-speech request failed");
  }

  if (!response.ok || !response.body) {
    throw new VoiceError("upstream", `Text-to-speech failed (${response.status})`);
  }
  return response;
}

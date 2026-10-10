// Server-only. Never import this from a Client Component: it reads OPENAI_API_KEY.
import { VoiceError } from "./voice-error";

const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
// gpt-transcribe is OpenAI's current recommended model. The older ones are
// fallbacks for keys without access to it. Override with OPENAI_STT_MODEL="a,b".
const DEFAULT_MODELS = ["gpt-transcribe", "gpt-4o-mini-transcribe", "whisper-1"];

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function modelChain() {
  const fromEnv = process.env.OPENAI_STT_MODEL?.split(",")
    .map((name) => name.trim())
    .filter((name) => /^[a-z0-9._-]+$/i.test(name));
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_MODELS;
}

/** Speech to text with OpenAI. Returns the transcript, which may be empty for silence. */
export async function transcribeWithOpenAi(audio: File): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new VoiceError("not_configured", "OPENAI_API_KEY is not set");

  let lastStatus = 0;

  for (const model of modelChain()) {
    // FormData cannot be reused once sent, so build it per attempt.
    const form = new FormData();
    form.append("model", model);
    form.append("file", audio, audio.name || "speech.webm");

    let response: Response;
    try {
      response = await fetch(TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
    } catch {
      lastStatus = 0; // timeout or network failure: try the next model
      continue;
    }

    lastStatus = response.status;

    // A bad or unauthorised key will not be fixed by another model.
    if (response.status === 401 || response.status === 403) {
      throw new VoiceError("upstream", `OpenAI rejected the key (${response.status})`);
    }
    // Unknown model, quota, or overload: try the next model in the chain.
    if (!response.ok) continue;

    const json = (await response.json().catch(() => null)) as { text?: unknown } | null;
    return typeof json?.text === "string" ? json.text.trim().slice(0, 500) : "";
  }

  throw new VoiceError("upstream", `OpenAI transcription failed (last status ${lastStatus})`);
}

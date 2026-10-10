// Server-only. Picks a speech-to-text provider and falls back if the first one fails.
import { isElevenLabsConfigured, transcribeWithElevenLabs } from "./elevenlabs";
import { isOpenAiConfigured, transcribeWithOpenAi } from "./openai";
import { VoiceError } from "./voice-error";

export type Transcriber = "openai" | "elevenlabs";

/** OpenAI first (the preferred model), ElevenLabs as the backup. */
export function availableTranscribers(): Transcriber[] {
  const providers: Transcriber[] = [];
  if (isOpenAiConfigured()) providers.push("openai");
  if (isElevenLabsConfigured()) providers.push("elevenlabs");
  return providers;
}

export function isTranscriptionConfigured() {
  return availableTranscribers().length > 0;
}

export async function transcribe(
  audio: File,
): Promise<{ text: string; provider: Transcriber }> {
  const providers = availableTranscribers();
  if (providers.length === 0) {
    throw new VoiceError("not_configured", "No speech-to-text provider is configured");
  }

  let lastError: unknown;
  for (const provider of providers) {
    try {
      const text =
        provider === "openai"
          ? await transcribeWithOpenAi(audio)
          : await transcribeWithElevenLabs(audio);
      // An empty transcript just means silence. It is not a failure, so do not retry.
      return { text, provider };
    } catch (error) {
      lastError = error;
      // Log the category only, never the key, audio, or upstream body.
      console.error(
        `[transcribe] ${provider} failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  throw lastError instanceof VoiceError
    ? lastError
    : new VoiceError("upstream", "Speech-to-text failed");
}

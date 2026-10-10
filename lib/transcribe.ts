// Server-only. Picks a speech-to-text provider and falls back if the first one fails.
import { isElevenLabsConfigured, transcribeWithElevenLabs } from "./elevenlabs";
import { isWhisperUp, transcribeWithWhisper } from "./whisper";
import { VoiceError } from "./voice-error";

export type Transcriber = "whisper" | "elevenlabs";

/** ElevenLabs is the primary provider; local Whisper remains the offline fallback. */
export async function availableTranscribers(): Promise<Transcriber[]> {
  const providers: Transcriber[] = [];
  if (isElevenLabsConfigured()) providers.push("elevenlabs");
  if (await isWhisperUp()) providers.push("whisper");
  return providers;
}

export async function transcribe(
  audio: File,
): Promise<{ text: string; provider: Transcriber }> {
  const providers = await availableTranscribers();
  if (providers.length === 0) {
    throw new VoiceError("not_configured", "No speech-to-text provider is available");
  }

  let lastError: unknown;
  for (const provider of providers) {
    try {
      const text =
        provider === "whisper"
          ? await transcribeWithWhisper(audio)
          : await transcribeWithElevenLabs(audio);
      // An empty transcript just means silence. It is not a failure, so do not retry.
      return { text, provider };
    } catch (error) {
      lastError = error;
      // Log the category only, never the audio or an upstream body.
      console.error(
        `[transcribe] ${provider} failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  throw lastError instanceof VoiceError
    ? lastError
    : new VoiceError("upstream", "Speech-to-text failed");
}

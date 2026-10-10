import { connection } from "next/server";
import { isGeminiConfigured } from "@/lib/gemini";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { availableTranscribers } from "@/lib/transcribe";

// Reports which integrations are configured, never the keys themselves.
// connection() opts out of prerendering: without it Next would freeze this
// response at build time, when CI has no keys, and report "not configured" forever.
export async function GET() {
  await connection();

  const transcribers = availableTranscribers();

  return Response.json(
    {
      director: { provider: isGeminiConfigured() ? "gemini" : "demo" },
      voice: {
        // The microphone needs a speech-to-text provider. Spoken replies need ElevenLabs.
        listen: transcribers.length > 0,
        transcriber: transcribers[0] ?? null,
        speak: isElevenLabsConfigured(),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
